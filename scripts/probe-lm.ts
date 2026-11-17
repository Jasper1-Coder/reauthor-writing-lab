/**
 * 可行性探针：字符级 3-gram 语言模型的似然比到底有没有判别力？
 *
 * 训练两个语言模型：一个只用真人文本、一个只用 AI 文本。
 * 对一篇文本，分别算它在两个模型下的平均对数概率（就是负的交叉熵）。
 * 如果 AI 文本在 AI 模型下更「可预测」，说明似然比是有效信号。
 *
 * 这是探针，不是产物：只回答「值不值得做」，不做导出、不做上线。
 * 用法：npx tsx scripts/probe-lm.ts
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const RAW = path.join(ROOT, 'calibration', 'raw')
const SEED = 20261117

// ---------- 语料 ----------
interface Doc { group: string; domain: string; label: 0 | 1; text: string }

function readJsonl(file: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l) } catch { return {} }
  })
}

function loadCorpus(): Doc[] {
  const out: Doc[] = []
  for (const f of fs.readdirSync(RAW)) {
    if (!f.endsWith('.jsonl')) continue
    const rows = readJsonl(path.join(RAW, f))
    rows.forEach((row, i) => {
      const group = `${f}#${i}`
      const domain = f.replace('.jsonl', '')
      const h = (row.human_answers as string[] | undefined) ?? []
      const a = (row.chatgpt_answers as string[] | undefined) ?? []
      for (const t of h) if (t && t.length >= 40) out.push({ group, domain, label: 0, text: t })
      for (const t of a) if (t && t.length >= 40) out.push({ group, domain, label: 1, text: t })
    })
  }
  return out
}

/** 归一化：保留中日韩汉字、拉丁字母、数字、常用标点；空白压成单空格；拉丁小写化 */
function normalize(text: string): string {
  const lower = text.toLowerCase()
  let out = ''
  for (const ch of lower) {
    const c = ch.codePointAt(0) ?? 0
    const isCjk = (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)
    const isLatin = c >= 0x61 && c <= 0x7a
    const isDigit = c >= 0x30 && c <= 0x39
    const isPunct = ',.!?;:，。！？；：、（）()“”"\'‘’\n'.includes(ch)
    if (isCjk || isLatin || isDigit) out += ch
    else if (isPunct) out += ch === '\n' ? ' ' : ch
    else if (ch === ' ' || ch === '\t' || ch === '\r') out += ' '
  }
  return out.replace(/ +/g, ' ').trim()
}

// ---------- 哈希 ----------
function hashStr(s: string, salt: number): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0)
}

const H3_BITS = 23
const H2_BITS = 21
const H3_SIZE = 1 << H3_BITS
const H2_SIZE = 1 << H2_BITS
const H3_MASK = H3_SIZE - 1
const H2_MASK = H2_SIZE - 1

interface Lm {
  uni: Map<string, number>
  total: number
  tri: Uint32Array
  bi: Uint32Array
}

function newLm(): Lm {
  return { uni: new Map(), total: 0, tri: new Uint32Array(H3_SIZE), bi: new Uint32Array(H2_SIZE) }
}

function trainLm(docs: Doc[]): Lm {
  const lm = newLm()
  for (const d of docs) {
    const t = normalize(d.text)
    if (t.length < 3) continue
    for (let i = 0; i < t.length; i++) {
      const c = t[i]
      lm.uni.set(c, (lm.uni.get(c) ?? 0) + 1)
      lm.total++
      if (i >= 1) {
        const k = hashStr(c, 7) ^ hashStr(t[i - 1], 13)
        lm.bi[k & H2_MASK]++
      }
      if (i >= 2) {
        const k = hashStr(c, 7) ^ hashStr(t[i - 1], 13) ^ hashStr(t[i - 2], 29)
        lm.tri[k & H3_MASK]++
      }
    }
  }
  return lm
}

/** 插值平滑：p = a3*p3 + a2*p2 + a1*p1，返回 log2 p */
const A3 = 0.55, A2 = 0.33, A1 = 0.12
let ORDER = 3

function scoreDoc(lm: Lm, text: string): { meanLogp: number; n: number } {
  const t = normalize(text)
  if (t.length < 3) return { meanLogp: -20, n: 0 }
  let sum = 0, n = 0
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    const u = lm.uni.get(c) ?? 0
    const p1 = u > 0 ? u / lm.total : 1e-9
    let p2 = 0
    if (i >= 1) {
      const k2 = (hashStr(c, 7) ^ hashStr(t[i - 1], 13)) & H2_MASK
      const cnt2 = lm.bi[k2]
      const ctx1 = lm.uni.get(t[i - 1]) ?? 0
      p2 = ctx1 > 0 ? cnt2 / ctx1 : 0
    }
    let p3 = 0
    if (i >= 2) {
      const k3 = (hashStr(c, 7) ^ hashStr(t[i - 1], 13) ^ hashStr(t[i - 2], 29)) & H3_MASK
      const k2ctx = (hashStr(t[i - 1], 7) ^ hashStr(t[i - 2], 13)) & H2_MASK
      const ctx = lm.bi[k2ctx]
      p3 = ctx > 0 ? lm.tri[k3] / ctx : 0
    }
    const p = ORDER >= 3
      ? A3 * p3 + A2 * p2 + A1 * p1
      : (ORDER === 2 ? 0.8 * p2 + 0.2 * p1 : p1)
    sum += Math.log2(Math.max(p, 1e-9))
    n++
  }
  return { meanLogp: sum / n, n }
}

// ---------- 评估 ----------
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
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

// ---------- 主流程 ----------
const t0 = Date.now()
const all = loadCorpus()
const groups = [...new Set(all.map((d) => d.group))]
const rand = mulberry32(SEED)
const shuffled = [...groups].sort(() => rand() - 0.5)
const holdoutSet = new Set(shuffled.slice(0, Math.floor(groups.length * 0.2)))
const train = all.filter((d) => !holdoutSet.has(d.group))
const test = all.filter((d) => holdoutSet.has(d.group))

console.log(`语料 ${all.length} 篇 / 分组 ${groups.length} 个`)
console.log(`训练 ${train.length} 篇，留出 ${test.length} 篇`)
console.log(`训练字符数：human ${train.filter(d => d.label === 0).reduce((s, d) => s + d.text.length, 0).toLocaleString()}，ai ${train.filter(d => d.label === 1).reduce((s, d) => s + d.text.length, 0).toLocaleString()}`)

const lmH = trainLm(train.filter((d) => d.label === 0))
const lmA = trainLm(train.filter((d) => d.label === 1))
console.log(`训练完成 ${((Date.now() - t0) / 1000).toFixed(1)}s；vocab H=${lmH.uni.size} A=${lmA.uni.size}`)

let nonEmptyH = 0
for (let i = 0; i < H3_SIZE; i++) if (lmH.tri[i] > 0) nonEmptyH++
console.log(`人类模型非空 trigram 桶：${nonEmptyH.toLocaleString()} / ${H3_SIZE.toLocaleString()}（占用率 ${(nonEmptyH / H3_SIZE * 100).toFixed(1)}%）`)

// 逐篇打分
interface EvalSet { name: string; docs: Doc[] }
const sets: EvalSet[] = [{ name: '留出集(HC3)', docs: test }]

// 跨域：中文学术摘要（外部测试集，绝不参与训练）
const acaFile = path.join(ROOT, 'crossdomain', 'academic_zh.jsonl')
if (fs.existsSync(acaFile)) {
  const aca = readJsonl(acaFile)
    .filter((r) => typeof r.text === 'string' && (r.text as string).length >= 120)
    .map((r, i) => ({
      group: `aca#${i}`,
      domain: 'academic_zh',
      label: (Number(r.label) === 1 ? 1 : 0) as 0 | 1,
      text: r.text as string,
    }))
  const n1 = aca.filter((d) => d.label === 1).length
  console.log(`\n学术跨域集：${aca.length} 篇（AI 标注 ${n1} 篇，真人 ${aca.length - n1} 篇）`)
  sets.push({ name: '学术跨域(academic_zh)', docs: aca })
}

const labelCount = new Map<string, { pos: number; neg: number }>()
for (const s of sets) {
  labelCount.set(s.name, {
    pos: s.docs.filter((d) => d.label === 1).length,
    neg: s.docs.filter((d) => d.label === 0).length,
  })
}

for (const order of [1, 2, 3]) {
  ORDER = order
  console.log(`\n########## 阶数 ORDER=${order} ##########`)
  for (const s of sets) {
    const labels: number[] = []
    const sDelta: number[] = []
    const sHumanOnly: number[] = []
    const sAiOnly: number[] = []
    const sBurst: number[] = []
    const domains: string[] = []

    for (const d of s.docs) {
      const h = scoreDoc(lmH, d.text)
      const a = scoreDoc(lmA, d.text)
      labels.push(d.label)
      domains.push(d.domain)
      sDelta.push(a.meanLogp - h.meanLogp)
      sHumanOnly.push(-h.meanLogp)
      sAiOnly.push(a.meanLogp)

      const sents = d.text.split(/[。！？.!?\n]+/).filter((x) => x.trim().length >= 8)
      if (sents.length >= 4) {
        const per = sents.map((x) => scoreDoc(lmA, x).meanLogp - scoreDoc(lmH, x).meanLogp)
        const m = per.reduce((x, y) => x + y, 0) / per.length
        const v = per.reduce((x, y) => x + (y - m) ** 2, 0) / per.length
        sBurst.push(Math.sqrt(v))
      } else {
        sBurst.push(0)
      }
    }

    const cnt = labelCount.get(s.name)!
    if (cnt.pos < 5 || cnt.neg < 5) {
      console.log(`  ${s.name}: 单类样本不足（AI ${cnt.pos} / 真人 ${cnt.neg}），不做 AUC`)
      continue
    }
    console.log(`  ${s.name}  n=${labels.length}（AI ${cnt.pos} / 真人 ${cnt.neg}）`)
    console.log(`    双模型似然比      AUC=${auc(sDelta, labels).toFixed(3)}`)
    console.log(`    只用人类模型 -logp AUC=${auc(sHumanOnly, labels).toFixed(3)}`)
    console.log(`    只用 AI 模型 logp  AUC=${auc(sAiOnly, labels).toFixed(3)}`)
    console.log(`    句间波动(无向)     AUC=${auc(sBurst, labels).toFixed(3)}`)
    if (s.name === '留出集(HC3)') {
      const parts: string[] = []
      for (const dom of [...new Set(domains)].sort()) {
        const sv = sDelta.filter((_, i) => domains[i] === dom)
        const lv = labels.filter((_, i) => domains[i] === dom)
        if (lv.filter((x) => x === 1).length < 10 || lv.filter((x) => x === 0).length < 10) continue
        parts.push(`${dom} ${auc(sv, lv).toFixed(3)}`)
      }
      console.log(`    分域：${parts.join('  ')}`)
    }
  }
}

console.log(`\n总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`)
