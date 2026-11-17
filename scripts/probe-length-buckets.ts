/**
 * 按「文本长度」切桶，测当前产物在短文本上到底还剩多少判别力。
 *
 * 起因：探针里 6 段手写学生文本 5 段被判 0–2 分，4 段 AI 腔也只在 3–38 分。
 * 这有两种完全不同的解释，修法也完全不同：
 *   A. 判别力还在，只是**标定（calibration）塌了** → 改标定就能用。
 *   B. 判别力在短文本上本来就没有 → 改标定没用，必须换特征/换语料。
 *
 * 判据：同一批留出集，按长度分桶后分别算 AUC。
 *   短桶 AUC 仍显著 > 0.5 → 是 A，模型能分，只是分数被压扁。
 *   短桶 AUC ≈ 0.5      → 是 B，别在标定上浪费时间。
 *
 * 用法：npx tsx scripts/probe-length-buckets.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { DEQUANT, LM_MASK, LM_W2, LM_W1, bigramBucket, normalizeLm } from '../src/lib/lmText'

const ROOT = process.cwd()
const BIN = path.join(ROOT, 'public', 'lm-char2.bin')
const HOLDOUT = path.join(ROOT, 'calibration', 'lm', 'holdout.jsonl')
const META = path.join(ROOT, 'src', 'data', 'lmModel.json')

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
const buf = fs.readFileSync(BIN)
const vocabH = buf.readUInt32LE(8)
const vocabA = buf.readUInt32LE(12)
const hParsed = parse(buf, 24, vocabH, meta.models[0].chars)
const aParsed = parse(buf, hParsed.next, vocabA, meta.models[1].chars)
const h = hParsed.m
const a = aParsed.m

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
  return pos && neg ? (sumPos - (pos * (pos + 1)) / 2) / (pos * neg) : NaN
}

const q = (arr: number[], p: number) => {
  if (!arr.length) return NaN
  const s = [...arr].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]
}

if (!fs.existsSync(HOLDOUT)) {
  console.log('缺少 calibration/lm/holdout.jsonl，请先运行 npx tsx scripts/train-lm.ts')
  process.exit(1)
}

const rows = fs.readFileSync(HOLDOUT, 'utf-8').trim().split('\n').filter(Boolean)
  .map((l) => JSON.parse(l) as { label: number; domain: string; text: string })

const cal = meta.calibration
const score = (d: number) => 100 / (1 + Math.exp(-(cal.a * ((d - cal.mean) / cal.std) + cal.b)))

const BUCKETS: Array<{ name: string; lo: number; hi: number }> = [
  { name: '同类问题：学生长度（<200 字）', lo: 0, hi: 200 },
  { name: '短篇（200–400 字）', lo: 200, hi: 400 },
  { name: '中篇（400–800 字）', lo: 400, hi: 800 },
  { name: '长篇（800–1600 字）', lo: 800, hi: 1600 },
  { name: '超长（≥1600 字）', lo: 1600, hi: Infinity },
]

console.log(`产物 ${(buf.length / 1e6).toFixed(2)}MB；留出集 ${rows.length} 篇`)
console.log(`标定参数 mean=${cal.mean.toFixed(4)} std=${cal.std.toFixed(4)} a=${cal.a.toFixed(3)} b=${cal.b.toFixed(3)}\n`)
console.log('长度桶'.padEnd(30) + 'n'.padStart(6) + 'AI'.padStart(6) + '人'.padStart(6) +
  'AUC'.padStart(8) + '  真人分数 p50/p90    AI 分数 p50/p90   分数<5占比  阈值50命中')

const allD: number[] = []
const allL: number[] = []
for (const b of BUCKETS) {
  const sel = rows.filter((r) => r.text.length >= b.lo && r.text.length < b.hi)
  if (sel.length < 20) { console.log(b.name.padEnd(30) + String(sel.length).padStart(6) + '  样本不足'); continue }
  const ds = sel.map((r) => meanLogp(a, r.text) - meanLogp(h, r.text))
  const ls = sel.map((r) => r.label)
  allD.push(...ds); allL.push(...ls)
  const aucV = auc(ds, ls)
  const sc = ds.map(score)
  const human = sc.filter((_, i) => ls[i] === 0)
  const ai = sc.filter((_, i) => ls[i] === 1)
  const flat = sc.filter((s) => s < 5).length / sc.length
  const hit = ai.length ? ai.filter((s) => s >= 50).length / ai.length : NaN
  console.log(
    b.name.padEnd(30) + String(sel.length).padStart(6) + String(ai.length).padStart(6) + String(human.length).padStart(6) +
    aucV.toFixed(3).padStart(8) +
    `  ${q(human, 0.5).toFixed(0).padStart(3)}/${q(human, 0.9).toFixed(0).padStart(3)}` +
    `        ${q(ai, 0.5).toFixed(0).padStart(3)}/${q(ai, 0.9).toFixed(0).padStart(3)}` +
    `        ${(flat * 100).toFixed(1).padStart(5)}%` +
    `      ${(hit * 100).toFixed(1).padStart(5)}%`
  )
}

// 关键判决：短文本桶还有没有判别力
const short = rows.filter((r) => r.text.length < 400)
const shortD = short.map((r) => meanLogp(a, r.text) - meanLogp(h, r.text))
const shortL = short.map((r) => r.label)
const shortAuc = auc(shortD, shortL)
const shortScore = shortD.map(score)
const shortHuman = shortScore.filter((_, i) => shortL[i] === 0)
const shortAi = shortScore.filter((_, i) => shortL[i] === 1)

console.log(`\n=== 判决 ===`)
console.log(`<400 字：n=${short.length}（AI ${shortAi.length} / 人 ${shortHuman.length}），AUC=${shortAuc.toFixed(3)}`)
console.log(`  真人分数 p50=${q(shortHuman, 0.5).toFixed(1)} p90=${q(shortHuman, 0.9).toFixed(1)}`)
console.log(`  AI  分数 p50=${q(shortAi, 0.5).toFixed(1)} p90=${q(shortAi, 0.9).toFixed(1)}`)
console.log(`  判据：AUC ≥0.85 = 判别力还在、只是标定压扁（改标定即可用）；<0.70 = 短文本上确实没判别力（必须换特征/换语料）`)
console.log(`\n全量 AUC=${auc(allD, allL).toFixed(3)}（对照：报告值见 lmValidation.json）`)
