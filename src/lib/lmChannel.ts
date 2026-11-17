import lmMeta from '../data/lmModel.json'
import lmValid from '../data/lmValidation.json'
import {
  DEQUANT,
  LM_MASK,
  LM_TABLE_SIZE,
  LM_W1,
  LM_W2,
  bigramBucket,
  normalizeLm,
  splitSentencesLm,
} from './lmText'

/**
 * 语言模型通道 —— 本项目第一个真正「训练出来的模型」。
 *
 * 训练阶段（scripts/train-lm.ts）在 4.3 万篇真实语料上分别训练了两个字符级
 * 2-gram 语言模型：一个只读真人写作，一个只读 AI 写作。对任意文本，计算
 * 它在两个模型下的平均对数概率之差（对数似然比）：
 *
 *   delta = logP(文本 | AI 模型) − logP(文本 | 真人模型)
 *
 * delta 越大，说明这段文字更「可被 AI 文风模型预测」，也就是更像训练语料里的
 * AI 写法。再经过 Platt 标定映射到 0–100。
 *
 * 为什么是 2-gram 而不是神经网络：0.5B 级模型要下载数百 MB 且依赖 WebGPU，
 * 在手机和不稳定网络下不可用（v0.5 试过，生产环境直接崩）。字符 2-gram 消融实测
 * 与 3-gram 的域内 AUC 只差 0.004（scripts/probe-ablate.ts），体积却省一半，
 * 1.1MB、毫秒级、纯 JS。
 *
 * 必须同步展示的边界（数字一律来自 src/data/lmValidation.json，不在此硬编码，
 * 避免又出现「页面写一套、数据另一套」的漂移）：
 *  1. 域内 AUC 高，但跨到学术论文接近随机（0.5 上下）—— 与所有表层统计检测器一样会失效。
 *  2. 阈值 50 时特异度只有约四分之三，即约四分之一真人文本会被判高。
 *  3. 训练语料的 AI 文本是 2023 年初的 ChatGPT，不代表 2026 年的新模型。
 *  4. 个别域（如 open_qa）模型 AUC 甚至低于「只看文本长度」这一表层特征，
 *     说明那部分判别力来自篇幅/排版，不是文风。字段 inDomain.formatBaseline。
 * 因此本通道读数只能作为「文风接近程度」的参考，不能推断作者身份。
 */

export const LM_MODEL_LABEL = '语言模型通道 · 字符 2-gram 双模型（真人 / AI 各一个，本地推理）'

export interface LmSentenceReading {
  text: string
  score: number
  delta: number
}

export interface LmChannelResult {
  available: boolean
  /** 0–100 标定读数，越大越接近训练语料中的 AI 文风 */
  score: number
  /** 对数似然比（AI 模型 − 真人模型），原始值，未标定 */
  delta: number
  humanLogp: number
  aiLogp: number
  /** 句级读数的标准差：AI 文本通常更均匀 */
  burstiness: number
  sentences: LmSentenceReading[]
  tokens: number
}

export const LM_REFERENCE = {
  cvAuc: lmValid.inDomain.cvAucMean,
  cvAucStd: lmValid.inDomain.cvAucStd,
  holdoutAuc: lmValid.inDomain.holdoutAuc,
  holdoutN: lmValid.inDomain.holdoutN,
  macroAuc: lmValid.inDomain.macroAucOverDomains,
  sensitivity: lmValid.inDomain.atThreshold50.sensitivity,
  specificity: lmValid.inDomain.atThreshold50.specificity,
  crossDomainAuc: lmValid.crossDomain?.auc ?? null,
  crossDomainN: lmValid.crossDomain?.n ?? 0,
  /** 模型跑不过「只看长度」的表层基线时，训练脚本会写入该域（红队审计要求披露） */
  formatBaseline: (lmValid.inDomain as { formatBaseline?: { domain: string; modelAuc: number; lengthAuc: number; gap: number } | null }).formatBaseline ?? null,
  trainedDocs: Number(/清洗后 (\d+) 篇/.exec(lmValid.meta.dataset)?.[1] ?? 0),
  sizeMB: Number((lmMeta.sizeBytes / 1e6).toFixed(2)),
  gzKB: Math.round(((lmMeta as { sizeGzBytes?: number }).sizeGzBytes ?? 0) / 1024),
  caveats: lmValid.caveats as string[],
}

const LM_FILE = lmMeta.file
const CAL = lmMeta.calibration

interface RuntimeModel {
  /** Unicode 码点 → unigram 下标 */
  index: Map<number, number>
  unigram: Float32Array
  table: Uint8Array
  total: number
}

export interface LmModel {
  human: RuntimeModel
  ai: RuntimeModel
}

function parseModel(buf: ArrayBuffer, offset: number, vocab: number, total: number): { model: RuntimeModel; next: number } {
  const view = new DataView(buf)
  const index = new Map<number, number>()
  const unigramRaw = new Float32Array(vocab)
  let p = offset
  const codes: number[] = []
  for (let i = 0; i < vocab; i++) {
    codes.push(view.getUint32(p, true))
    p += 4
  }
  let sum = 0
  for (let i = 0; i < vocab; i++) {
    const v = view.getUint32(p, true)
    p += 4
    unigramRaw[i] = v
    sum += v
    index.set(codes[i], i)
  }
  const table = new Uint8Array(buf, p, LM_TABLE_SIZE)
  p += LM_TABLE_SIZE
  // 训练时的总字符数以产物为准（含未进 vocab 的稀有字），这里以元数据为准
  const total2 = total || sum
  return { model: { index, unigram: unigramRaw, table, total: total2 }, next: p }
}

let modelPromise: Promise<LmModel | null> | null = null

/**
 * 取模型二进制。
 * 优先拿预压缩版（约 342KB），用 DecompressionStream 在本地解开；
 * 浏览器不支持或解压失败时回落到 1.12MB 的原始文件。
 * 这样既照顾慢网，也不会在旧浏览器上直接崩。
 */
async function fetchModelBuffer(): Promise<ArrayBuffer | null> {
  const plain = new URL(LM_FILE, document.baseURI).href
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const res = await fetch(`${plain}.gz`)
      if (res.ok && res.body) {
        const stream = res.body.pipeThrough(new DecompressionStream('gzip'))
        const buf = await new Response(stream).arrayBuffer()
        if (buf.byteLength > 1000) return buf
      }
    } catch {
      // 忽略，走下面的回退
    }
  }
  try {
    const res = await fetch(plain)
    return res.ok ? await res.arrayBuffer() : null
  } catch {
    return null
  }
}

export function loadLmModel(): Promise<LmModel | null> {
  if (modelPromise) return modelPromise
  modelPromise = (async () => {
    try {
      const buf = await fetchModelBuffer()
      if (!buf) return null
      const view = new DataView(buf)
      const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
      if (magic !== 'RALM') return null
      const vocabH = view.getUint32(8, true)
      const vocabA = view.getUint32(12, true)
      const h = parseModel(buf, 24, vocabH, lmMeta.models[0].chars)
      const a = parseModel(buf, h.next, vocabA, lmMeta.models[1].chars)
      return { human: h.model, ai: a.model }
    } catch {
      return null
    }
  })()
  return modelPromise
}

/** 平均对数概率（负交叉熵），与 scripts/train-lm.ts 的 meanLogp 严格同口径 */
function meanLogp(model: RuntimeModel, normalized: string): number {
  const n = normalized.length
  if (n < 3) return -20
  let sum = 0
  let count = 0
  let prevIdx = model.index.get(normalized.codePointAt(0) ?? 0) ?? -1
  for (let i = 1; i < n; i++) {
    const cp = normalized.codePointAt(i) ?? 0
    const idx = model.index.get(cp) ?? -1
    const u = idx >= 0 ? model.unigram[idx] : 0
    const p1 = u > 0 ? u / model.total : 1e-9
    let p2 = 0
    if (prevIdx >= 0) {
      const q = model.table[bigramBucket(normalized[i - 1], normalized[i], LM_MASK)]
      const cnt = DEQUANT[q]
      const ctx = model.unigram[prevIdx]
      if (cnt >= 1 && ctx > 0) p2 = cnt / ctx
    }
    const p = LM_W2 * p2 + LM_W1 * p1
    sum += Math.log2(Math.max(p, 1e-9))
    count++
    prevIdx = idx
  }
  return count > 0 ? sum / count : -20
}

function deltaOf(model: LmModel, normalized: string): { delta: number; humanLogp: number; aiLogp: number } {
  const humanLogp = meanLogp(model.human, normalized)
  const aiLogp = meanLogp(model.ai, normalized)
  return { delta: aiLogp - humanLogp, humanLogp, aiLogp }
}

/** 似然比 → 0–100（Platt 标定，参数由训练脚本在 OOF 预测上拟合） */
export function calibrateDelta(delta: number): number {
  const z = (delta - CAL.mean) / CAL.std
  const s = 100 / (1 + Math.exp(-(CAL.a * z + CAL.b)))
  return Math.round(Math.min(100, Math.max(0, s)))
}

/** 纯函数核心：给定模型与文本，产出通道读数。测试直接喂构造模型。 */
export function scoreLmText(model: LmModel, text: string): LmChannelResult {
  const normalized = normalizeLm(text)
  if (normalized.length < 20) {
    return {
      available: false,
      score: 0,
      delta: 0,
      humanLogp: 0,
      aiLogp: 0,
      burstiness: 0,
      sentences: [],
      tokens: normalized.length,
    }
  }
  const whole = deltaOf(model, normalized)
  const sentences: LmSentenceReading[] = []
  for (const raw of splitSentencesLm(text)) {
    const norm = normalizeLm(raw)
    if (norm.length < 8) continue
    const d = deltaOf(model, norm)
    sentences.push({ text: raw, score: calibrateDelta(d.delta), delta: Number(d.delta.toFixed(4)) })
  }
  const deltas = sentences.map((s) => s.delta)
  const mean = deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0
  const variance = deltas.length > 1
    ? deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / deltas.length
    : 0
  return {
    available: true,
    score: calibrateDelta(whole.delta),
    delta: Number(whole.delta.toFixed(4)),
    humanLogp: Number(whole.humanLogp.toFixed(4)),
    aiLogp: Number(whole.aiLogp.toFixed(4)),
    burstiness: Number(Math.sqrt(variance).toFixed(4)),
    sentences: sentences.sort((a, b) => b.score - a.score).slice(0, 8),
    tokens: normalized.length,
  }
}

/** 便捷入口：负责加载模型，加载失败返回 null（不阻塞主流程） */
export async function runLmChannel(text: string): Promise<LmChannelResult | null> {
  const model = await loadLmModel()
  if (!model) return null
  const result = scoreLmText(model, text)
  return result.available ? result : null
}
