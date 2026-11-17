/**
 * 决定性实验：字符 2-gram 到底能不能分开「人写」与「2025–26 现代模型」？
 *
 * 背景：v0.13 的 AI 侧是 2023 年 ChatGPT，人写 vs 2023 AUC 0.939；
 * 加入 343 条现代模型语料后，人写 vs 现代只有 0.615、召回 33.8%。
 * 这有两种解释，修法完全不同：
 *   A. 只是量不够（343 条被 5500 条老数据淹没）→ 放量生成就能救。
 *   B. 2-gram 对现代模型没有信号（现代模型写得太像人）→ 放量也没用，必须换特征。
 *
 * 本脚本把「量」这个混淆项剥掉：只用「人写 vs 现代模型」两类的**平衡小组**，
 * 按题目分组做 5 折交叉验证，看 AUC 能到多少。
 *   AUC ≥0.85 → 是 A，放量即可；<0.70 → 是 B，别在数据量上烧钱。
 *
 * 另附「表层特征基线」：markdown 符号率、分点符号率、平均句长、段数。
 * 如果单一表层特征就能到 0.9，那说明所谓「文风判别」其实是格式捷径，必须公开。
 *
 * 用法：npx tsx scripts/probe-modern-separability.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { LM_MASK, LM_W2, LM_W1, bigramBucket, normalizeLm } from '../src/lib/lmText'

const ROOT = process.cwd()
const TRAIN = path.join(ROOT, 'calibration', 'lm', 'train.jsonl')
const HOLDOUT = path.join(ROOT, 'calibration', 'lm', 'holdout.jsonl')
const TABLE_SIZE = 1 << 19
const FOLDS = 5
const HUMAN_CAP = 6000

interface Row { id: string; group: string; label: 0 | 1; origin?: string; text: string; domain: string }

/**
 * 扒格式：把 markdown 强调 / 标题 / 分点 / 换行全部抹平，只留文字本身。
 * 用途：考察「分得开现代模型」是不是只靠排版（单特征「段数」AUC 0.927 时这个怀疑必须验）。
 * 设 STRIP=1 时启用。学生把 AI 文本粘进 Word 时格式通常已经没了，这个数字更接近真实场景。
 */
const STRIP = process.env.STRIP === '1'
function stripFormat(t: string): string {
  return t
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*`>|_~]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/^\s*\d+[.、)]\s+/gm, '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}
const textOf = (t: string) => (STRIP ? stripFormat(t) : t)

function readAll(): Row[] {
  const out: Row[] = []
  for (const f of [TRAIN, HOLDOUT]) {
    if (!fs.existsSync(f)) continue
    fs.readFileSync(f, 'utf-8').trim().split('\n').filter(Boolean).forEach((l) => {
      try { out.push(JSON.parse(l) as Row) } catch { /* skip */ }
    })
  }
  return out
}

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface LM { uni: Map<string, number>; table: Uint32Array; total: number }

function train(texts: string[]): LM {
  const uni = new Map<string, number>()
  const table = new Uint32Array(TABLE_SIZE)
  let total = 0
  for (const raw of texts) {
    const t = normalizeLm(raw)
    for (let i = 0; i < t.length; i++) {
      const c = t[i]
      uni.set(c, (uni.get(c) ?? 0) + 1)
      total++
      if (i >= 1) table[bigramBucket(t[i - 1], c, LM_MASK)]++
    }
  }
  return { uni, table, total }
}

function meanLogp(m: LM, text: string): number {
  const t = normalizeLm(text)
  if (t.length < 3) return -20
  let sum = 0
  let n = 0
  for (let i = 1; i < t.length; i++) {
    const u = m.uni.get(t[i]) ?? 0
    const p1 = u > 0 ? u / m.total : 1e-9
    const prevCount = m.uni.get(t[i - 1]) ?? 0
    const cnt = m.table[bigramBucket(t[i - 1], t[i], LM_MASK)]
    const p2 = cnt >= 1 && prevCount > 0 ? cnt / prevCount : 0
    sum += Math.log2(Math.max(LM_W2 * p2 + LM_W1 * p1, 1e-9))
    n++
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

// ---------- 表层特征基线 ----------
const feats: Record<string, (t: string) => number> = {
  '长度（字符数）': (t) => t.length,
  'markdown 符号率（** - # |）': (t) => ((t.match(/[*#|]/g) ?? []).length) / Math.max(1, t.length),
  '分点符号率（1. - •）': (t) => ((t.match(/(^|\n)\s*(\d+[.、)]|[-•*])\s/g) ?? []).length) / Math.max(1, t.length / 100),
  '平均句长': (t) => t.split(/[。！？!?]/).filter((s) => s.trim().length > 0).reduce((s, x) => s + x.length, 0) / Math.max(1, t.split(/[。！？!?]/).filter((s) => s.trim().length > 0).length),
  '段数': (t) => t.split(/\n+/).filter((s) => s.trim().length > 0).length,
  '「首先/其次/综上」密度': (t) => ((t.match(/首先|其次|再次|综上|总而言之|总的来说/g) ?? []).length) / Math.max(1, t.length / 200),
}

const all = readAll()
const modern = all.filter((r) => r.origin === 'modern')
const human = all.filter((r) => r.label === 0)
const chatgpt = all.filter((r) => r.label === 1 && r.origin !== 'modern')

const rnd = mulberry32(20261118)
const humanSampled = [...human]
for (let i = humanSampled.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1))
  ;[humanSampled[i], humanSampled[j]] = [humanSampled[j], humanSampled[i]]
}
const humanUse = humanSampled.slice(0, HUMAN_CAP)

console.log(`模式：${STRIP ? '已扒格式（markdown/分点/换行全部抹平）' : '原始文本'}`)
console.log(`语料：人写 ${human.length}（取样 ${humanUse.length}）、现代模型 ${modern.length}、2023 ChatGPT ${chatgpt.length}`)

function crossVal(pos: Row[], neg: Row[], label: string): number[] {
  const rows = [...pos, ...neg]
  const groups = [...new Set(rows.map((r) => r.group))]
  const foldOf = new Map<string, number>()
  groups.forEach((g, i) => foldOf.set(g, i % FOLDS))
  const aucs: number[] = []
  for (let f = 0; f < FOLDS; f++) {
    const fit = rows.filter((r) => foldOf.get(r.group) !== f)
    const ev = rows.filter((r) => foldOf.get(r.group) === f)
    const posM = train(fit.filter((r) => r.label === 1).map((r) => textOf(r.text)))
    const negM = train(fit.filter((r) => r.label === 0).map((r) => textOf(r.text)))
    const ds = ev.map((r) => meanLogp(posM, textOf(r.text)) - meanLogp(negM, textOf(r.text)))
    const ls = ev.map((r) => r.label)
    const a = auc(ds, ls)
    aucs.push(a)
    console.log(`  ${label} fold ${f + 1}: n=${ev.length}（AI ${ls.filter((x) => x === 1).length}）AUC=${a.toFixed(3)}`)
  }
  return aucs
}

console.log('\n=== 1. 人写 vs 现代模型（2015–26 文风），平衡小组，按题目分组 5 折 ===')
const mMod = modern.map((r) => ({ ...r, label: 1 as const }))
const hNeg = humanUse.map((r) => ({ ...r, label: 0 as const }))
const modAucs = crossVal(mMod, hNeg, '现代')
const modMean = modAucs.reduce((a, b) => a + b, 0) / modAucs.length

console.log('\n=== 2. 对照：人写 vs 2023 ChatGPT（同样的管子，只看是否复现 0.94）===')
const cgUse = chatgpt.slice(0, HUMAN_CAP).map((r) => ({ ...r, label: 1 as const }))
const cgAucs = crossVal(cgUse, hNeg, '2023')
const cgMean = cgAucs.reduce((a, b) => a + b, 0) / cgAucs.length

console.log('\n=== 3. 表层特征基线（人写 vs 现代模型，单特征 AUC）===')
for (const [name, fn] of Object.entries(feats)) {
  const vals = [...mMod.map((r) => fn(textOf(r.text))), ...hNeg.map((r) => fn(textOf(r.text)))]
  const labels = [...mMod.map(() => 1), ...hNeg.map(() => 0)]
  const a = auc(vals, labels)
  console.log(`  ${name.padEnd(28)} ${a.toFixed(3)} → 取反 ${Math.max(a, 1 - a).toFixed(3)}`)
}

console.log('\n=== 判决 ===')
console.log(`现代模型 AUC = ${modMean.toFixed(3)}（对照 2023 ChatGPT = ${cgMean.toFixed(3)}）`)
if (modMean >= 0.85) console.log('→ A：判别力在，只是量不够。放量生成现代模型语料即可（成本可估算）。')
else if (modMean >= 0.70) console.log('→ 中间态：2-gram 有部分信号但不足。建议 2-gram + 表层/词级特征融合，不能只靠放量。')
else console.log('→ B：2-gram 对现代模型几乎没有信号。放多少语料都没用，必须换特征（词级、句级、结构级）。')
