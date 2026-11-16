/**
 * 神经通道校准：在 HC3 样本上测量 Qwen2.5-0.5B-Instruct 对真人/AI 文本的
 * ln(困惑度) 与突发度分布，为换算常量提供数据依据。
 * 运行：npx tsx scripts/calibrate-probability.ts
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AutoTokenizer, AutoModelForCausalLM, env } from '@huggingface/transformers'

const ROOT = join(import.meta.dirname, '..')
env.remoteHost = 'https://hf-mirror.com'
env.allowLocalModels = false

const MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct'
const MAX_TOKENS = 256
const PER_CLASS = 30

interface Sample { label: 'human' | 'ai'; domain: string; text: string }

const lines = readFileSync(join(ROOT, 'calibration', 'hc3_zh_sample.jsonl'), 'utf-8').split('\n').filter(Boolean)
const all = lines.map((line) => JSON.parse(line) as Sample)
const pick = (label: 'human' | 'ai') => {
  const pool = all.filter((sample) => sample.label === label)
  const stride = Math.max(1, Math.floor(pool.length / PER_CLASS))
  return pool.filter((_, index) => index % stride === 0).slice(0, PER_CLASS)
}
const subset = [...pick('human'), ...pick('ai')]
console.log(`calibrating on ${subset.length} samples (${PER_CLASS} per class)…`)

const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID)
const model = await AutoModelForCausalLM.from_pretrained(MODEL_ID, { dtype: 'q4' })

async function scoreText(text: string) {
  const inputs = tokenizer(text, { truncation: true, max_length: MAX_TOKENS, return_tensor: true })
  const inputIds = inputs.input_ids.data as BigInt64Array | Float32Array
  const output = await model({ input_ids: inputs.input_ids, attention_mask: inputs.attention_mask })
  const logits = output.logits
  const dims = logits.dims as number[]
  const [, seqLen, vocab] = dims
  const data = logits.data as Float32Array
  const crossEntropies: number[] = []
  for (let t = 1; t < seqLen; t += 1) {
    const offset = t * vocab
    let max = -Infinity
    for (let v = 0; v < vocab; v += 1) if (data[offset + v] > max) max = data[offset + v]
    let sum = 0
    for (let v = 0; v < vocab; v += 1) sum += Math.exp(data[offset + v] - max)
    const logZ = max + Math.log(sum)
    const targetLogit = data[offset + Number(inputIds[t])]
    crossEntropies.push(logZ - targetLogit)
  }
  const meanCe = crossEntropies.reduce((sum, value) => sum + value, 0) / crossEntropies.length
  const sd = Math.sqrt(crossEntropies.reduce((sum, value) => sum + (value - meanCe) ** 2, 0) / crossEntropies.length)
  return { logP: meanCe, burstiness: meanCe > 0 ? sd / meanCe : 0 }
}

const results: Array<{ label: 'human' | 'ai'; logP: number; burstiness: number }> = []
for (const [index, sample] of subset.entries()) {
  results.push({ label: sample.label, ...await scoreText(sample.text) })
  if ((index + 1) % 10 === 0) console.log(`  ${index + 1}/${subset.length}`)
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
const auc = (h: number[], a: number[]) => {
  let wins = 0
  let ties = 0
  a.forEach((av) => h.forEach((hv) => { if (av > hv) wins += 1; else if (av === hv) ties += 1 }))
  return (wins + ties / 2) / (a.length * h.length)
}

for (const key of ['logP', 'burstiness'] as const) {
  const h = results.filter((item) => item.label === 'human').map((item) => item[key])
  const a = results.filter((item) => item.label === 'ai').map((item) => item[key])
  // AI 特征越高 → 分越高，所以 AI 值低 = 检测命中：AUC 用 ai < human 方向
  const aucLow = 1 - auc(h, a)
  console.log(`${key}: human median ${median(h).toFixed(3)} | ai median ${median(a).toFixed(3)} | AUC(ai lower) ${aucLow.toFixed(3)}`)
  console.log(`   quartiles human: ${[0.25, 0.5, 0.75].map((q) => h.sort((x, y) => x - y)[Math.floor(q * (h.length - 1))].toFixed(3)).join(' / ')}`)
  console.log(`   quartiles ai:    ${[0.25, 0.5, 0.75].map((q) => a.sort((x, y) => x - y)[Math.floor(q * (a.length - 1))].toFixed(3)).join(' / ')}`)
}
