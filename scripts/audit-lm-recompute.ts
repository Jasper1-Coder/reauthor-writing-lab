/**
 * 对抗性审计 #1：完全独立地从 public/lm-char2.bin 复算留出集指标。
 *
 * 与 scripts/verify-lm.ts 的区别：这里**不 import 任何 src/lib 代码**，
 * 归一化、FNV-1a 哈希、桶函数、反量化、插值、AUC 全部自己重写一遍。
 * AUC 也用与训练脚本不同的算法（ROC 梯形积分，而非秩和公式），
 * 这样任何一处口径漂移都会以数字差异的形式暴露出来。
 *
 * 用法：npx tsx scripts/audit-lm-recompute.ts
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const BIN = path.join(ROOT, 'public', 'lm-char2.bin')
const HOLDOUT = path.join(ROOT, 'calibration', 'lm', 'holdout.jsonl')
const META = path.join(ROOT, 'src', 'data', 'lmModel.json')
const VALID = path.join(ROOT, 'src', 'data', 'lmValidation.json')
const ACA = path.join(ROOT, 'crossdomain', 'academic_zh.jsonl')

// ---------------- 归一化（独立实现，规则照文档描述） ----------------
const KEEP_PUNCT = ',.!?;:，。！？；：、（）()“”"\'‘’'

function normalize(text: string): string {
  const out: string[] = []
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)) out.push(ch)
    else if (c >= 0x61 && c <= 0x7a) out.push(ch)
    else if (c >= 0x41 && c <= 0x5a) out.push(ch.toLowerCase())
    else if (c >= 0x30 && c <= 0x39) out.push(ch)
    else if (KEEP_PUNCT.includes(ch)) out.push(ch)
    else if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') out.push(' ')
  }
  return out.join('').replace(/ +/g, ' ').trim()
}

// ---------------- FNV-1a + 桶 ----------------
function fnv(ch: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0
  for (let i = 0; i < ch.length; i++) {
    h = (h ^ ch.charCodeAt(i)) >>> 0
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

// ---------------- 二进制解析（DataView，按头自描述，不依赖外部常量） ----------------
interface LM { index: Int32Array; uniSize: Float64Array; table: Uint8Array; total: number }

function readModel(buf: Buffer, offset: number, vocab: number, total: number): { lm: LM; next: number } {
  let p = offset
  const codepoints = new Uint32Array(vocab)
  for (let i = 0; i < vocab; i++) { codepoints[i] = buf.readUInt32LE(p); p += 4 }
  const uni = new Float64Array(vocab)
  for (let i = 0; i < vocab; i++) { uni[i] = buf.readUInt32LE(p); p += 4 }
  const tableBytes = buf.readUInt32LE(16) // 头部声明的 tableSize
  const table = new Uint8Array(buf.subarray(p, p + tableBytes))
  p += tableBytes
  const index = new Int32Array(0x110000).fill(-1)
  for (let i = 0; i < vocab; i++) index[codepoints[i]] = i
  return { lm: { index, uniSize: uni, table, total }, next: p }
}

const DEQ = (() => {
  const t = new Float64Array(256)
  for (let q = 0; q < 256; q++) t[q] = q === 0 ? 0 : Math.pow(2, q / 10) - 1
  return t
})()

function bucket(prev: string, cur: string, mask: number): number {
  return ((fnv(cur, 7) ^ fnv(prev, 13)) >>> 0) & mask
}

const W2 = 0.8, W1 = 0.2
const MASK = (1 << 19) - 1

function meanLogp(m: LM, text: string): number {
  const t = normalize(text)
  const chars = [...t]
  if (chars.length < 3) return -20
  let sum = 0, n = 0
  let prev = m.index[chars[0].codePointAt(0)!] ?? -1
  let prevCh = chars[0]
  for (let i = 1; i < chars.length; i++) {
    const cur = chars[i]
    const idx = m.index[cur.codePointAt(0)!]
    const u = idx >= 0 ? m.uniSize[idx] : 0
    const p1 = u > 0 ? u / m.total : 1e-9
    let p2 = 0
    if (prev >= 0) {
      const cnt = DEQ[m.table[bucket(prevCh, cur, MASK)]]
      const ctx = m.uniSize[prev]
      if (cnt >= 1 && ctx > 0) p2 = cnt / ctx
    }
    sum += Math.log2(Math.max(W2 * p2 + W1 * p1, 1e-9))
    n++
    prev = idx
    prevCh = cur
  }
  return sum / n
}

// ---------------- AUC：ROC 梯形积分（与秩和公式不同的实现） ----------------
function aucRoc(scores: number[], labels: number[]): number {
  const n = scores.length
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => scores[b] - scores[a])
  const P = labels.filter((x) => x === 1).length
  const N = n - P
  if (!P || !N) return 0.5
  let tp = 0, fp = 0, prevTp = 0, prevFp = 0, area = 0
  let i = 0
  while (i < n) {
    const s = scores[order[i]]
    let j = i
    while (j < n && scores[order[j]] === s) {
      if (labels[order[j]] === 1) tp++
      else fp++
      j++
    }
    area += ((fp - prevFp) * (tp + prevTp)) / 2
    prevTp = tp
    prevFp = fp
    i = j
  }
  return area / (P * N)
}

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l) as T } catch { return null as unknown as T }
  }).filter(Boolean)
}

// ---------------- 主流程 ----------------
const meta = JSON.parse(fs.readFileSync(META, 'utf-8'))
const valid = JSON.parse(fs.readFileSync(VALID, 'utf-8'))
const buf = fs.readFileSync(BIN)

const magic = buf.toString('ascii', 0, 4)
const version = buf.readUInt16LE(4)
const order = buf.readUInt8(6)
const bits = buf.readUInt8(7)
const vocabH = buf.readUInt32LE(8)
const vocabA = buf.readUInt32LE(12)
const declaredTable = buf.readUInt32LE(16)
const reserved = buf.readUInt32LE(20)

console.log('=== 二进制头 ===')
console.log(`magic=${magic} version=${version} order=${order} bits=${bits} vocabH=${vocabH} vocabA=${vocabA} table=${declaredTable} reserved=${reserved}`)
console.log(`文件大小=${buf.length}  期望=${24 + (vocabH + vocabA) * 8 + 2 * declaredTable}  ${buf.length === 24 + (vocabH + vocabA) * 8 + 2 * declaredTable ? '✅' : '❌'}`)
if (magic !== 'RALM') throw new Error('magic 损坏')

const H = readModel(buf, 24, vocabH, meta.models[0].chars)
const A = readModel(buf, H.next, vocabA, meta.models[1].chars)
console.log(`解析结束偏移=${A.next} / ${buf.length} ${A.next === buf.length ? '✅ 无错位' : '❌ 错位'}`)

const rows = readJsonl<{ id: string; label: number; domain: string; text: string }>(HOLDOUT)
console.log(`\n=== 留出集 ===\n${rows.length} 篇，AI ${rows.filter((r) => r.label === 1).length} / 真人 ${rows.filter((r) => r.label === 0).length}`)

const cal = meta.calibration
const scoreOf = (d: number) => 100 / (1 + Math.exp(-(cal.a * ((d - cal.mean) / cal.std) + cal.b)))

const deltas: number[] = []
const labels: number[] = []
const byDom = new Map<string, { d: number[]; l: number[]; len: number[] }>()
const t0 = Date.now()
for (const r of rows) {
  const d = meanLogp(A.lm, r.text) - meanLogp(H.lm, r.text)
  deltas.push(d)
  labels.push(r.label)
  if (!byDom.has(r.domain)) byDom.set(r.domain, { d: [], l: [], len: [] })
  const b = byDom.get(r.domain)!
  b.d.push(d); b.l.push(r.label); b.len.push([...normalize(r.text)].length)
}
console.log(`打分耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)

const mine = aucRoc(deltas, labels)
const rep = valid.inDomain.holdoutAuc
console.log(`\n=== 复算 vs 报告 ===`)
console.log(`独立复算 AUC = ${mine.toFixed(4)}`)
console.log(`报告（3 位小数）= ${rep.toFixed(3)}；差 = ${Math.abs(mine - rep).toFixed(4)} ${Math.abs(mine - rep) < 0.002 ? '✅ 一致' : '❌ 重大不一致'}`)

let tp = 0, fn = 0, tn = 0, fp = 0
const scores = deltas.map(scoreOf)
scores.forEach((s, i) => {
  const pred = s >= 50 ? 1 : 0
  if (labels[i] === 1) {
    if (pred === 1) tp++
    else fn++
  } else if (pred === 1) {
    fp++
  } else {
    tn++
  }
})
console.log(`阈值 50：灵敏度 ${(tp / (tp + fn) * 100).toFixed(1)}%（报告 ${(valid.inDomain.atThreshold50.sensitivity * 100).toFixed(1)}%）/ 特异度 ${(tn / (tn + fp) * 100).toFixed(1)}%（报告 ${(valid.inDomain.atThreshold50.specificity * 100).toFixed(1)}%）`)

const meanScore = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length
const aiScores = scores.filter((_, i) => labels[i] === 1)
const huScores = scores.filter((_, i) => labels[i] === 0)
console.log(`分数均值：AI ${meanScore(aiScores).toFixed(1)} / 真人 ${meanScore(huScores).toFixed(1)}`)
console.log(`AI 中被判 <50 的比例（漏检）= ${(aiScores.filter((s) => s < 50).length / aiScores.length * 100).toFixed(1)}%`)
console.log(`真人中被判 ≥50 的比例（误伤）= ${(huScores.filter((s) => s >= 50).length / huScores.length * 100).toFixed(1)}%`)

console.log('\n=== 分域复算 ===')
const domAucs: number[] = []
for (const [dom, v] of [...byDom].sort()) {
  const ai = v.l.filter((x) => x === 1).length
  const hu = v.l.length - ai
  if (ai < 10 || hu < 10) continue
  const a = aucRoc(v.d, v.l)
  domAucs.push(a)
  const sc = v.d.map(scoreOf)
  const aiSc = sc.filter((_, i) => v.l[i] === 1)
  const huSc = sc.filter((_, i) => v.l[i] === 0)
  console.log(`  ${dom.padEnd(18)} n=${String(v.l.length).padStart(5)} AUC=${a.toFixed(3)}  均分 AI ${meanScore(aiSc).toFixed(0).padStart(3)} / 真人 ${meanScore(huSc).toFixed(0).padStart(3)}  并列率=${(1 - new Set(v.d).size / v.d.length).toFixed(2)}`)
}
console.log(`宏平均 = ${(domAucs.reduce((a, b) => a + b, 0) / domAucs.length).toFixed(3)}（报告 ${valid.inDomain.macroAucOverDomains}）`)

// ---------------- 跨域：中文学术摘要 ----------------
const aca = readJsonl<{ label: number; text: string }>(ACA).filter((r) => typeof r.text === 'string' && r.text.length >= 120)
if (aca.length) {
  const ds = aca.map((r) => meanLogp(A.lm, r.text) - meanLogp(H.lm, r.text))
  const ls = aca.map((r) => (Number(r.label) === 1 ? 1 : 0))
  const sc = ds.map(scoreOf)
  console.log(`\n=== 跨域（中文学术摘要）===`)
  console.log(`n=${ls.length}（AI ${ls.filter((x) => x === 1).length}/真人 ${ls.filter((x) => x === 0).length}）AUC=${aucRoc(ds, ls).toFixed(4)}（报告 ${valid.crossDomain.auc.toFixed(4)}）`)
  console.log(`分数区间 ${Math.round(Math.min(...sc))}–${Math.round(Math.max(...sc))}，均分 ${meanScore(sc).toFixed(1)}；≥50 占 ${(sc.filter((s) => s >= 50).length / sc.length * 100).toFixed(0)}%`)
}

// ---------------- 泄漏 / 垃圾模板 对指标的影响 ----------------
const LEAK_IDS = path.join(ROOT, 'calibration', 'lm', 'audit-leak-ids.json')
const JUNK = /(network error|authentication token has expired|too many requests|error generating a response)/i
const junkIdx = rows.map((r, i) => (JUNK.test(r.text) ? i : -1)).filter((i) => i >= 0)
console.log(`\n=== 语料污染与泄漏的影响 ===`)
console.log(`留出集中「API 报错模板」文本（应属脏数据，不是 AI 文风）: ${junkIdx.length} 篇，全部 label=${[...new Set(junkIdx.map((i) => labels[i]))].join(',')}`)
console.log(`这些文本在 AI 模型训练集里也有 → 模型靠模板记住它们，而不是靠文风：`)
junkIdx.slice(0, 3).forEach((i) => console.log(`  「${rows[i].text.slice(0, 60).replace(/\n/g, ' ')}」→ 分数 ${scores[i].toFixed(0)}`))

const keep = (pred: (i: number) => boolean) => {
  const idx = rows.map((_, i) => i).filter(pred)
  return { d: idx.map((i) => deltas[i]), l: idx.map((i) => labels[i]) }
}
const clean = keep((i) => !JUNK.test(rows[i].text))
console.log(`剔除报错模板后：n=${clean.l.length}，AUC=${aucRoc(clean.d, clean.l).toFixed(4)}（原 ${mine.toFixed(4)}）`)

if (fs.existsSync(LEAK_IDS)) {
  const leaked = new Set(JSON.parse(fs.readFileSync(LEAK_IDS, 'utf-8')) as string[])
  const noLeak = keep((i) => !leaked.has(rows[i].id))
  console.log(`剔除「训练集内存在近重复」的留出文档后：n=${noLeak.l.length}，AUC=${aucRoc(noLeak.d, noLeak.l).toFixed(4)}（原 ${mine.toFixed(4)}）`)
  const both = keep((i) => !leaked.has(rows[i].id) && !JUNK.test(rows[i].text))
  console.log(`两者都剔除：n=${both.l.length}，AUC=${aucRoc(both.d, both.l).toFixed(4)}`)
  for (const dom of ['zh_finance', 'reddit_eli5', 'zh_baike', 'wiki_csai']) {
    const idx = rows.map((_, i) => i).filter((i) => rows[i].domain === dom)
    const idxNoLeak = idx.filter((i) => !leaked.has(rows[i].id) && !JUNK.test(rows[i].text))
    const a0 = aucRoc(idx.map((i) => deltas[i]), idx.map((i) => labels[i]))
    const a1 = aucRoc(idxNoLeak.map((i) => deltas[i]), idxNoLeak.map((i) => labels[i]))
    console.log(`  ${dom.padEnd(14)} n=${idx.length} AUC=${a0.toFixed(3)} → 去泄漏/垃圾后 n=${idxNoLeak.length} AUC=${a1.toFixed(3)}`)
  }
}

console.log('\n=== 单特征「格式」基线（不训练模型，只看表层符号）===')
console.log('若某域某个纯格式特征 AUC 接近 1.0，说明该域的高 AUC 可能来自排版差异而非文风。')
const features: Record<string, (t: string) => number> = {
  '长度': (t) => t.length,
  '换行数': (t) => (t.match(/\n/g) ?? []).length,
  '数字比例': (t) => (t.match(/[0-9]/g) ?? []).length / Math.max(1, t.length),
  'Markdown标记(**|#|- |1. )': (t) => (t.match(/\*\*|^#|^\s*[-*]\s|\n\d+\.\s/gm) ?? []).length,
  'URL数': (t) => (t.match(/https?:\/\//g) ?? []).length,
  '大写字母比例': (t) => (t.match(/[A-Z]/g) ?? []).length / Math.max(1, t.length),
  '标点比例': (t) => (t.match(/[,.;:!?，。；：！？]/g) ?? []).length / Math.max(1, t.length),
  '平均句长': (t) => t.length / Math.max(1, (t.match(/[。！？.!?\n]/g) ?? []).length),
}
for (const dom of ['reddit_eli5', 'zh_finance', 'zh_psychology', 'zh_medicine', 'open_qa']) {
  const v = byDom.get(dom)
  if (!v) continue
  const texts = rows.filter((r) => r.domain === dom)
  const line: string[] = []
  for (const [name, f] of Object.entries(features)) {
    const vals = texts.map((r) => f(r.text))
    const a = aucRoc(vals, v.l)
    line.push(`${name}=${Math.max(a, 1 - a).toFixed(3)}`)
  }
  console.log(`  ${dom.padEnd(16)} ${line.join('  ')}`)
}
