import type { ProbabilityChannelResult } from './types'

/**
 * 实验性神经通道：浏览器本地运行小型语言模型，计算逐 token 交叉熵
 * （困惑度）与突发度（burstiness）。真正的 DetectGPT / Fast-DetectGPT
 * 概率曲率需要扰动重打分，算力超出浏览器；Binoculars 需要双 7B 模型，
 * 同样不可行。此处是可行子集，且换算公式完全公开。
 *
 * 换算常量来自 HC3 中文样本校准（scripts/calibrate-probability.ts，60 篇）：
 *   - 突发度：真人中位 0.304，AI 中位 0.263，AUC 0.747（方向符合预期）
 *     burstScore = clamp((0.40 − B) / 0.20 × 100)   // B=0.40 → 0 分，B=0.20 → 100 分
 *     本通道只按突发度计分。
 *   - 困惑度：校准发现其方向与经典假设**相反**（AI 文本困惑度反而更高，
 *     反向 AUC 0.97）。这可能源于模型与生成器的分布差异，未验证因果关系。
 *     因此困惑度仅作原始测量展示，不参与计分——这正是"单一信号检测器
 *     会翻车"的活例子。
 */

const MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct'
const MAX_TOKENS = 384

/**
 * 推理库走 CDN 动态加载（多镜像兜底）：
 * GitHub secret scanning 会把该库源码中的模型类名（如 Mistral3ForConditionalGeneration，
 * 恰好 32 位字母数字）误判为 Mistral API key，导致包含它的提交无法推送到仓库，
 * 因此不能把库文件自托管在本仓库 / GitHub Pages 上。ORT wasm 体积大且无此问题，
 * 仍自托管在 /vendor/ort/ 并显式指定 wasmPaths。
 */
const LIBRARY_CANDIDATES = [
  'https://fastly.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.web.min.js',
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.web.min.js',
  'https://gcore.jsdelivr.net/npm/@huggingface/transformers@4.3.2/dist/transformers.web.min.js',
  'https://unpkg.com/@huggingface/transformers@4.3.2/dist/transformers.web.min.js',
]

export const PROBABILITY_MODEL_LABEL = 'Qwen2.5-0.5B（本地推理，约 350 MB，一次下载后浏览器缓存）'
export const PROBABILITY_FORMULA =
  'score = clamp((0.40 − 突发度) / 0.20 × 100)，仅按突发度计分（HC3 校准 AUC 0.747）；困惑度只展示不计分——校准发现其方向与经典假设相反'

type ProgressCallback = (status: ProbabilityChannelResult) => void

// transformers.js 很大，只在用户主动点击时才动态加载（Vite 自动代码分割）
let pipelinePromise: Promise<{
  run: (text: string) => Promise<{ perplexity: number; burstiness: number; tokens: number }>
}> | null = null

async function loadEngine(onProgress: ProgressCallback) {
  let transformers: typeof import('@huggingface/transformers') | null = null
  let lastError: unknown = null
  for (const candidate of LIBRARY_CANDIDATES) {
    try {
      transformers = await import(/* @vite-ignore */ candidate)
      break
    } catch (error) {
      lastError = error
    }
  }
  if (!transformers) {
    throw new Error(`推理库从所有 CDN 均加载失败（需要能访问 jsdelivr 系 CDN）: ${String(lastError)}`)
  }
  const { env, AutoTokenizer, AutoModelForCausalLM } = transformers
  // 默认走国内可达的模型镜像；hf.co 在中国大陆不可直连
  env.remoteHost = 'https://hf-mirror.com'
  env.allowLocalModels = false
  // ORT wasm 自托管，与本库锁定的 onnxruntime-web 版本一致
  const wasmEnv = env.backends.onnx.wasm
  if (wasmEnv) wasmEnv.wasmPaths = new URL('vendor/ort/', document.baseURI).href

  const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID)
  const model = await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
    dtype: 'q4',
    progress_callback: (info: { status?: string; progress?: number; file?: string }) => {
      if (info.status === 'progress' && typeof info.progress === 'number') {
        onProgress({ status: 'loading', message: `模型下载中 ${Math.round(info.progress)}%（约 350 MB，下载后缓存）` })
      }
    },
  })

  return {
    async run(text: string) {
      const inputs = tokenizer(text, { truncation: true, max_length: MAX_TOKENS, return_tensor: true })
      const inputIds = inputs.input_ids.data as BigInt64Array | Float32Array
      const tokenCount = inputIds.length
      if (tokenCount < 8) throw new Error('文本过短，神经通道至少需要 8 个 token')

      const output = await model({ input_ids: inputs.input_ids, attention_mask: inputs.attention_mask })
      const logits = output.logits
      const dims = logits.dims as number[]
      const [batch, seqLen, vocab] = dims
      const data = logits.data as Float32Array
      if (batch !== 1) throw new Error('意外的批处理维度')

      // 对每个位置 t（1..n-1）：真实 token 是 input_ids[t]，模型在位置 t-1 给出分布
      const crossEntropies: number[] = []
      for (let t = 1; t < seqLen; t += 1) {
        const rowOffset = t * vocab
        let logSumExp = -Infinity
        for (let v = 0; v < vocab; v += 1) {
          const value = data[rowOffset + v]
          if (value > logSumExp) logSumExp = value
        }
        let sumExp = 0
        for (let v = 0; v < vocab; v += 1) sumExp += Math.exp(data[rowOffset + v] - logSumExp)
        const logZ = logSumExp + Math.log(sumExp)
        const targetId = Number(inputIds[t])
        const targetLogit = data[rowOffset + targetId]
        crossEntropies.push(logZ - targetLogit)
      }

      const meanCe = crossEntropies.reduce((sum, value) => sum + value, 0) / crossEntropies.length
      const variance = crossEntropies.reduce((sum, value) => sum + (value - meanCe) ** 2, 0) / crossEntropies.length
      const sdCe = Math.sqrt(variance)
      return {
        perplexity: Math.exp(meanCe),
        burstiness: meanCe > 0 ? sdCe / meanCe : 0,
        tokens: tokenCount,
      }
    },
  }
}

export async function runProbabilityChannel(
  text: string,
  onProgress: ProgressCallback,
): Promise<ProbabilityChannelResult> {
  try {
    if (!pipelinePromise) {
      onProgress({ status: 'loading', message: '首次运行需加载推理引擎与模型（约 350 MB，走国内镜像，仅浏览器本地）' })
      pipelinePromise = loadEngine(onProgress)
    }
    const engine = await pipelinePromise
    onProgress({ status: 'running', message: '正在逐 token 计算概率分布（浏览器本地推理，文本不上传）' })
    const { perplexity, burstiness, tokens } = await engine.run(text)

    const burstScore = Math.min(100, Math.max(0, ((0.4 - burstiness) / 0.2) * 100))
    const score = Math.round(burstScore)

    return {
      status: 'done',
      message: `困惑度 ${perplexity.toFixed(1)}，突发度 ${burstiness.toFixed(2)}（${tokens} tokens）`,
      modelName: MODEL_ID,
      tokens,
      perplexity: Number(perplexity.toFixed(1)),
      burstiness: Number(burstiness.toFixed(2)),
      score,
      formula: PROBABILITY_FORMULA,
    }
  } catch (error) {
    pipelinePromise = null
    const detail = error instanceof Error ? error.message : String(error)
    return {
      status: 'error',
      message: '神经通道未能完成，主报告不受影响。',
      error: detail,
    }
  }
}
