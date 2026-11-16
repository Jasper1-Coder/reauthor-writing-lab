/**
 * 语料基座 + 向量检索 可行性实验（第一性原理验证）
 *
 * 问题：不跑任何生成式 AI 模型，只用「更大的信息基座 + 最近邻向量检索」
 *       能否给出"像不像已知 AI 文本"的信号？
 *
 * 方法：
 *  - 基座：HC3 中文真实 human 答案 vs ChatGPT 答案配对（按 question 分组）
 *  - 向量化：字符 bigram 特征哈希 + TF-IDF（纯确定性、零模型、浏览器可跑）
 *  - 检索：余弦相似度 topK，按同源 question 排除（防话题泄漏，只测写作风格）
 *  - 分数 = 最近邻中 AI 标签的加权占比
 *
 * 对抗性审查：同时测域内留出（HC3）与跨域（真实学术摘要），两者都如实报告。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DIMS = 1 << 13 // 8192
const TOPK = 15
const MAX_GROUPS_PER_FILE = 700
const MIN_LEN = 150
const MAX_LEN = 2200
const TEST_EVERY = 6 // 每 6 组取 1 组做留出测试

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

interface Doc {
  gid: number
  label: number // 0 human, 1 ai
  tf: Map<number, number>
  norm: number
}

function readJsonl(file: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line) } catch { return {} }
  })
}

const zhFiles = ['zh_baike', 'zh_finance', 'zh_law', 'zh_medicine', 'zh_open_qa', 'zh_psychology']
const groups: Array<{ gid: number; test: boolean; docs: Array<{ label: number; text: string }> }> = []
let gid = 0

for (const name of zhFiles) {
  const rows = readJsonl(path.join(ROOT, 'calibration', 'raw', `${name}.jsonl`))
  let taken = 0
  for (let i = 0; i < rows.length && taken < MAX_GROUPS_PER_FILE; i++) {
    const r = rows[i]
    const hs = Array.isArray(r.human_answers) ? r.human_answers : []
    const cs = Array.isArray(r.chatgpt_answers) ? r.chatgpt_answers : []
    const h = String(hs[0] ?? '').trim()
    const c = String(cs[0] ?? '').trim()
    if (h.length < MIN_LEN || h.length > MAX_LEN || c.length < MIN_LEN || c.length > MAX_LEN) continue
    groups.push({
      gid,
      test: gid % TEST_EVERY === 0,
      docs: [{ label: 0, text: h }, { label: 1, text: c }],
    })
    gid += 1
    taken += 1
  }
}

const baseDocs: Doc[] = []
const testDocs: Doc[] = []
const df = new Map<number, number>()

function makeDoc(g: number, label: number, text: string): Doc {
  const tf = toTf(text)
  let norm = 0
  for (const v of tf.values()) norm += v * v
  return { gid: g, label, tf, norm: Math.sqrt(norm) }
}

for (const g of groups) {
  for (const d of g.docs) {
    const doc = makeDoc(g.gid, d.label, d.text)
    ;(g.test ? testDocs : baseDocs).push(doc)
    if (!g.test) for (const dim of doc.tf.keys()) df.set(dim, (df.get(dim) ?? 0) + 1)
  }
}

const N = baseDocs.length
const idf = new Map<number, number>()
for (const [dim, n] of df) idf.set(dim, Math.log((N + 1) / (n + 1)) + 1)

// 倒排索引：dim -> [{ docIdx, w }]
const inverted = new Map<number, Array<{ i: number; w: number }>>()
for (let i = 0; i < baseDocs.length; i++) {
  const doc = baseDocs[i]
  for (const [dim, tf] of doc.tf) {
    const w = tf * (idf.get(dim) ?? 1)
    let arr = inverted.get(dim)
    if (!arr) { arr = []; inverted.set(dim, arr) }
    arr.push({ i, w })
  }
}

function retrievalScore(query: Doc, excludeGid: number | null): number {
  const acc = new Float64Array(baseDocs.length)
  let qNorm = 0
  const qTerms: Array<{ w: number; dim: number }> = []
  for (const [dim, tf] of query.tf) {
    const w = tf * (idf.get(dim) ?? 1)
    qTerms.push({ w, dim })
    qNorm += w * w
  }
  qNorm = Math.sqrt(qNorm)
  for (const { w: qw, dim } of qTerms) {
    const arr = inverted.get(dim)
    if (!arr) continue
    for (const { i, w: dw } of arr) {
      if (excludeGid !== null && baseDocs[i].gid === excludeGid) continue
      acc[i] += qw * dw
    }
  }
  const scored: Array<{ s: number; label: number }> = []
  for (let i = 0; i < baseDocs.length; i++) {
    const s = acc[i] / (qNorm * baseDocs[i].norm || 1)
    if (s > 0) scored.push({ s, label: baseDocs[i].label })
  }
  scored.sort((a, b) => b.s - a.s)
  const top = scored.slice(0, TOPK)
  const denom = top.reduce((a, b) => a + b.s, 0)
  if (denom === 0) return 0.5
  return top.reduce((a, b) => a + b.s * b.label, 0) / denom
}

function auc(scores: number[], labels: number[]): number {
  const pairs = scores.map((s, i) => ({ s, l: labels[i] })).sort((a, b) => a.s - b.s)
  let rankSum = 0
  let pos = 0
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].l === 1) { rankSum += i + 1; pos += 1 }
  }
  const neg = pairs.length - pos
  if (pos === 0 || neg === 0) return 0.5
  return (rankSum - pos * (pos + 1) / 2) / (pos * neg)
}

function metrics(scores: number[], labels: number[]) {
  const a = auc(scores, labels)
  const hs = scores.filter((_, i) => labels[i] === 0)
  const as = scores.filter((_, i) => labels[i] === 1)
  const mean = (x: number[]) => x.reduce((p, c) => p + c, 0) / (x.length || 1)
  return {
    auc: Number(a.toFixed(3)),
    humanMean: Number(mean(hs).toFixed(3)),
    aiMean: Number(mean(as).toFixed(3)),
    n: labels.length,
  }
}

console.log(`基座文档 ${baseDocs.length} 条 / 留出测试 ${testDocs.length} 条 / 维度 ${DIMS}`)

// ---- 域内留出（排除同源 question）----
const intraScores = testDocs.map((d) => retrievalScore(d, d.gid))
const intraLabels = testDocs.map((d) => d.label)
console.log('域内留出(HC3):', JSON.stringify(metrics(intraScores, intraLabels)))

// ---- 跨域：真实学术摘要 v0(人写) vs v8(AI改写) ----
const academic = readJsonl(path.join(ROOT, 'crossdomain', 'academic_zh.jsonl'))
  .filter((r) => typeof r.text === 'string' && r.text.length > 0)
const crossScores = academic.map((r) => retrievalScore(makeDoc(-1, Number(r.label), String(r.text)), null))
const crossLabels = academic.map((r) => Number(r.label))
console.log('跨域学术摘要:', JSON.stringify(metrics(crossScores, crossLabels)))

// ---- 对照：随机基线 ----
console.log('随机基线 AUC ≈ 0.500')
