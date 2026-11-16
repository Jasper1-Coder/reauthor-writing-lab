/**
 * 索引瘦身调参：在保持域内 AUC 的前提下，找到最小可用配置。
 * 输出：文档数 × 每文档维度 × 片段长度 对 AUC 与 gzip 体积的影响。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const ROOT = process.cwd()
const MIN_LEN = 150, MAX_LEN = 2200, TEST_EVERY = 6

function bigrams(t: string) { const s = t.replace(/\s+/g, ''); const o: string[] = []; for (let i = 0; i < s.length - 1; i++) o.push(s.slice(i, i + 2)); return o }
function hash(s: string, dims: number) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return (h >>> 0) % dims }
function tfOf(text: string, dims: number) { const m = new Map<number, number>(); for (const g of bigrams(text)) { const d = hash(g, dims); m.set(d, (m.get(d) ?? 0) + 1) } for (const [d, c] of m) m.set(d, 1 + Math.log(c)); return m }
function read(f: string) { return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return {} } }) : [] }

const files = ['zh_baike', 'zh_finance', 'zh_law', 'zh_medicine', 'zh_open_qa', 'zh_psychology']
const pairs: Array<{ h: string; c: string }> = []
let gid = 0
for (const n of files) for (const r of read(path.join(ROOT, 'calibration', 'raw', `${n}.jsonl`))) {
  const hs = Array.isArray(r.human_answers) ? r.human_answers : [], cs = Array.isArray(r.chatgpt_answers) ? r.chatgpt_answers : []
  const h = String(hs[0] ?? '').trim(), c = String(cs[0] ?? '').trim()
  if (h.length < MIN_LEN || h.length > MAX_LEN || c.length < MIN_LEN || c.length > MAX_LEN) continue
  if (gid % TEST_EVERY !== 0) pairs.push({ h, c })
  gid += 1
}
const holdout: Array<{ t: string; l: number }> = []
for (const n of files) for (const r of read(path.join(ROOT, 'calibration', 'raw', `${n}.jsonl`))) {
  const hs = Array.isArray(r.human_answers) ? r.human_answers : [], cs = Array.isArray(r.chatgpt_answers) ? r.chatgpt_answers : []
  const h = String(hs[0] ?? '').trim(), c = String(cs[0] ?? '').trim()
  if (h.length < MIN_LEN || h.length > MAX_LEN || c.length < MIN_LEN || c.length > MAX_LEN) continue
  if (gid % TEST_EVERY === 0) holdout.push({ t: h, l: 0 }, { t: c, l: 1 })
  gid += 1
}

function run(dims: number, topK: number, maxDocs: number, excerptLen: number) {
  const docs = pairs.slice(0, maxDocs)
  const tfs = docs.flatMap((p) => [tfOf(p.h, dims), tfOf(p.c, dims)])
  const labels = docs.flatMap(() => [0, 1])
  const df = new Map<number, number>()
  for (const tf of tfs) for (const d of tf.keys()) df.set(d, (df.get(d) ?? 0) + 1)
  const N = tfs.length
  const idf = new Array(dims).fill(0)
  for (const [d, n] of df) idf[d] = Math.log((N + 1) / (n + 1)) + 1

  const vecs = tfs.map((tf) => { const v: number[] = []; for (const [d, w] of [...tf.entries()].sort((a, b) => b[1] - a[1]).slice(0, topK)) { const q = Math.round(w * 100); if (q) v.push(d, q) } return v })
  const excerpts = docs.flatMap((p) => [p.h, p.c]).map((t) => t.replace(/\s+/g, ' ').trim().slice(0, excerptLen))

  const postings = new Map<number, Array<{ i: number; w: number }>>()
  const norms = new Float64Array(N)
  for (let i = 0; i < N; i++) { let ns = 0; for (let k = 0; k < vecs[i].length; k += 2) { const d = vecs[i][k]; const w = (vecs[i][k + 1] / 100) * idf[d]; let a = postings.get(d); if (!a) { a = []; postings.set(d, a) } a.push({ i, w }); ns += w * w } norms[i] = Math.sqrt(ns) || 1 }
  function score(text: string) {
    const tf = tfOf(text, dims); const terms: Array<[number, number]> = []; let qn = 0
    for (const [d, w] of tf) { const x = w * idf[d]; if (x) { terms.push([d, x]); qn += x * x } }
    qn = Math.sqrt(qn) || 1; const acc = new Float64Array(N)
    for (const [d, w] of terms) { const a = postings.get(d); if (a) for (const { i, w: dw } of a) acc[i] += w * dw }
    const top: Array<{ s: number; l: number }> = []
    for (let i = 0; i < N; i++) { const s = acc[i] / (qn * norms[i]); if (s > 0) top.push({ s, l: labels[i] }) }
    top.sort((a, b) => b.s - a.s); const k = top.slice(0, 15); const den = k.reduce((a, b) => a + b.s, 0)
    return den ? k.reduce((a, b) => a + b.s * b.l, 0) / den : 0.5
  }
  const scores = holdout.map((h) => score(h.t))
  const pr = scores.map((s, i) => ({ s, l: holdout[i].l })).sort((a, b) => a.s - b.s)
  let rs = 0, pos = 0; for (let i = 0; i < pr.length; i++) if (pr[i].l === 1) { rs += i + 1; pos++ }
  const neg = pr.length - pos; const auc = pos && neg ? (rs - pos * (pos + 1) / 2) / (pos * neg) : 0.5

  const core = JSON.stringify({ dims, docCount: N, idf: idf.map((x) => +x.toFixed(3)), labels, docs: vecs })
  const coreGz = zlib.gzipSync(Buffer.from(core)).length / 1024
  const exGz = zlib.gzipSync(Buffer.from(JSON.stringify(excerpts))).length / 1024
  return { cfg: `${dims}维/${maxDocs}组/${topK}特征/${excerptLen}字`, auc: auc.toFixed(3), n: N, coreKB: coreGz.toFixed(0), exKB: exGz.toFixed(0), totalKB: (coreGz + exGz).toFixed(0) }
}

console.log('配置'.padEnd(30), 'AUC', '文档', '核心KB', '片段KB', '合计KB')
for (const c of [
  [4096, 128, 6010, 90],  // 现状
  [4096, 64, 6010, 60],
  [4096, 48, 4500, 50],
  [2048, 64, 4500, 50],
  [2048, 48, 3500, 40],
] as const) {
  const r = run(...c)
  console.log(r.cfg.padEnd(30), r.auc, String(r.n).padEnd(6), r.coreKB.padEnd(7), r.exKB.padEnd(7), r.totalKB)
}
