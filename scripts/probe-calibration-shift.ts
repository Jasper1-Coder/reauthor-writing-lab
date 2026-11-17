/**
 * 诊断：同一批产物在「问答体」与「作文体」上的分数分布错位有多大。
 *
 * 现象（probe-essay-ai.ts）：作文体裁内 AUC 0.888，但 AI 作文 12/12 全部低于 50 分。
 * 排序对、阈值错——这是典型的标定错位（calibration shift），不是判别力缺失。
 * 成因：Platt 参数是在问答体留出集上拟合的，换体裁后 delta 整体左移。
 *
 * 这个脚本回答一个问题：错位是否可以通过「换一条基线」修好，还是必须重训。
 *   若作文体真人的 delta 分布与问答体真人接近 → 用统一的真人基线（ECDF）做 rank 标定即可；
 *   若两者差很远                        → 需要分体裁基线，或分体裁模型。
 *
 * 用法：npx tsx scripts/probe-calibration-shift.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { DEQUANT, LM_MASK, LM_W2, LM_W1, bigramBucket, normalizeLm } from '../src/lib/lmText'

const ROOT = process.cwd()

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

interface Dialect { key: string; name: string; h: Parsed; a: Parsed; cal: { mean: number; std: number; a: number; b: number } }

function loadDialect(suffix: string, label: string, key: string): Dialect {
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', `lmModel${suffix === '-modern' ? 'Modern' : ''}.json`), 'utf-8'))
  const buf = fs.readFileSync(path.join(ROOT, 'public', `lm-char2${suffix}.bin`))
  const h = parse(buf, 24, buf.readUInt32LE(8), meta.models[0].chars)
  const a = parse(buf, h.next, buf.readUInt32LE(12), meta.models[1].chars)
  return { key, name: label, h: h.m, a: a.m, cal: meta.calibration }
}

const q = (arr: number[], p: number) => {
  if (!arr.length) return NaN
  const s = [...arr].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]
}

const base = loadDialect('', '方言A/2023', 'chatgpt2023')
const modern = loadDialect('-modern', '方言B/现代', 'modern')

const deltaOf = (d: Dialect, text: string) => meanLogp(d.a, text) - meanLogp(d.h, text)
const scoreOf = (d: Dialect, delta: number) => {
  const z = (delta - d.cal.mean) / d.cal.std
  return 100 / (1 + Math.exp(-(d.cal.a * z + d.cal.b)))
}

// ---- 问答体留出集 ----
const holdPath = path.join(ROOT, 'calibration', 'lm', 'holdout.jsonl')
if (!fs.existsSync(holdPath)) {
  console.log('缺少 calibration/lm/holdout.jsonl，先跑 npx tsx scripts/train-lm.ts')
  process.exit(1)
}
const qa = fs.readFileSync(holdPath, 'utf-8').trim().split('\n').filter(Boolean)
  .map((l) => JSON.parse(l) as { label: number; text: string })

// ---- 作文体：真人 ----
const essayPath = path.join(ROOT, 'calibration', 'essays', 'student-essays-sample.jsonl')
if (!fs.existsSync(essayPath)) {
  console.log('缺少 calibration/essays/student-essays-sample.jsonl，先跑 npx tsx scripts/probe-student-essays.ts')
  process.exit(1)
}
const esReal = fs.readFileSync(essayPath, 'utf-8').trim().split('\n').filter(Boolean)
  .map((l) => JSON.parse(l) as { text: string })

// ---- 作文体：AI ----
const aiPath = path.join(ROOT, 'scripts', 'data', 'ai-essays.jsonl')
const esAI = fs.readFileSync(aiPath, 'utf-8').trim().split('\n').filter(Boolean)
  .map((l) => JSON.parse(l) as { text: string })

const qaHuman = qa.filter((r) => r.label === 0).map((r) => r.text)
const qaAI = qa.filter((r) => r.label === 1).map((r) => r.text)

console.log(`问答体留出集：真人 ${qaHuman.length} / AI ${qaAI.length}`)
console.log(`作文体：真人 ${esReal.length} / AI ${esAI.length}\n`)

for (const d of [base, modern]) {
  const groups = [
    { name: '问答·真人', delta: qaHuman.map((t) => deltaOf(d, t)) },
    { name: '问答·AI', delta: qaAI.map((t) => deltaOf(d, t)) },
    { name: '作文·真人', delta: esReal.map((r) => deltaOf(d, r.text)) },
    { name: '作文·AI', delta: esAI.map((r) => deltaOf(d, r.text)) },
  ]
  console.log(`══════ ${d.name} ══════`)
  console.log('组'.padEnd(14) + 'n'.padStart(6) + 'delta p10'.padStart(12) + 'p50'.padStart(9) + 'p90'.padStart(9) + '  → 当前分数 p50')
  for (const g of groups) {
    console.log(
      g.name.padEnd(14) + String(g.delta.length).padStart(6) +
      q(g.delta, 0.1).toFixed(3).padStart(12) + q(g.delta, 0.5).toFixed(3).padStart(9) + q(g.delta, 0.9).toFixed(3).padStart(9) +
      '  →  ' + scoreOf(d, q(g.delta, 0.5)).toFixed(0).padStart(3),
    )
  }
  const qaH50 = q(groups[0].delta, 0.5)
  const esH50 = q(groups[2].delta, 0.5)
  const shift = esH50 - qaH50
  const sd = d.cal.std
  console.log(`  真人中位 delta：问答 ${qaH50.toFixed(3)} vs 作文 ${esH50.toFixed(3)} → 偏移 ${shift.toFixed(3)}（${(shift / sd).toFixed(2)} 个标准差）`)

  // 若改用「统一真人 ECDF 百分位」，作文 AI 与作文真人的分离度
  const ref = [...groups[0].delta, ...groups[2].delta].sort((x, y) => x - y)
  const ecdf = (v: number) => {
    let lo = 0, hi = ref.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ref[mid] < v) lo = mid + 1; else hi = mid }
    return (lo / ref.length) * 100
  }
  const pAI = groups[3].delta.map(ecdf)
  const pReal = groups[2].delta.map(ecdf)
  console.log(`  改用「真人 ECDF 百分位」（问答+作文合并 ${ref.length} 篇真人做基线）：`)
  console.log(`    作文 AI 百分位 p10/p50/p90 = ${q(pAI, 0.1).toFixed(0)}/${q(pAI, 0.5).toFixed(0)}/${q(pAI, 0.9).toFixed(0)}`)
  console.log(`    作文真人百分位 p50/p90/p99 = ${q(pReal, 0.5).toFixed(0)}/${q(pReal, 0.9).toFixed(0)}/${q(pReal, 0.99).toFixed(0)}`)
  const rec = pAI.filter((x) => x >= 95).length / pAI.length
  const fpr = pReal.filter((x) => x >= 95).length / pReal.length
  console.log(`    阈值 95 百分位：AI 命中 ${(rec * 100).toFixed(1)}% / 真人误伤 ${(fpr * 100).toFixed(2)}%`)
  console.log()
}
