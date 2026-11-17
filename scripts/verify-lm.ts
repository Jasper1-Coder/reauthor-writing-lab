/**
 * 独立复算：只读导出的 public/lm-char2.bin，重算留出集 AUC。
 *
 * 这个脚本故意**不复用** src/lib/lmChannel.ts 的解析代码，而是自己按格式重新读一遍，
 * 目的是抓「训练时 AUC 很好看、上线产物却是坏的」这类最隐蔽的问题。
 * 若两边数字对不上，说明导出或解析有错位。
 *
 * 用法：npx tsx scripts/verify-lm.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { DEQUANT, LM_MASK, LM_W2, LM_W1, bigramBucket, normalizeLm } from '../src/lib/lmText'

const ROOT = process.cwd()
// --modern 验证现代方言产物（各有一套留出集，不能混用）
const MODERN = process.argv.includes('--modern')
const SUFFIX = MODERN ? '-modern' : ''
const BIN = path.join(ROOT, 'public', `lm-char2${SUFFIX}.bin`)
const HOLDOUT = path.join(ROOT, 'calibration', 'lm', `holdout${SUFFIX}.jsonl`)
const META = path.join(ROOT, 'src', 'data', `lmModel${MODERN ? 'Modern' : ''}.json`)
const VALID = path.join(ROOT, 'src', 'data', `lmValidation${MODERN ? 'Modern' : ''}.json`)
console.log(`验证方言：${MODERN ? '现代模型（2025–26）' : '2023 ChatGPT'} → lm-char2${SUFFIX}.bin`)

interface Parsed { index: Map<number, number>; unigram: Float32Array; table: Uint8Array; total: number }

function parse(buf: Buffer, offset: number, vocab: number, total: number): { m: Parsed; next: number } {
  const index = new Map<number, number>()
  const unigram = new Float32Array(vocab)
  const codes = new Array<number>(vocab)
  let p = offset
  for (let i = 0; i < vocab; i++) { codes[i] = buf.readUInt32LE(p); p += 4 }
  for (let i = 0; i < vocab; i++) { unigram[i] = buf.readUInt32LE(p); p += 4 }
  const table = new Uint8Array(buf.subarray(p, p + (1 << buf.readUInt8(7))))
  p += 1 << buf.readUInt8(7)
  codes.forEach((c, i) => index.set(c, i))
  return { m: { index, unigram, table, total }, next: p }
}

const meta = JSON.parse(fs.readFileSync(META, 'utf-8'))
const valid = JSON.parse(fs.readFileSync(VALID, 'utf-8'))
const buf = fs.readFileSync(BIN)
if (buf.toString('ascii', 0, 4) !== 'RALM') throw new Error('magic 不匹配，产物损坏')
const vocabH = buf.readUInt32LE(8)
const vocabA = buf.readUInt32LE(12)
const tableSize = buf.readUInt32LE(16)
if (tableSize !== (1 << buf.readUInt8(7))) throw new Error('tableSize 与 header 的 bits 不一致')
const h = parse(buf, 24, vocabH, meta.models[0].chars)
const a = parse(buf, h.next, vocabA, meta.models[1].chars)
if (a.next !== buf.length) throw new Error(`解析后偏移 ${a.next} ≠ 文件长度 ${buf.length}，格式错位`)

function meanLogp(m: Parsed, text: string): number {
  const t = normalizeLm(text)
  if (t.length < 3) return -20
  let sum = 0
  let n = 0
  let prev = m.index.get(t.codePointAt(0) ?? 0) ?? -1
  for (let i = 1; i < t.length; i++) {
    const idx = m.index.get(t.codePointAt(i) ?? 0) ?? -1
    const u = idx >= 0 ? m.unigram[idx] : 0
    const p1 = u > 0 ? u / m.total : 1e-9
    let p2 = 0
    if (prev >= 0) {
      const q = m.table[bigramBucket(t[i - 1], t[i], LM_MASK)]
      const cnt = DEQUANT[q]
      if (cnt >= 1 && m.unigram[prev] > 0) p2 = cnt / m.unigram[prev]
    }
    sum += Math.log2(Math.max(LM_W2 * p2 + LM_W1 * p1, 1e-9))
    n++
    prev = idx
  }
  return sum / n
}

function auc(scores: number[], labels: number[]): number {
  const idx = scores.map((_, i) => i).sort((x, y) => scores[x] - scores[y])
  const ranks = new Array(scores.length).fill(0)
  let i = 0
  while (i < idx.length) {
    let j = i
    while (j + 1 < idx.length && scores[idx[j + 1]] === scores[idx[i]]) j++
    const r = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) ranks[idx[k]] = r
    i = j + 1
  }
  let pos = 0, neg = 0, sumPos = 0
  for (let k = 0; k < labels.length; k++) {
    if (labels[k] === 1) { pos++; sumPos += ranks[k] } else neg++
  }
  return pos && neg ? (sumPos - (pos * (pos + 1)) / 2) / (pos * neg) : 0.5
}

if (!fs.existsSync(HOLDOUT)) {
  console.log('缺少 calibration/lm/holdout.jsonl，请先运行 npx tsx scripts/train-lm.ts')
  process.exit(1)
}

const rows = fs.readFileSync(HOLDOUT, 'utf-8').trim().split('\n').filter(Boolean)
  .map((l) => JSON.parse(l) as { id: string; group?: string; label: number; domain: string; text: string })

/**
 * 切分自检（v0.13.0 红队审计后补）：训练脚本落盘了 train.jsonl，
 * 这里直接对账 group 是否真的不重叠。只信 split.json 的自述是不够的。
 */
const TRAIN = path.join(ROOT, 'calibration', 'lm', `train${SUFFIX}.jsonl`)
if (fs.existsSync(TRAIN)) {
  const trainGroups = new Set<string>()
  const trainIds = new Set<string>()
  fs.readFileSync(TRAIN, 'utf-8').trim().split('\n').filter(Boolean).forEach((l) => {
    const r = JSON.parse(l) as { id: string; group?: string }
    if (r.group) trainGroups.add(r.group)
    trainIds.add(r.id)
  })
  const sharedGroups = rows.filter((r) => r.group && trainGroups.has(r.group)).length
  const sharedIds = rows.filter((r) => trainIds.has(r.id)).length
  console.log(`切分对账：训练 ${trainIds.size} 篇 / 留出 ${rows.length} 篇`)
  console.log(`  group 跨集 = ${sharedGroups} ${sharedGroups === 0 ? '✅' : '❌ 存在泄漏'}；id 重复 = ${sharedIds} ${sharedIds === 0 ? '✅' : '❌'}`)
  if (sharedGroups !== 0 || sharedIds !== 0) process.exit(1)
} else {
  console.log('提示：缺少 calibration/lm/train.jsonl，跳过切分对账（旧版训练脚本不落盘训练集）')
}

const deltas: number[] = []
const labels: number[] = []
const byDomain = new Map<string, { d: number[]; l: number[] }>()
for (const r of rows) {
  const d = meanLogp(a.m, r.text) - meanLogp(h.m, r.text)
  deltas.push(d)
  labels.push(r.label)
  if (!byDomain.has(r.domain)) byDomain.set(r.domain, { d: [], l: [] })
  byDomain.get(r.domain)!.d.push(d)
  byDomain.get(r.domain)!.l.push(r.label)
}

const recomputed = auc(deltas, labels)
const reported = valid.inDomain.holdoutAuc
const diff = Math.abs(recomputed - reported)

// 阈值 50 的灵敏度/特异度（用导出产物里的标定参数复算）
const cal = meta.calibration
const score = (d: number) => 100 / (1 + Math.exp(-(cal.a * ((d - cal.mean) / cal.std) + cal.b)))
let tp = 0, fn = 0, tn = 0, fp = 0
deltas.forEach((d, i) => {
  const pred = score(d) >= 50 ? 1 : 0
  if (labels[i] === 1) {
    if (pred === 1) tp++
    else fn++
  } else if (pred === 1) {
    fp++
  } else {
    tn++
  }
})

console.log(`产物：${(buf.length / 1e6).toFixed(2)}MB，vocab ${vocabH}/${vocabA}，表 ${tableSize}`)
console.log(`留出集 ${rows.length} 篇（AI ${labels.filter((x) => x === 1).length} / 真人 ${labels.filter((x) => x === 0).length}）`)
console.log(`\n复算 AUC      = ${recomputed.toFixed(4)}`)
console.log(`训练期报告 AUC = ${reported.toFixed(4)}`)
console.log(`差值           = ${diff.toFixed(4)} ${diff < 0.002 ? '✅ 一致' : '❌ 不一致，产物或解析有问题'}`)
console.log(`阈值50 复算：灵敏度 ${(tp / (tp + fn) * 100).toFixed(1)}% / 特异度 ${(tn / (tn + fp) * 100).toFixed(1)}%（报告 ${(valid.inDomain.atThreshold50.sensitivity * 100).toFixed(1)}% / ${(valid.inDomain.atThreshold50.specificity * 100).toFixed(1)}%）`)
console.log('\n分域复算：')
for (const [dom, v] of [...byDomain].sort()) {
  const ai = v.l.filter((x) => x === 1).length
  if (ai < 10 || v.l.length - ai < 10) continue
  console.log(`  ${dom.padEnd(18)} n=${String(v.l.length).padStart(5)} AUC=${auc(v.d, v.l).toFixed(3)}`)
}
if (diff >= 0.002) process.exit(1)
