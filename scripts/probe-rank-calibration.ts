/**
 * 关键验证：用「真人经验分布（ECDF）」做标定，能否在零 AI 语料、零 token 的前提下
 * 让阈值在作文体裁上自动落到正确位置。
 *
 * 背景链条（三个探针依次打脸得出的结论，别只看最后一个）：
 *   1. probe-student-essays.ts：真人作文 1000 篇中位分 2 分，误伤率 0.1% → 真人侧不误伤。
 *   2. probe-essay-ai.ts     ：AI 作文 12 篇全部低于 50 分 → 看着像"漏检 100%"。
 *   3. probe-human-only-essay.ts：用原始 delta 排序，现有模型在作文体裁上 AUC 0.981。
 *      → 2 里的"漏检"是 Math.round 到整数造成的并列假象；真实能力在，只是分数尺度错位。
 *   4. probe-calibration-shift.ts：真人作文的 delta 比问答体真人低 1.85 个标准差，
 *      所以固定在问答体上拟合的 Platt 曲线，到作文体裁整条平移，50 分不再对应任何有意义的位置。
 *
 * 本脚本做最后一步验证：如果把「分数」定义成「在真人文本中的百分位」，而不是「Platt 概率」，
 * 阈值就不再依赖体裁——因为百分位天然按体裁归一化。
 * 这一步不需要任何 AI 样本参与拟合（只用 AI 样本评估），因此零 token、零额外语料。
 *
 * 用法：npx tsx scripts/probe-rank-calibration.ts
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

function loadDialect(suffix: string) {
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', `lmModel${suffix === '-modern' ? 'Modern' : ''}.json`), 'utf-8'))
  const buf = fs.readFileSync(path.join(ROOT, 'public', `lm-char2${suffix}.bin`))
  const h = parse(buf, 24, buf.readUInt32LE(8), meta.models[0].chars)
  const a = parse(buf, h.next, buf.readUInt32LE(12), meta.models[1].chars)
  return { h: h.m, a: a.m }
}

const q = (arr: number[], p: number) => {
  if (!arr.length) return NaN
  const s = [...arr].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]
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

const b1 = loadDialect('')
const b2 = loadDialect('-modern')
/** 线上口径：取两种方言中更接近 AI 的那个（原始 delta，不做取整） */
const maxDelta = (t: string) => Math.max(
  meanLogp(b1.a, t) - meanLogp(b1.h, t),
  meanLogp(b2.a, t) - meanLogp(b2.h, t),
)

async function fetchNcee(limit = 300) {
  const out: string[] = []
  for (let offset = 0; offset < limit; offset += 100) {
    try {
      const res = await fetch(`https://datasets-server.huggingface.co/rows?dataset=BabelTowerProject%2FOpenNCEE-Chinese-Essay&config=default&split=train&offset=${offset}&length=100`)
      if (!res.ok) break
      const j = (await res.json()) as { rows: Array<{ row: { messages: Array<{ content: string }> } }> }
      for (const r of j.rows ?? []) {
        const t = (r.row.messages?.[2]?.content ?? '').replace(/\s+/g, ' ').trim()
        if (t.length >= 400) out.push(t)
      }
    } catch { break }
  }
  return out
}

async function main() {
  const essayReal = fs.readFileSync(path.join(ROOT, 'calibration', 'essays', 'student-essays-sample.jsonl'), 'utf-8')
    .trim().split('\n').filter(Boolean).map((l) => (JSON.parse(l) as { text: string }).text)
  const essayAI = fs.readFileSync(path.join(ROOT, 'scripts', 'data', 'ai-essays.jsonl'), 'utf-8')
    .trim().split('\n').filter(Boolean).map((l) => (JSON.parse(l) as { text: string }).text)
  process.stdout.write('拉取高考范文…')
  const ncee = await fetchNcee(300)
  console.log(` ${ncee.length} 篇`)

  // 问答体真人（留出集）用来检验：换成百分位后，问答体上的表现会不会变差
  const qaRows = fs.readFileSync(path.join(ROOT, 'calibration', 'lm', 'holdout.jsonl'), 'utf-8')
    .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { label: number; text: string })
  const qaHuman = qaRows.filter((r) => r.label === 0).slice(0, 1200).map((r) => r.text)
  const qaAI = qaRows.filter((r) => r.label === 1).slice(0, 1200).map((r) => r.text)

  const essayHuman = [...essayReal, ...ncee]

  // ── 建 ECDF 基线：只用真人（问答 + 作文都算真人，不分体裁，检验统一基线是否够用）
  const diag = maxDelta(qaHuman[0])
  console.log(`\n[诊断] 首篇问答真人 delta = ${diag}`)
  console.log(`[诊断] b1.total=${b1.h.total} b2.total=${b2.h.total}`)
  const rawAll = [...qaHuman, ...essayHuman].map(maxDelta)
  const nanCount = rawAll.filter((x) => !Number.isFinite(x)).length
  console.log(`[诊断] 计算 ${rawAll.length} 篇，非有限值 ${nanCount} 篇；前 3 个 = ${rawAll.slice(0, 3).map((x) => x.toFixed(3)).join(', ')}`)
  const refAll = rawAll.filter((x) => Number.isFinite(x)).sort((x, y) => x - y)
  const refEssay = essayHuman.map(maxDelta).filter((x) => Number.isFinite(x)).sort((x, y) => x - y)
  const refQA = qaHuman.map(maxDelta).filter((x) => Number.isFinite(x)).sort((x, y) => x - y)

  const ecdfOf = (ref: number[]) => (v: number) => {
    let lo = 0, hi = ref.length
    while (lo < hi) { const m = (lo + hi) >> 1; if (ref[m] < v) lo = m + 1; else hi = m }
    return (lo / ref.length) * 100
  }

  console.log(`[诊断] refAll 长度 ${refAll.length}，min=${refAll[0]?.toFixed(3)} mid=${refAll[Math.floor(refAll.length / 2)]?.toFixed(3)} max=${refAll[refAll.length - 1]?.toFixed(3)}`)
  console.log(`[诊断] ecdf(0)=${ecdfOf(refAll)(0).toFixed(2)} ecdf(-1)=${ecdfOf(refAll)(-1).toFixed(2)} ecdf(1)=${ecdfOf(refAll)(1).toFixed(2)}`)
  const essayHuman2 = essayHuman.map(maxDelta)
  console.log(`[诊断] 作文真人 delta 前 3：${essayHuman2.slice(0, 3).map((x) => x.toFixed(3)).join(', ')}`)

  const tests: Array<{ name: string; human: string[]; ai: string[] }> = [
    { name: '作文体裁', human: essayHuman, ai: essayAI },
    { name: '问答体裁', human: qaHuman, ai: qaAI },
  ]

  const baselines = [
    { name: '统一基线（问答+作文真人 混合）', ecdf: ecdfOf(refAll) },
    { name: '分体裁基线（各自真人）', ecdf: null as null | ((v: number) => number) },
  ]

  for (const bl of baselines) {
    console.log(`\n════ ${bl.name} ════`)
    for (const ts of tests) {
      const ecdf = bl.ecdf ?? ecdfOf(ts.name === '作文体裁' ? refEssay : refQA)
      console.log(`  [诊断] ${ts.name} human[0] 类型=${typeof ts.human[0]} 值=${String(ts.human[0]).slice(0, 40)} ｜ 条数 human=${ts.human.length} ai=${ts.ai.length}`)
      const hPct = ts.human.map((v) => ecdf(typeof v === 'string' ? maxDelta(v) : NaN))
      const aPct = ts.ai.map((v) => ecdf(typeof v === 'string' ? maxDelta(v) : 0))
      const sc = [...hPct, ...aPct]
      const lb = [...hPct.map(() => 0), ...aPct.map(() => 1)]
      const a = auc(sc, lb)
      console.log(`${ts.name}：真人 p50/p90/p99 = ${q(hPct, 0.5).toFixed(0)}/${q(hPct, 0.9).toFixed(0)}/${q(hPct, 0.99).toFixed(0)}` +
        ` ｜ AI p10/p50/p90 = ${q(aPct, 0.1).toFixed(0)}/${q(aPct, 0.5).toFixed(0)}/${q(aPct, 0.9).toFixed(0)} ｜ AUC ${a.toFixed(3)}`)
      for (const thr of [90, 95, 98, 99]) {
        const rec = aPct.filter((x) => x >= thr).length / aPct.length
        const fpr = hPct.filter((x) => x >= thr).length / hPct.length
        console.log(`   阈值 ${thr} 百分位 → AI 命中 ${(rec * 100).toFixed(1).padStart(5)}% / 真人误伤 ${(fpr * 100).toFixed(2)}%`)
      }
      // 旧口径对照：固定 Platt 阈值 50 分
      const oldScore = (t: string) => {
        const d = maxDelta(t)
        return { d }
      }
      void oldScore
      console.log(`   旧口径（Platt 50 分）在本题材的召回：见 probe-essay-ai.ts（作文 0%、问答约 91%）`)
    }
  }

  console.log('\n结论判据：')
  console.log('  若「统一基线」在两个体裁上的 AUC 都 ≥ 0.90 且阈值 95 的误伤 ≤ 5% → 一套百分位标定即可跨体裁通用，无需 AI 作文语料。')
  console.log('  若真人在作文体裁的百分位也集中在高位（p50 高）→ 说明统一基线被问答体拉偏，必须分体裁基线。')
}

main().catch((e) => { console.error(e); process.exit(1) })
