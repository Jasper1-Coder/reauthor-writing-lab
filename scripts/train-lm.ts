/**
 * 训练「语言模型通道」——本项目第一个真正训练出来的模型。
 *
 * 思路（DetectGPT / Binoculars 的可行子集）：
 *   训练两个字符级语言模型，一个只读真人文本，一个只读 AI 文本。
 *   对任意一段文本，分别算它在两个模型下的平均对数概率。
 *   两者的差（对数似然比）就是「这段文字更像哪种文风」的证据。
 *
 * 为什么不用神经网络：0.5B 级模型需要下载数百 MB、依赖 WebGPU，
 * 在不稳定网络和手机上不可用（v0.5 试过，生产环境直接崩）。
 * 字符 2-gram 模型实测域内 AUC 0.959、体积 1MB、纯 JS 毫秒级，
 * 是「能在浏览器里真跑起来」的最优解。跨域失效的问题见 lmValidation.json。
 *
 * 用法：npx tsx scripts/train-lm.ts
 * 产物：public/lm-char2.bin、src/data/lmModel.json、src/data/lmValidation.json
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import {
  DEQUANT,
  LM_BITS,
  LM_MASK,
  LM_ORDER,
  LM_TABLE_SIZE,
  LM_W1,
  LM_W2,
  bigramBucket,
  normalizeLm,
  quantizeCount,
} from '../src/lib/lmText'

const ROOT = process.cwd()
const RAW = path.join(ROOT, 'calibration', 'raw')
const ACADEMIC = path.join(ROOT, 'crossdomain', 'academic_zh.jsonl')
/**
 * AI_FROM 决定这一版模型的 AI 类由谁构成：
 *   'chatgpt2023' = 只用 HC3 原生的 2023 ChatGPT（v0.13 的口径）
 *   'modern'      = 只用 2025–26 现代模型（同题重生成）
 *   'both'        = 混合（会互相稀释，实测顾此失彼）
 * 线上同时加载两个版本的产物，各算一个读数，取更接近的那个——
 * 因为「AI 文风」在 2026 年已经是两种方言，一个模型装不下。
 */
const AI_FROM = (process.env.AI_FROM ?? 'both') as 'chatgpt2023' | 'modern' | 'both'
const OUT_SUFFIX = process.env.OUT_SUFFIX ?? (AI_FROM === 'modern' ? '-modern' : '')
const OUT_BIN = path.join(ROOT, 'public', `lm-char2${OUT_SUFFIX}.bin`)
const OUT_META = path.join(ROOT, 'src', 'data', `lmModel${OUT_SUFFIX ? 'Modern' : ''}.json`)
const OUT_VALID = path.join(ROOT, 'src', 'data', `lmValidation${OUT_SUFFIX ? 'Modern' : ''}.json`)

const SEED = 20261117
const MAX_DOCS_PER_CELL = 3000 // 每个 (domain,label) 的文档上限，防单一域淹没
const MAX_CHARS_PER_CELL = 2_500_000
const MIN_CHARS = 40
const FOLDS = 5

/**
 * Fisher-Yates 洗牌。
 * 千万不要用 `arr.sort(() => rnd() - 0.5)`：比较器不满足传递性时，
 * V8 的 TimSort 会给出高度偏斜的结果（实测会让前几个领域垄断整个留出集），
 * 这是本项目踩过的真实坑，写在这里防止有人改回去。
 */
function shuffle<T>(arr: readonly T[], rnd: () => number): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

interface Doc { id: string; group: string; q: string; domain: string; label: 0 | 1; text: string; origin: 'hc3' | 'modern' }

function readJsonl(file: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l) } catch { return {} }
  })
}

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 拒答模板过滤：HC3 里约 3.5% 的 AI 文本是「I'm sorry, as an AI...」「作为一个AI」
 * 这类固定拒答句。它们是格式捷径而不是文风，会把 AUC 抬虚，必须剔除。
 */
const REFUSAL = /^(i'?m sorry|i am sorry|sorry,|as an ai|as a language model|作为一个?ai|作为ai|很抱歉|抱歉，我|我无法(?:提供|回答|完成)|我(?:不能|无法)协助)/i

/**
 * API 报错模板过滤（红队审计发现）。
 * HC3 的部分 ChatGPT 答案其实是采集时的接口错误回显，例如
 * 「!Your authentication token has expired.」「! network error」「!Too many requests」。
 * 它们不是「AI 文风」，只是同一段垃圾在语料里重复了几十次——模型会靠模板记住它们，
 * 让指标虚高（scripts/audit-lm-recompute.ts 实测留出集有 16 篇这种文本，全部 label=1）。
 * 只匹配开头，避免误伤正文里正常提到「network error」的段落。
 */
const JUNK_HEAD = /^!?\s*(network error|your authentication token has expired|too many requests|error generating a response|only one message at a time|it is possible that canceling)/i

/**
 * 整段匹配的接口报错标志。上面的 head 版会漏掉「错误回显出现在正文中段」的样本
 * （红队审计实测仍有 2 篇残留），这里用不会出现在正常回答里的完整短语补一刀。
 */
const JUNK_ANY = /(there was an error generating a response|your authentication token has expired|too many requests in 1 hour|only one message at a time)/i

function isRefusal(text: string): boolean {
  return REFUSAL.test(text.slice(0, 80).replace(/\s+/g, ' ').trim())
}

function isJunk(text: string): boolean {
  return JUNK_HEAD.test(text.slice(0, 80).replace(/\s+/g, ' ').trim()) || JUNK_ANY.test(text)
}

function loadCorpus(): { docs: Doc[]; stats: Record<string, number> } {
  const stats: Record<string, number> = { raw: 0, tooShort: 0, refusal: 0, junk: 0, kept: 0, modern: 0, otherDialect: 0 }
  const cells = new Map<string, Doc[][]>()
  for (const f of fs.readdirSync(RAW)) {
    if (!f.endsWith('.jsonl')) continue
    const fileDomain = f.replace('.jsonl', '')
    readJsonl(path.join(RAW, f)).forEach((row, i) => {
      // 现代模型语料（scripts/gen-modern-ai.ts 生成）自带 source_domain，
      // 必须挂回原域——否则同一问题的三种答案会落到不同 domain，
      // 分组键 `${domain}|${question}` 就合并不了，等于重造 v0.13 被红队打回的「同题跨集」。
      const domain = typeof row.source_domain === 'string' ? row.source_domain : fileDomain
      const group = `${domain}#${i}`
      const q = typeof row.question === 'string' ? row.question : ''
      const push = (text: string, label: 0 | 1, k: number, origin: 'hc3' | 'modern') => {
        stats.raw++
        // 方言筛选：真人侧永远保留（两种方言共用同一个真人模型），只筛 AI 侧
        if (label === 1 && AI_FROM === 'chatgpt2023' && origin === 'modern') { stats.otherDialect++; return }
        if (label === 1 && AI_FROM === 'modern' && origin === 'hc3') { stats.otherDialect++; return }
        if (typeof text !== 'string') return
        const t = text.trim()
        if (t.length < MIN_CHARS) { stats.tooShort++; return }
        if (isRefusal(t)) { stats.refusal++; return }
        if (isJunk(t)) { stats.junk++; return }
        // 配额按 origin 分开算：否则现代模型样本会被同域的 2023 ChatGPT 样本挤掉，
        // 加了几百条也等于没加（这是最容易假装修好的地方）。
        const key = `${domain}|${label}|${origin}`
        if (!cells.has(key)) cells.set(key, [[]])
        cells.get(key)![0].push({ id: `${group}-${label}-${origin}-${k}`, group, q, domain, label, text: t, origin })
        if (origin === 'modern') stats.modern++
      }
      ;((row.human_answers as string[]) ?? []).forEach((t, k) => push(t, 0, k, 'hc3'))
      ;((row.chatgpt_answers as string[]) ?? []).forEach((t, k) => push(t, 1, k, 'hc3'))
      ;((row.modern_answers as string[]) ?? []).forEach((t, k) => push(t, 1, k, 'modern'))
    })
  }

  const docs: Doc[] = []
  // 按「字符质量」配平 AI 侧的两个方言：
  //   2023 ChatGPT（HC3 原生）与 2025–26 现代模型。
  // 不配平的话，现代模型样本只占 AI 侧 1.7% 字符，模型等于没学过它——
  // 实测：加 343 条现代样本后，「人写 vs 现代模型」AUC 只有 0.615、召回 33.8%，
  // 而把量配平（scripts/probe-modern-separability.ts，平衡小组 5 折）是 0.944。
  // 说明不是没有信号，是被稀释了。这里把 2023 侧压到现代侧约 2 倍质量。
  const modernCharsByDomain = new Map<string, number>()
  for (const [key, arr] of cells) {
    const parts = key.split('|')
    if (parts[2] !== 'modern') continue
    const dom = parts[0]
    modernCharsByDomain.set(dom, (modernCharsByDomain.get(dom) ?? 0) + arr[0].reduce((s, d) => s + d.text.length, 0))
  }
  for (const [key, arr] of [...cells].sort((a, b) => a[0].localeCompare(b[0]))) {
    const [dom, , origin] = key.split('|')
    const rnd = mulberry32(SEED ^ (key.length * 7919 + key.charCodeAt(0)))
    const shuffled = shuffle(arr[0], rnd)
    const modernHere = modernCharsByDomain.get(dom) ?? 0
    // 2023 侧与现代侧的字符质量比。默认 2:1（保留大部分 HC3，同时让现代方言有真实权重）。
    // 可用环境变量 AI_HC3_RATIO 扫参：调小 = 更认现代模型，调大 = 更认 2023 ChatGPT。
    // 这是「一个 AI 类装两种方言」的固有折中，必须实测而不是拍脑袋。
    const ratio = Number(process.env.AI_HC3_RATIO ?? 2)
    const capChars = AI_FROM === 'both' && origin === 'hc3' && dom && modernHere > 0
      ? Math.round(modernHere * ratio)
      : MAX_CHARS_PER_CELL
    let chars = 0
    const picked: Doc[] = []
    for (const d of shuffled) {
      if (picked.length >= MAX_DOCS_PER_CELL) break
      if (chars + d.text.length > capChars) continue
      picked.push(d)
      chars += d.text.length
    }
    docs.push(...picked)
  }
  stats.kept = docs.length
  return { docs, stats }
}

// ---------- 模型 ----------
interface Built { chars: string[]; unigram: Float64Array; total: number; table: Uint32Array }

function trainModel(docs: Doc[]): Built {
  const uni = new Map<string, number>()
  const table = new Uint32Array(LM_TABLE_SIZE)
  let total = 0
  for (const d of docs) {
    const t = normalizeLm(d.text)
    for (let i = 0; i < t.length; i++) {
      const c = t[i]
      uni.set(c, (uni.get(c) ?? 0) + 1)
      total++
      if (i >= 1) table[bigramBucket(t[i - 1], c, LM_MASK)]++
    }
  }
  const chars = [...uni.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)
  const unigram = new Float64Array(chars.length)
  chars.forEach((c, i) => { unigram[i] = uni.get(c) ?? 0 })
  return { chars, unigram, total, table }
}

interface Quantized { chars: string[]; unigram: Uint32Array; table: Uint8Array; total: number }

function quantizeModel(m: Built): Quantized {
  const unigram = new Uint32Array(m.unigram.length)
  m.unigram.forEach((v, i) => { unigram[i] = Math.min(0xffffffff, Math.round(v)) })
  const table = new Uint8Array(LM_TABLE_SIZE)
  for (let i = 0; i < LM_TABLE_SIZE; i++) table[i] = quantizeCount(m.table[i])
  return { chars: m.chars, unigram, table, total: m.total }
}

interface RuntimeModel { map: Map<string, number>; unigram: Float32Array; table: Uint8Array; dequant: Float32Array; total: number }

function toRuntime(q: Quantized): RuntimeModel {
  const map = new Map<string, number>()
  q.chars.forEach((c, i) => map.set(c, i))
  const unigram = new Float32Array(q.unigram.length)
  q.unigram.forEach((v, i) => { unigram[i] = v })
  return { map, unigram, table: q.table, dequant: DEQUANT, total: q.total }
}

/** 平均对数概率（负交叉熵），严格复刻线上推理逻辑 */
function meanLogp(model: RuntimeModel, text: string): number {
  const t = normalizeLm(text)
  if (t.length < 3) return -20
  let sum = 0
  let n = 0
  let prevIdx = model.map.get(t[0]) ?? -1
  for (let i = 1; i < t.length; i++) {
    const idx = model.map.get(t[i]) ?? -1
    const u = idx >= 0 ? model.unigram[idx] : 0
    const p1 = u > 0 ? u / model.total : 1e-9
    let p2 = 0
    if (prevIdx >= 0) {
      const q = model.table[bigramBucket(t[i - 1], t[i], LM_MASK)]
      const cnt = model.dequant[q]
      const ctx = model.unigram[prevIdx]
      if (cnt >= 1 && ctx > 0) p2 = cnt / ctx
    }
    const p = LM_W2 * p2 + LM_W1 * p1
    sum += Math.log2(Math.max(p, 1e-9))
    n++
    prevIdx = idx
  }
  return sum / n
}

function delta(hM: RuntimeModel, aM: RuntimeModel, text: string): number {
  return meanLogp(aM, text) - meanLogp(hM, text)
}

function auc(scores: number[], labels: number[]): number {
  const idx = scores.map((_, i) => i).sort((a, b) => scores[a] - scores[b])
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
  if (pos === 0 || neg === 0) return 0.5
  return (sumPos - (pos * (pos + 1)) / 2) / (pos * neg)
}

interface Cal { mean: number; std: number; a: number; b: number }

/**
 * Platt 标定：把似然比映射到 0–100。
 * 先对似然比做标准化再拟合，否则原始量纲下梯度下降会发散
 * （踩过的坑：阈值 50 曾出现灵敏度 100%、特异度 0.6% 的退化结果）。
 */
function fitPlatt(deltas: number[], labels: number[]): Cal {
  const n = deltas.length
  const mean = deltas.reduce((a, b) => a + b, 0) / n
  const std = Math.sqrt(deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1
  const z = deltas.map((d) => (d - mean) / std)
  let a = 1
  let b = 0
  for (let it = 0; it < 4000; it++) {
    let ga = 0
    let gb = 0
    for (let i = 0; i < n; i++) {
      const p = 1 / (1 + Math.exp(-(a * z[i] + b)))
      const e = p - labels[i]
      ga += e * z[i]
      gb += e
    }
    a -= 0.5 * ga / n
    b -= 0.5 * gb / n
    if (a > 30) a = 30
    if (a < -30) a = -30
  }
  return { mean, std, a, b }
}

function toScore(d: number, cal: Cal): number {
  const z = (d - cal.mean) / cal.std
  return 100 / (1 + Math.exp(-(cal.a * z + cal.b)))
}

/**
 * 把「50 分」锚定到 OOF 上 (灵敏度 + 特异度) 最大的切点（Youden 指数）。
 *
 * 为什么需要：Platt 拟合只保证概率校准，不保证 50 分落在业务上合理的操作点。
 * 实测现代模型那一版曾出现「灵敏度 99.8% / 特异度 30.2%」——AUC 明明 0.924，
 * 但 50 分的位置严重偏低，几乎把所有文本都判高。锚定后 50 分 = 均衡操作点，
 * 这才是一个能在页面上写「≥50 值得回头看」的前提。
 */
function anchorThreshold(deltas: number[], labels: number[], cal: Cal): Cal {
  // 排序后线性扫一遍，避免 O(n²)
  const sorted = deltas.map((d, i) => ({ d, y: labels[i] })).sort((x, y) => x.d - y.d)
  const pos = labels.filter((x) => x === 1).length
  const neg = labels.length - pos
  if (pos === 0 || neg === 0) return cal
  let best = { cut: sorted[sorted.length - 1].d, j: -Infinity }
  let tp = 0
  let fp = 0
  // 从最高 delta 往下扫：当前 cut 以上的样本都算「判为 AI」，
  // 于是 tp/fp 逐步累加，j = 灵敏度 + 特异度。（从低往高扫会把方向弄反，
  // 实测后果是 50 分被推到极值：灵敏度 0% / 特异度 100%，或反过来。）
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].y === 1) tp++
    else fp++
    const j = tp / pos + (neg - fp) / neg
    if (j > best.j) best = { cut: sorted[i].d, j }
  }
  const z = (best.cut - cal.mean) / cal.std
  return { ...cal, b: -cal.a * z }
}

// ---------- 分组：题目哈希 + 近似重复聚类 ----------
/**
 * 为什么不能只用「域名#行号」当分组键（v0.13.0 红队审计抓到的问题）：
 * HC3 里同一个 question 可能以两行出现（尤其 reddit_eli5），行号不同 → 分到不同 group
 * → 一行的答案进训练、另一行进留出，形成「同题跨集」。实测 96 个重复问题里有 36 个
 * 横跨训练/留出。这不是灾难（去掉泄漏后 AUC 只从 0.9493 掉到 0.9491），但**声明的协议
 * 与实际切法不符**，必须修掉。
 *
 * 另外 8-gram Jaccard > 0.8 的近似重复文本也要并进同一组：HC3 里存在大段一模一样的
 * 招行贷款回答、接口报错回显，跨集重复会让模型「背答案」而不是学文风。
 *
 * 做法：并查集。先按「域名 + 归一化题目哈希」合并，再按近似重复合并，
 * 最后每个连通分量 = 一个 group，整组同进同出。
 */
function normQuestion(q: string): string {
  return q.toLowerCase().replace(/[^0-9a-z\u4e00-\u9fff]+/g, '')
}

const SHINGLE_K = 8
const SIG_KEEP = 48

function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

function shingleHashes(text: string): Set<number> {
  const t = text.toLowerCase().replace(/\s+/g, ' ')
  const s = new Set<number>()
  for (let i = 0; i + SHINGLE_K <= t.length; i++) s.add(hashStr(t.slice(i, i + SHINGLE_K)))
  return s
}

/** bottom-k 签名：只留最小的 k 个 shingle 哈希，内存可控（43k 篇 × 48 个数） */
function signature(text: string): number[] {
  const heap: number[] = []
  const t = text.toLowerCase().replace(/\s+/g, ' ')
  const seen = new Set<number>()
  for (let i = 0; i + SHINGLE_K <= t.length; i++) {
    const h = hashStr(t.slice(i, i + SHINGLE_K))
    if (seen.has(h)) continue
    seen.add(h)
    if (heap.length < SIG_KEEP) {
      heap.push(h)
      if (heap.length === SIG_KEEP) heap.sort((a, b) => b - a) // 大顶堆（降序）
    } else if (h < heap[0]) {
      heap[0] = h
      heap.sort((a, b) => b - a)
    }
  }
  return heap.sort((a, b) => a - b)
}

function buildGroups(docs: Doc[]): { roots: number; mergedByQuestion: number; mergedByNearDup: number; mergedByExact: number } {
  const parent = new Int32Array(docs.length)
  for (let i = 0; i < docs.length; i++) parent[i] = i
  const find = (x: number): number => {
    let r = x
    while (parent[r] !== r) r = parent[r]
    while (parent[x] !== r) { const nx = parent[x]; parent[x] = r; x = nx }
    return r
  }
  const union = (a: number, b: number): boolean => {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return false
    parent[rb] = ra
    return true
  }

  // 1) 同题合并
  const byQuestion = new Map<string, number>()
  let mergedByQuestion = 0
  docs.forEach((d, i) => {
    const key = d.q ? `${d.domain}|${normQuestion(d.q)}` : d.group
    const prev = byQuestion.get(key)
    if (prev === undefined) byQuestion.set(key, i)
    else if (union(prev, i)) mergedByQuestion++
  })

  // 2) 近似重复合并
  //    单组 LSH 参数必然漏：8×6 漏了 2 对（J=0.870），16×3 又漏了 1 对（J=0.827）。
  //    改成**多组 banding 并集**（16×3 ∪ 24×2 ∪ 8×6）生成候选，再对候选算精确 Jaccard，
  //    合并阈值从 0.8 收紧到 0.7（合并只会更保守，代价仅是有效样本略少）。
  //    这样红队用其中任何一组参数复核，其候选集都是训练候选集的子集，结论可证明而非碰运气。
  const sigs = docs.map((d) => signature(d.text))

  // 2a) 完全相同文本先按归一化哈希合并（短文本凑不满 48 个 shingle，banding 用不了）
  const exactSeen = new Map<string, number>()
  let mergedByExact = 0
  docs.forEach((d, i) => {
    const key = normalizeLm(d.text)
    const prev = exactSeen.get(key)
    if (prev === undefined) exactSeen.set(key, i)
    else if (union(prev, i)) mergedByExact++
  })

  const CONFIGS: Array<[number, number]> = [[16, 3], [24, 2], [8, 6]]
  const cand = new Set<string>()
  for (const [BANDS, ROWS] of CONFIGS) {
    const buckets = new Map<string, number[]>()
    sigs.forEach((sig, i) => {
      if (sig.length < BANDS * ROWS) return
      for (let b = 0; b < BANDS; b++) {
        const key = `b${b}:` + sig.slice(b * ROWS, b * ROWS + ROWS).join(',')
        const arr = buckets.get(key)
        if (arr) arr.push(i)
        else buckets.set(key, [i])
      }
    })
    for (const ids of buckets.values()) {
      if (ids.length < 2) continue
      if (ids.length > 5000) continue // 病态大桶（签名退化），跳过避免把整域吞成一组
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = ids[i]
          const b = ids[j]
          cand.add(a < b ? `${a},${b}` : `${b},${a}`)
        }
      }
    }
  }

  const shingleCache = new Map<number, Set<number>>()
  const shinglesOf = (i: number) => {
    let s = shingleCache.get(i)
    if (!s) {
      s = shingleHashes(docs[i].text)
      if (shingleCache.size > 6000) shingleCache.delete(shingleCache.keys().next().value as number)
      shingleCache.set(i, s)
    }
    return s
  }
  const MERGE_JACCARD = 0.7
  let mergedByNearDup = 0
  for (const key of cand) {
    const [ai, bi] = key.split(',').map(Number)
    if (find(ai) === find(bi)) continue
    const a = shinglesOf(ai)
    const b = shinglesOf(bi)
    const [small, big] = a.size < b.size ? [a, b] : [b, a]
    let inter = 0
    for (const x of small) if (big.has(x)) inter++
    const jac = inter / Math.max(1, a.size + b.size - inter)
    if (jac > MERGE_JACCARD && union(ai, bi)) mergedByNearDup++
  }
  console.log(`近似重复：候选 ${cand.size.toLocaleString()} 对（三组 banding 并集），J>${MERGE_JACCARD} 合并 ${mergedByNearDup} 次；完全相同文本另合并 ${mergedByExact} 次`)

  // 3) 连通分量落成 group 名
  const names = new Map<number, string>()
  docs.forEach((d, i) => {
    const r = find(i)
    let name = names.get(r)
    if (!name) { name = `g${r}`; names.set(r, name) }
    d.group = name
  })
  return { roots: names.size, mergedByQuestion, mergedByNearDup, mergedByExact }
}

// ---------- 主流程 ----------
const t0 = Date.now()
const { docs, stats } = loadCorpus()
const grp = buildGroups(docs)

// 按「文档数」而非「组数」配额切 20%：并查集合并后组的大小极不均匀
// （招行贷款模板、reddit 多评论拼接都成了大组），按组数切会让留出集比例失真。
const countByGroup = new Map<string, number>()
for (const d of docs) countByGroup.set(d.group, (countByGroup.get(d.group) ?? 0) + 1)
const shuf = shuffle([...countByGroup.keys()], mulberry32(SEED))
const holdGroups = new Set<string>()
const target = Math.floor(docs.length * 0.2)
let acc = 0
for (const g of shuf) {
  if (acc >= target) break
  holdGroups.add(g)
  acc += countByGroup.get(g) ?? 0
}
const trainDocs = docs.filter((d) => !holdGroups.has(d.group))
const holdDocs = docs.filter((d) => holdGroups.has(d.group))

// 落盘训练/留出集原文，供第三方独立复算（scripts/verify-lm.ts 与 scripts/audit-lm-*.ts 都读这份）。
// 训练集也落盘：审计才能独立验证「同题/近重复是否真的没有跨集」，而不是只信 split.json 的自述。
const SPLIT_DIR = path.join(ROOT, 'calibration', 'lm')
fs.mkdirSync(SPLIT_DIR, { recursive: true })
const dump = (arr: Doc[], name: string) => fs.writeFileSync(path.join(SPLIT_DIR, name),
  arr.map((d) => JSON.stringify({ id: d.id, group: d.group, q: d.q, label: d.label, domain: d.domain, origin: d.origin, text: d.text })).join('\n'))
// 两种方言各存一套切分：否则后训练的方言会覆盖前一个的留出集，
// 让 verify-lm 拿 A 的产物去对 B 的留出集（实测会算出 0.4999 这种假不一致）。
dump(holdDocs, `holdout${OUT_SUFFIX}.jsonl`)
dump(trainDocs, `train${OUT_SUFFIX}.jsonl`)
fs.writeFileSync(path.join(SPLIT_DIR, `split${OUT_SUFFIX}.json`), JSON.stringify({
  seed: SEED,
  method: '同题哈希 ∪ 完全相同文本 ∪ 三组 banding 并集 J>0.7 近重复聚类（并查集）；按文档数切 20%',
  groups: grp.roots,
  mergedByQuestion: grp.mergedByQuestion,
  mergedByExact: grp.mergedByExact,
  mergedByNearDup: grp.mergedByNearDup,
  holdoutGroups: [...holdGroups].sort(),
  trainCount: trainDocs.length,
  holdoutCount: holdDocs.length,
}, null, 2))

const chars = (arr: Doc[]) => arr.reduce((s, d) => s + d.text.length, 0)
console.log(`清洗：原始 ${stats.raw} 条 → 方言过滤 ${stats.otherDialect}、过短 ${stats.tooShort}、拒答模板 ${stats.refusal}、接口报错模板 ${stats.junk} → 保留 ${stats.kept}（其中现代模型同题补语料 ${stats.modern} 篇）`)
console.log(`AI 方言：${AI_FROM} → 产物 lm-char2${OUT_SUFFIX}.bin`)
console.log(`分组：${grp.roots} 组（同题合并 ${grp.mergedByQuestion} 次、近似重复合并 ${grp.mergedByNearDup} 次）`)
console.log(`切分：train ${trainDocs.length} 篇（${chars(trainDocs).toLocaleString()} 字）/ holdout ${holdDocs.length} 篇（${chars(holdDocs).toLocaleString()} 字）`)
const trainGroupSet = new Set(trainDocs.map((d) => d.group))
console.log(`泄漏检查：留出集 group 同时出现在训练集的数量 = ${holdDocs.filter((d) => trainGroupSet.has(d.group)).length}`)

// 5 折 OOF（用于标定 + 报告泛化误差）
const trainGroups = shuffle([...new Set(trainDocs.map((d) => d.group))], mulberry32(SEED + 1))
const foldOf = new Map<string, number>()
trainGroups.forEach((g, i) => foldOf.set(g, i % FOLDS))

const oofDeltas: number[] = []
const oofLabels: number[] = []
const foldAucs: number[] = []
for (let f = 0; f < FOLDS; f++) {
  const fit = trainDocs.filter((d) => (foldOf.get(d.group) ?? 0) !== f)
  const ev = trainDocs.filter((d) => (foldOf.get(d.group) ?? 0) === f)
  const hM = toRuntime(quantizeModel(trainModel(fit.filter((d) => d.label === 0))))
  const aM = toRuntime(quantizeModel(trainModel(fit.filter((d) => d.label === 1))))
  const ds = ev.map((d) => delta(hM, aM, d.text))
  const ls = ev.map((d) => d.label)
  oofDeltas.push(...ds)
  oofLabels.push(...ls)
  foldAucs.push(auc(ds, ls))
  console.log(`  fold ${f + 1}/${FOLDS} AUC=${foldAucs[f].toFixed(3)}`)
}

const meanAuc = foldAucs.reduce((a, b) => a + b, 0) / foldAucs.length
const stdAuc = Math.sqrt(foldAucs.reduce((a, b) => a + (b - meanAuc) ** 2, 0) / foldAucs.length)
console.log(`5 折 OOF AUC = ${meanAuc.toFixed(3)} ± ${stdAuc.toFixed(3)}`)

const calRaw = fitPlatt(oofDeltas, oofLabels)
// 把 50 分锚到 OOF 上 (灵敏度+特异度) 最大的切点：Platt 只保证概率校准，
// 不保证 50 分落在合理的操作点上（现代方言版本曾出现 99.8%/30.2% 的退化）。
const cal = anchorThreshold(oofDeltas, oofLabels, calRaw)
console.log(`标定：mean=${cal.mean.toFixed(4)} std=${cal.std.toFixed(4)} a=${cal.a.toFixed(3)} b=${cal.b.toFixed(3)}（50 分已锚定到均衡操作点）`)

// 最终模型：用全部训练集重训
const hBuilt = quantizeModel(trainModel(trainDocs.filter((d) => d.label === 0)))
const aBuilt = quantizeModel(trainModel(trainDocs.filter((d) => d.label === 1)))
const hM = toRuntime(hBuilt)
const aM = toRuntime(aBuilt)
console.log(`最终模型：真人 vocab ${hBuilt.chars.length} / AI vocab ${aBuilt.chars.length}，字符总数 H=${hBuilt.total.toLocaleString()} A=${aBuilt.total.toLocaleString()}`)

// 留出集评估
const hd = holdDocs.map((d) => delta(hM, aM, d.text))
const hl = holdDocs.map((d) => d.label)
const holdAuc = auc(hd, hl)

// 分域 AUC + 宏平均
// 同时算「只用文本长度」这一个纯表层特征的 AUC：如果它比模型还高，
// 说明该域的高 AUC 靠的是排版/篇幅差异，而不是文风（红队审计提出的质疑，必须自己先量）。
const perDomain: Array<{ domain: string; n: number; ai: number; human: number; auc: number; lenAuc: number }> = []
for (const dom of [...new Set(holdDocs.map((d) => d.domain))].sort()) {
  const idxs = holdDocs.map((d, i) => (d.domain === dom ? i : -1)).filter((i) => i >= 0)
  const ds = idxs.map((i) => hd[i])
  const ls = idxs.map((i) => hl[i])
  const lens = idxs.map((i) => holdDocs[i].text.length)
  const ai = ls.filter((x) => x === 1).length
  if (ai < 10 || ls.length - ai < 10) continue
  const lenAucRaw = auc(lens, ls)
  perDomain.push({ domain: dom, n: ls.length, ai, human: ls.length - ai, auc: auc(ds, ls), lenAuc: Math.max(lenAucRaw, 1 - lenAucRaw) })
}
const macroAuc = perDomain.reduce((s, d) => s + d.auc, 0) / perDomain.length

// 模型跑不过「只看长度」的域：必须如实写进指标文件与页面
const lenWins = perDomain
  .filter((d) => d.lenAuc > d.auc)
  .sort((a, b) => (b.lenAuc - b.auc) - (a.lenAuc - a.auc))
const formatBaseline = lenWins.length > 0
  ? { domain: lenWins[0].domain, modelAuc: lenWins[0].auc, lengthAuc: lenWins[0].lenAuc, gap: Number((lenWins[0].lenAuc - lenWins[0].auc).toFixed(3)) }
  : null

// 现代模型子集：v0.14 起 AI 侧不再只有 2023 年的 ChatGPT，
// 这里单独量「人写 vs 2026 现代模型」的 AUC 与召回，避免整体 AUC 掩盖住真实能力变化。
const idxOf = (pred: (d: Doc) => boolean) => holdDocs.map((d, i) => (pred(d) ? i : -1)).filter((i) => i >= 0)
const humanIdx = idxOf((d) => d.label === 0)
const hc3AiIdx = idxOf((d) => d.label === 1 && d.origin === 'hc3')
const modAiIdx = idxOf((d) => d.label === 1 && d.origin === 'modern')
function subsetMetric(aiIdx: number[]): { n: number; ai: number; human: number; auc: number; recall50: number } | null {
  if (aiIdx.length < 20 || humanIdx.length < 20) return null
  const idx = [...humanIdx, ...aiIdx]
  const ds = idx.map((i) => hd[i])
  const ls = idx.map((i) => hl[i])
  const sc = ds.map((d) => toScore(d, cal))
  const aiScores = aiIdx.map((i, k) => sc[humanIdx.length + k])
  return {
    n: idx.length,
    ai: aiIdx.length,
    human: humanIdx.length,
    auc: auc(ds, ls),
    recall50: aiScores.filter((s) => s >= 50).length / aiScores.length,
  }
}
const modernSubset = subsetMetric(modAiIdx)
const hc3Subset = subsetMetric(hc3AiIdx)
if (modernSubset) console.log(`人写 vs 现代模型（2025–26）：AUC ${modernSubset.auc.toFixed(3)}，阈值 50 召回 ${(modernSubset.recall50 * 100).toFixed(1)}%（n=${modernSubset.n}，AI 侧 ${modernSubset.ai}）`)
if (hc3Subset) console.log(`人写 vs 2023 ChatGPT：AUC ${hc3Subset.auc.toFixed(3)}，阈值 50 召回 ${(hc3Subset.recall50 * 100).toFixed(1)}%`)

// 跨域：学术摘要
let crossDomain: { n: number; ai: number; human: number; auc: number; scoreMin: number; scoreMax: number } | null = null
if (fs.existsSync(ACADEMIC)) {
  const aca = readJsonl(ACADEMIC)
    .filter((r) => typeof r.text === 'string' && (r.text as string).length >= 120)
    .map((r) => ({ label: (Number(r.label) === 1 ? 1 : 0) as 0 | 1, text: r.text as string }))
  const ds = aca.map((d) => delta(hM, aM, d.text))
  const ls = aca.map((d) => d.label)
  const scores = ds.map((d) => toScore(d, cal))
  crossDomain = {
    n: ls.length,
    ai: ls.filter((x) => x === 1).length,
    human: ls.filter((x) => x === 0).length,
    auc: auc(ds, ls),
    scoreMin: Math.round(Math.min(...scores)),
    scoreMax: Math.round(Math.max(...scores)),
  }
}

// 阈值 50 的灵敏度 / 特异度
const holdScores = hd.map((d) => toScore(d, cal))
let tp = 0, fn = 0, tn = 0, fp = 0
for (let i = 0; i < holdScores.length; i++) {
  const pred = holdScores[i] >= 50 ? 1 : 0
  if (hl[i] === 1) {
    if (pred === 1) tp++
    else fn++
  } else if (pred === 1) {
    fp++
  } else {
    tn++
  }
}
const sensitivity = tp / Math.max(1, tp + fn)
const specificity = tn / Math.max(1, tn + fp)

// 导出二进制（自描述头，运行时无需额外元数据即可解析）
const HEADER = 24
const perModelSize = (m: Quantized) => m.chars.length * 8 + LM_TABLE_SIZE
const buf = Buffer.alloc(HEADER + perModelSize(hBuilt) + perModelSize(aBuilt))
buf.write('RALM', 0, 'ascii')
buf.writeUInt16LE(1, 4)
buf.writeUInt8(LM_ORDER, 6)
buf.writeUInt8(LM_BITS, 7)
buf.writeUInt32LE(hBuilt.chars.length, 8)
buf.writeUInt32LE(aBuilt.chars.length, 12)
buf.writeUInt32LE(LM_TABLE_SIZE, 16)
buf.writeUInt32LE(0, 20)
let off = HEADER
for (const m of [hBuilt, aBuilt]) {
  for (const c of m.chars) { buf.writeUInt32LE(c.codePointAt(0) ?? 0, off); off += 4 }
  for (let i = 0; i < m.chars.length; i++) { buf.writeUInt32LE(m.unigram[i], off); off += 4 }
  Buffer.from(m.table).copy(buf, off)
  off += LM_TABLE_SIZE
}
fs.writeFileSync(OUT_BIN, buf)
// 预压缩版本：GitHub Pages 不会为 .bin 自动 gzip，浏览器端用 DecompressionStream 解开
const gz = zlib.gzipSync(buf, { level: 9 })
fs.writeFileSync(`${OUT_BIN}.gz`, gz)
fs.writeFileSync(OUT_META, JSON.stringify({
  format: 'RALM-v1',
  file: `lm-char2${OUT_SUFFIX}.bin`,
  aiDialect: AI_FROM,
  order: LM_ORDER,
  bits: LM_BITS,
  tableSize: LM_TABLE_SIZE,
  models: [
    { name: 'human', vocab: hBuilt.chars.length, chars: hBuilt.total },
    { name: 'ai', vocab: aBuilt.chars.length, chars: aBuilt.total },
  ],
  interpolation: { bigram: LM_W2, unigram: LM_W1 },
  calibration: {
    mean: Number(cal.mean.toFixed(4)),
    std: Number(cal.std.toFixed(4)),
    a: Number(cal.a.toFixed(4)),
    b: Number(cal.b.toFixed(4)),
  },
  sizeBytes: buf.length,
  sizeGzBytes: gz.length,
  trainedAt: new Date().toISOString().slice(0, 10),
  seed: SEED,
}, null, 2))

fs.writeFileSync(OUT_VALID, JSON.stringify({
  meta: {
    model: '字符 2-gram 双语言模型（真人 / AI 各一个）+ Platt 标定',
    aiDialect: AI_FROM === 'modern' ? '现代模型方言（2025–26 同题重生成）' : AI_FROM === 'chatgpt2023' ? '2023 ChatGPT 方言（HC3 原生）' : '两种方言混合',
    note: AI_FROM === 'modern'
      ? '本产物专测「像不像 2025–26 现代模型」。线上与 2023 方言产物并行加载，各算一个读数，取更接近的那个。'
      : AI_FROM === 'chatgpt2023'
        ? '本产物专测「像不像 2023 年 ChatGPT」。配合 lm-char2-modern.bin 覆盖现代模型文风。'
        : '混合方言产物（历史口径）。实测会互相稀释：认 2023 好时认现代差，反之亦然。',
    dataset: `HC3（Chris 等，Hello-SimpleAI，CC BY-SA 4.0）中英 ${perDomain.length} 个领域 + 现代模型同题补语料 ${stats.modern} 篇；清洗后 ${docs.length} 篇`,
    modernCorpus: stats.modern > 0
      ? `AI 侧有两个来源：① HC3 原生 2023 年初 ChatGPT 答案；② scripts/gen-modern-ai.ts 用现代模型对**同一批问题**重新生成 ${stats.modern} 篇（同题必同组，不产生跨集泄漏；仅 DeepSeek 一个厂商）。`
      : 'AI 侧只有 HC3 原生的 2023 年初 ChatGPT 答案，未补现代模型语料。',
    protocol: `按 question 哈希 + 近似重复聚类分组（并查集），同组不跨集，按文档数切 80/20；${FOLDS} 折交叉验证；标定参数用 OOF 预测拟合，不用测试集`,
    filters: `剔除 <${MIN_CHARS} 字符碎片、拒答模板与接口报错模板（network error / token expired / too many requests 等）。单域单类上限 ${MAX_DOCS_PER_CELL} 篇 / ${(MAX_CHARS_PER_CELL / 1e6).toFixed(1)}M 字符，防止口语英文子集从体积上淹没中文。`,
    split: `并查集连通分量 ${grp.roots} 组；同题合并 ${grp.mergedByQuestion} 次、完全相同文本 ${grp.mergedByExact} 次、近似重复（8-gram J>0.7，三组 banding 并集）${grp.mergedByNearDup} 次；留出 ${holdDocs.length} / 训练 ${trainDocs.length}`,
    trainedAt: new Date().toISOString().slice(0, 10),
    reproducible: 'npx tsx scripts/train-lm.ts',
    audited: 'docs/model-audit.md（独立复算 scripts/audit-lm-recompute.ts + 泄漏审查 scripts/audit-lm-leak.ts）',
  },
  inDomain: {
    holdoutAuc: Number(holdAuc.toFixed(3)),
    holdoutN: hl.length,
    cvAucMean: Number(meanAuc.toFixed(3)),
    cvAucStd: Number(stdAuc.toFixed(3)),
    folds: foldAucs.map((x) => Number(x.toFixed(3))),
    macroAucOverDomains: Number(macroAuc.toFixed(3)),
    perDomain: perDomain.map((d) => ({ ...d, auc: Number(d.auc.toFixed(3)), lenAuc: Number(d.lenAuc.toFixed(3)) })),
    formatBaseline,
    atThreshold50: {
      sensitivity: Number(sensitivity.toFixed(3)),
      specificity: Number(specificity.toFixed(3)),
    },
  },
  crossDomain,
  // 分生成器单列：整体 AUC 会把「认得 2023 ChatGPT」和「认得 2026 现代模型」混成一个数，
  // 学生真正关心的是后者，必须单独给出来，不能让它藏在均值里。
  byGenerator: {
    humanVsModern: modernSubset,
    humanVsChatGpt2023: hc3Subset,
  },
  caveats: [
    '域内高 AUC 部分来自文体差异（问答口语 vs 助手书面体），不代表能识别任意体裁的学生作文。',
    stats.modern > 0
      ? 'AI 侧包含 2023 年的 ChatGPT 与 2025–26 年的现代模型（DeepSeek 同题重生成）。现代模型只覆盖一个厂商、一种提问方式，对豆包 / Kimi / Claude / Gemini 的判别力未验证，别外推。'
      : '训练语料的 AI 文本是 2023 年初的 ChatGPT（gpt-3.5 一代），与当前模型文风已有差距。',
    '学术论文属于跨域场景，本通道读数不可作为定性依据，只能作为风格参考。',
    '语言模型读数测量的是「与训练语料的文风接近程度」，不是「作者是否使用 AI」。',
    `阈值 50 时特异度 ${(specificity * 100).toFixed(1)}%：每 4 个真人里约有 1 个会被读到高分（数据来自留出集 ${hl.length.toLocaleString()} 篇）。`,
    formatBaseline
      ? `在 ${formatBaseline.domain} 这一域，模型 AUC ${formatBaseline.modelAuc.toFixed(3)} 反而低于「只看文本长度」这一个表层特征的 ${formatBaseline.lengthAuc.toFixed(3)}——说明部分判别力可被排版/篇幅解释，不是纯文风。`
      : '各域模型 AUC 均高于「只看文本长度」的表层基线，但仍不能排除其他排版捷径。',
    '个别口语域（如 reddit_eli5）AUC 接近 1.000，主要来自拼写、俚语与书面体的差异（该域最强单表层特征仅 0.798），属数据集特性，不能外推到学生作文。',
    '红队审计曾发现「同题跨集 36 题 + 771 对近似重复跨集」，已改为按题目哈希与近似重复聚类分组后重训，当前切分不复现该问题（见 docs/model-audit.md）。',
    '内部探针（scripts/probe-student-style.ts）：6 段手写中文学生文风 5 段被判 0–2 分（正确压低），1 段非母语英文被判 54 分（真实误伤）。但同一批留出集里 <200 字文本的 AUC 仍有 0.949——所以失效点不在「短」，而在**体裁**：模型学的是问答体，学生议论文不在这个分布里。低分不代表清白，高分也不代表作弊。',
  ],
}, null, 2))

// 自检：从二进制回读并重算，确认导出没有错位
const raw = fs.readFileSync(OUT_BIN)
console.log(`\n导出：${path.relative(ROOT, OUT_BIN)} ${(raw.length / 1e6).toFixed(2)}MB`)
console.log(`校验 magic=${raw.toString('ascii', 0, 4)} bits=${raw.readUInt8(7)} vocabH=${raw.readUInt32LE(8)} vocabA=${raw.readUInt32LE(12)} tableSize=${raw.readUInt32LE(16)}`)
console.log(`\n留出集 AUC = ${holdAuc.toFixed(3)}（n=${hl.length}）｜宏平均 AUC = ${macroAuc.toFixed(3)}｜阈值50 灵敏度 ${(sensitivity * 100).toFixed(1)}% / 特异度 ${(specificity * 100).toFixed(1)}%`)
if (crossDomain) console.log(`学术跨域 AUC = ${crossDomain.auc.toFixed(3)}（n=${crossDomain.n}，AI ${crossDomain.ai} / 真人 ${crossDomain.human}），分数区间 ${crossDomain.scoreMin}–${crossDomain.scoreMax}`)
console.log(`\n分域：`)
for (const d of perDomain) {
  const flag = d.lenAuc > d.auc ? ' ⚠️ 低于「只看长度」基线' : ''
  console.log(`  ${d.domain.padEnd(18)} n=${String(d.n).padStart(5)} AUC=${d.auc.toFixed(3)}  长度基线=${d.lenAuc.toFixed(3)}${flag}`)
}
if (formatBaseline) {
  console.log(`\n⚠️ 格式基线告警：${formatBaseline.domain} 模型 ${formatBaseline.modelAuc.toFixed(3)} < 长度单特征 ${formatBaseline.lengthAuc.toFixed(3)}（差 ${formatBaseline.gap}）`)
}
console.log(`\n总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
