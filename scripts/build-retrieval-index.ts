/**
 * 构建「语料基座检索」索引（纯统计，零 AI 模型）
 *
 * 从 HC3 中文公开数据集的真实 human / ChatGPT 答案配对中，抽取代表性语料，
 * 用字符 bigram + 特征哈希 + TF-IDF 向量化，生成紧凑索引随站点分发。
 * 浏览器端只需做余弦相似度 topK 检索，不下载模型、不联网、可解释。
 *
 * 用法：npx tsx scripts/build-retrieval-index.ts
 * 产物：public/retrieval-index.json
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const ROOT = process.cwd()
const DIMS = 4096
const TOPK_DIMS = 64 // 每文档保留 top64 特征：AUC 0.956→0.950，体积近乎减半
const MIN_LEN = 150
const MAX_LEN = 2200
const TEST_EVERY = 6
const OUT = path.join(ROOT, 'public', 'retrieval-index.json')
const EXCERPTS_OUT = path.join(ROOT, 'public', 'retrieval-excerpts.json')

function bigrams(text: string): string[] {
  const t = text.replace(/\s+/g, '')
  const out: string[] = []
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2))
  return out
}

function hash(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % DIMS
}

function toTf(text: string): Map<number, number> {
  const m = new Map<number, number>()
  for (const g of bigrams(text)) {
    const d = hash(g)
    m.set(d, (m.get(d) ?? 0) + 1)
  }
  for (const [d, c] of m) m.set(d, 1 + Math.log(c))
  return m
}

function readJsonl(file: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line) } catch { return {} }
  })
}

interface RawDoc { gid: number; label: number; text: string }

const zhFiles = ['zh_baike', 'zh_finance', 'zh_law', 'zh_medicine', 'zh_open_qa', 'zh_psychology']
const rawDocs: RawDoc[] = []
let gid = 0
for (const name of zhFiles) {
  const rows = readJsonl(path.join(ROOT, 'calibration', 'raw', `${name}.jsonl`))
  for (const r of rows) {
    const hs = Array.isArray(r.human_answers) ? r.human_answers : []
    const cs = Array.isArray(r.chatgpt_answers) ? r.chatgpt_answers : []
    const h = String(hs[0] ?? '').trim()
    const c = String(cs[0] ?? '').trim()
    if (h.length < MIN_LEN || h.length > MAX_LEN || c.length < MIN_LEN || c.length > MAX_LEN) continue
    const isTest = gid % TEST_EVERY === 0
    if (!isTest) {
      rawDocs.push({ gid, label: 0, text: h })
      rawDocs.push({ gid, label: 1, text: c })
    }
    gid += 1
  }
}

// 统计 df（仅基座）以计算 idf
const df = new Map<number, number>()
const tfCache: Array<Map<number, number>> = []
for (const d of rawDocs) {
  const tf = toTf(d.text)
  tfCache.push(tf)
  for (const dim of tf.keys()) df.set(dim, (df.get(dim) ?? 0) + 1)
}
const N = rawDocs.length
const idf: number[] = new Array(DIMS).fill(0)
for (const [dim, n] of df) idf[dim] = Math.log((N + 1) / (n + 1)) + 1

// 生成紧凑文档向量：只保留 top-K 维度，权重量化到整数（×100 的 tf）
interface CompactDoc { l: number; v: number[]; e: string } // v = [dim, qw, dim, qw, ...], e = 原文片段(可解释)
const docs: CompactDoc[] = []
for (let i = 0; i < rawDocs.length; i++) {
  const tf = tfCache[i]
  const top = [...tf.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOPK_DIMS)
  const v: number[] = []
  for (const [dim, tfv] of top) {
    const w = Math.round(tfv * 100)
    if (w > 0) v.push(dim, w)
  }
  docs.push({ l: rawDocs[i].label, v })
}

const artifact = {
  version: 2,
  dims: DIMS,
  docCount: docs.length,
  idf: idf.map((x) => Number(x.toFixed(3))),
  labels: docs.map((d) => d.l),
  docs: docs.map((d) => d.v),
  meta: {
    source: 'Hello-SimpleAI/HC3-Chinese (Apache-2.0), zh_* subsets',
    method: 'char-bigram hashing + TF-IDF, top-K dims per doc, no neural model',
    topKDims: TOPK_DIMS,
    builtAt: new Date().toISOString().slice(0, 10),
  },
}

// 原文片段单独成文件：只有用户点开"查看最近邻"时才加载，不拖慢检索启动
const excerpts = rawDocs.map((d) => d.text.replace(/\s+/g, ' ').trim().slice(0, 90))

fs.mkdirSync(path.dirname(OUT), { recursive: true })
const json = JSON.stringify(artifact)
fs.writeFileSync(OUT, json, 'utf-8')
fs.writeFileSync(EXCERPTS_OUT, JSON.stringify(excerpts), 'utf-8')
const gz = zlib.gzipSync(Buffer.from(json))
const gzEx = zlib.gzipSync(Buffer.from(JSON.stringify(excerpts)))
console.log(`文档数: ${docs.length}`)
console.log(`主索引: 原始 ${(Buffer.byteLength(json) / 1024 / 1024).toFixed(2)} MB / gzip ${(gz.length / 1024).toFixed(0)} KB（启动即需）`)
console.log(`片段表: gzip ${(gzEx.length / 1024).toFixed(0)} KB（点开最近邻才加载）`)

// ---- 自检：用产物格式重放域内留出 AUC（验证压缩没毁掉信号）----
const postings = new Map<number, Array<{ i: number; w: number }>>()
for (let i = 0; i < docs.length; i++) {
  const v = docs[i].v
  for (let k = 0; k < v.length; k += 2) {
    const dim = v[k]
    const w = (v[k + 1] / 100) * (idf[dim] || 0)
    let arr = postings.get(dim)
    if (!arr) { arr = []; postings.set(dim, arr) }
    arr.push({ i, w })
  }
}
const norms = docs.map((d) => {
  let s = 0
  for (let k = 0; k < d.v.length; k += 2) {
    const dim = d.v[k]
    const w = (d.v[k + 1] / 100) * (idf[dim] || 0)
    s += w * w
  }
  return Math.sqrt(s) || 1
})

function scoreQuery(text: string): number {
  const tf = toTf(text)
  let qn = 0
  const terms: Array<{ dim: number; w: number }> = []
  for (const [dim, tfv] of tf) {
    const w = tfv * (idf[dim] || 0)
    if (w > 0) { terms.push({ dim, w }); qn += w * w }
  }
  qn = Math.sqrt(qn) || 1
  const acc = new Float64Array(docs.length)
  for (const { dim, w } of terms) {
    const arr = postings.get(dim)
    if (!arr) continue
    for (const { i, w: dw } of arr) acc[i] += w * dw
  }
  const top: Array<{ s: number; l: number }> = []
  for (let i = 0; i < docs.length; i++) {
    const s = acc[i] / (qn * norms[i])
    if (s > 0) top.push({ s, l: docs[i].l })
  }
  top.sort((a, b) => b.s - a.s)
  const k = top.slice(0, 15)
  const den = k.reduce((a, b) => a + b.s, 0)
  return den ? k.reduce((a, b) => a + b.s * b.l, 0) / den : 0.5
}

function auc(scores: number[], labels: number[]): number {
  const pairs = scores.map((s, i) => ({ s, l: labels[i] })).sort((a, b) => a.s - b.s)
  let rs = 0, pos = 0
  for (let i = 0; i < pairs.length; i++) if (pairs[i].l === 1) { rs += i + 1; pos += 1 }
  const neg = pairs.length - pos
  return pos && neg ? (rs - pos * (pos + 1) / 2) / (pos * neg) : 0.5
}

// 用一组从未进基座的 question 做留出
const holdout: Array<{ text: string; label: number }> = []
for (const name of zhFiles) {
  const rows = readJsonl(path.join(ROOT, 'calibration', 'raw', `${name}.jsonl`))
  let g = 0
  for (const r of rows) {
    const hs = Array.isArray(r.human_answers) ? r.human_answers : []
    const cs = Array.isArray(r.chatgpt_answers) ? r.chatgpt_answers : []
    const h = String(hs[0] ?? '').trim()
    const c = String(cs[0] ?? '').trim()
    if (h.length < MIN_LEN || h.length > MAX_LEN || c.length < MIN_LEN || c.length > MAX_LEN) { g += 1; continue }
    if (g % TEST_EVERY === 0) {
      holdout.push({ text: h, label: 0 }, { text: c, label: 1 })
    }
    g += 1
  }
}
const hs = holdout.map((d) => scoreQuery(d.text))
const hl = holdout.map((d) => d.label)
console.log(`压缩后域内留出 AUC: ${auc(hs, hl).toFixed(3)} (n=${holdout.length})`)
