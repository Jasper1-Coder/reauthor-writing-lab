/**
 * 零成本方案 B：只用「真人作文」训练语言模型，用困惑度偏离判别——完全不需要 AI 作文语料。
 *
 * 动机：作文体裁失效的根因是「AI 侧训练语料是问答体」。要补 AI 作文语料就得生成，
 * 而生成要么花 API token，要么找不到公开数据集。那就换一条不需要 AI 语料的路：
 *
 *   真人作文写了 26.9 万篇（公开数据集）。AI 文本的字符 2-gram 分布系统性地
 *   更「平滑」：常用搭配占比高、罕见组合少、句长均匀。所以只要有一个足够准的
 *   「真人作文语言模型」，AI 作文的平均对数似然会显著偏高（更可预测）。
 *   用真人内部的似然分布做基线，取低分位作阈值——**一个 AI 样本都不需要**。
 *
 * 对照：同一批文本再用现有的「问答体双模型」打分，比较两者在作文体裁上的 AUC。
 * 这个脚本不写任何产物，只回答一个问题：这条路值不值得做成 v0.15。
 *
 * 用法：npx tsx scripts/probe-human-only-essay.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { DEQUANT, LM_MASK, LM_W2, LM_W1, bigramBucket, normalizeLm, quantizeCount } from '../src/lib/lmText'

const ROOT = process.cwd()
const ESSAYS = path.join(ROOT, 'calibration', 'essays', 'student-essays-sample.jsonl')
const AI_ESSAYS = path.join(ROOT, 'scripts', 'data', 'ai-essays.jsonl')
const OPENNCEE = 'https://datasets-server.huggingface.co/rows?dataset=BabelTowerProject%2FOpenNCEE-Chinese-Essay&config=default&split=train'

// ── 与训练脚本同构的哈希 / 量化口径（保证与线上产物可比） ──

function trainModel(texts: string[]): { index: Map<number, number>; unigram: Float32Array; table: Uint8Array; total: number } {
  const uni = new Map<number, number>()
  const bi = new Map<number, number>()
  let total = 0
  for (const t of texts) {
    const s = normalizeLm(t)
    for (let i = 0; i < s.length; i++) {
      const c = s.codePointAt(i) ?? 0
      uni.set(c, (uni.get(c) ?? 0) + 1)
      total++
      if (i > 0) {
        const k = bigramBucket(s[i - 1], s[i], LM_MASK)
        bi.set(k, (bi.get(k) ?? 0) + 1)
      }
    }
  }
  const codes = [...uni.keys()]
  const index = new Map<number, number>()
  const unigram = new Float32Array(codes.length)
  codes.forEach((c, i) => { index.set(c, i); unigram[i] = uni.get(c) ?? 0 })
  const table = new Uint8Array(LM_MASK + 1)
  for (const [k, v] of bi) table[k] = quantizeCount(v)
  return { index, unigram, table, total }
}

function meanLogp(m: { index: Map<number, number>; unigram: Float32Array; table: Uint8Array; total: number }, text: string): number {
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

const q = (arr: number[], p: number) => {
  if (!arr.length) return NaN
  const s = [...arr].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]
}

function auc(scores: number[], labels: number[]): number {
  // scores 越高越像 AI；用秩和公式
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

async function fetchNcee(limit = 300): Promise<Array<{ text: string }>> {
  const out: Array<{ text: string }> = []
  for (let offset = 0; offset < limit; offset += 100) {
    try {
      const res = await fetch(`${OPENNCEE}&offset=${offset}&length=100`)
      if (!res.ok) break
      const j = (await res.json()) as { rows: Array<{ row: { messages: Array<{ content: string }> } }> }
      for (const r of j.rows ?? []) {
        const t = (r.row.messages?.[2]?.content ?? '').replace(/\s+/g, ' ').trim()
        if (t.length >= 400) out.push({ text: t })
      }
    } catch { break }
  }
  return out
}

async function main() {
  const real = fs.readFileSync(ESSAYS, 'utf-8').trim().split('\n').filter(Boolean).map((l) => (JSON.parse(l) as { text: string }).text)
  const ai = fs.readFileSync(AI_ESSAYS, 'utf-8').trim().split('\n').filter(Boolean).map((l) => (JSON.parse(l) as { text: string }).text)
  process.stdout.write('拉取 OpenNCEE 人类范文…')
  const ncee = (await fetchNcee(300)).map((r) => r.text)
  console.log(` ${ncee.length} 篇`)

  const allHuman = [...real, ...ncee]
  // 5 折：真人内部切分，AI 样本永远在测试侧（AI 不参与训练，这是关键——
  // 换成真实场景就是「真人写了一堆作文，AI 从没被喂过」，最能反映实际可用性）
  const FOLDS = 5
  const fold = (i: number) => i % FOLDS
  const scores = new Array(allHuman.length + ai.length).fill(0)

  for (let f = 0; f < FOLDS; f++) {
    const tr = allHuman.filter((_, i) => fold(i) !== f)
    const m = trainModel(tr)
    allHuman.forEach((t, i) => { if (fold(i) === f) scores[i] = -meanLogp(m, t) })  // 取负：困惑度越低越像 AI
    if (f === 0) ai.forEach((t, i) => { scores[allHuman.length + i] = -meanLogp(m, t) })
  }
  // AI 只算一次（用 fold0 的模型），其余折取平均意义不大，样本量已说明问题
  const humanScores = scores.slice(0, allHuman.length)
  const aiScores = scores.slice(allHuman.length)

  // 对照：现有双模型在作文上的表现（用 max 分，与线上口径一致）
  const baseMeta = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'lmModel.json'), 'utf-8'))
  const modernMeta = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'lmModelModern.json'), 'utf-8'))
  const parseBin = (suffix: string, meta: { models: Array<{ chars: number }> }) => {
    const buf = fs.readFileSync(path.join(ROOT, 'public', `lm-char2${suffix}.bin`))
    const off = (o: number, vocab: number, total: number) => {
      const index = new Map<number, number>()
      const unigram = new Float32Array(vocab)
      const codes = new Array<number>(vocab)
      let p = o
      for (let i = 0; i < vocab; i++) { codes[i] = buf.readUInt32LE(p); p += 4 }
      for (let i = 0; i < vocab; i++) { unigram[i] = buf.readUInt32LE(p); p += 4 }
      const table = new Uint8Array(buf.subarray(p, p + (1 << buf.readUInt8(7))))
      p += 1 << buf.readUInt8(7)
      codes.forEach((c, i) => index.set(c, i))
      return { m: { index, unigram, table, total }, next: p }
    }
    const h = off(24, buf.readUInt32LE(8), meta.models[0].chars)
    const a = off(h.next, buf.readUInt32LE(12), meta.models[1].chars)
    return { h: h.m, a: a.m }
  }
  const b1 = parseBin('', baseMeta)
  const b2 = parseBin('-modern', modernMeta)
  const oldScore = (t: string) => Math.max(
    meanLogp(b1.a, t) - meanLogp(b1.h, t),
    meanLogp(b2.a, t) - meanLogp(b2.h, t),
  )
  const oldHuman = allHuman.map(oldScore)
  const oldAI = ai.map(oldScore)

  console.log(`\n真人语料 ${allHuman.length} 篇（普通作文 ${real.length} + 高考范文 ${ncee.length}）/ AI 作文 ${ai.length} 篇\n`)
  console.log('─'.repeat(88))
  console.log('方案'.padEnd(34) + '真人 p50'.padStart(11) + 'AI p50'.padStart(10) + 'AUC'.padStart(9) + '  最佳操作点')
  console.log('─'.repeat(88))

  const report = (name: string, hs: number[], as: number[]) => {
    const sc = [...hs, ...as]
    const lb = [...hs.map(() => 0), ...as.map(() => 1)]
    const a = auc(sc, lb)
    // 扫阈值找 (召回 + 特异度) 最大
    const uniq = [...new Set(sc)].sort((x, y) => x - y)
    let best = { thr: 0, rec: 0, fpr: 1, j: -1 }
    for (const thr of uniq) {
      const rec = as.filter((x) => x >= thr).length / as.length
      const fpr = hs.filter((x) => x >= thr).length / hs.length
      const j = rec - fpr
      if (j > best.j) best = { thr, rec, fpr, j }
    }
    console.log(
      name.padEnd(34) + q(hs, 0.5).toFixed(3).padStart(11) + q(as, 0.5).toFixed(3).padStart(10) + a.toFixed(3).padStart(9) +
      `  召回 ${(best.rec * 100).toFixed(0)}% / 误伤 ${(best.fpr * 100).toFixed(1)}%`,
    )
    return a
  }

  const aucA = report('A｜真人作文LM（零 AI 语料）', humanScores, aiScores)
  const aucB = report('B｜现有问答体双模型', oldHuman, oldAI)

  console.log('\n注：AI 样本 12 篇，置信区间很宽（AUC ±0.1 量级），只能看方向不能当定论。')
  if (aucA > aucB + 0.02) {
    console.log(`→ 方向明确：纯真人语料方案 AUC ${aucA.toFixed(3)} 高于现有 ${aucB.toFixed(3)}，值得做成 v0.15（成本仍为 0 token）。`)
  } else if (aucB > aucA + 0.02) {
    console.log(`→ 现有问答体模型在作文上反而更准（${aucB.toFixed(3)} vs ${aucA.toFixed(3)}），瓶颈不在语料体裁，在样本量。`)
  } else {
    console.log(`→ 两者接近（${aucA.toFixed(3)} vs ${aucB.toFixed(3)}），12 篇 AI 样本不足以区分，需要扩样本再判。`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
