/**
 * 对抗性审查：模型到底学到了「文风」还是「排版捷径」？以及能压到多小？
 *
 * 三个消融：
 *   1. base        —— 现状归一化（保留数字、标点）
 *   2. nodigit     —— 删掉所有数字（消掉 "1. 2. 3." 这类列表编号）
 *   3. nodigitpunct—— 数字和标点全删（只剩汉字/字母）
 *   4. nows        —— 连空格都删（彻底消掉分行、缩进）
 *
 * 若删掉数字后 AUC 大幅坍塌，说明模型学的是排版不是文风，必须修。
 * 另外扫一遍表大小与剪枝阈值，找到「AUC 不塌 + 体积可上线」的配置。
 *
 * 用法：npx tsx scripts/probe-ablate.ts
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const RAW = path.join(ROOT, 'calibration', 'raw')
const SEED = 20261117

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
    readJsonl(path.join(RAW, f)).forEach((row, i) => {
      const group = `${f}#${i}`
      const domain = f.replace('.jsonl', '')
      for (const t of ((row.human_answers as string[]) ?? [])) if (t && t.length >= 40) out.push({ group, domain, label: 0, text: t })
      for (const t of ((row.chatgpt_answers as string[]) ?? [])) if (t && t.length >= 40) out.push({ group, domain, label: 1, text: t })
    })
  }
  return out
}

interface NormOpt { digits: boolean; punct: boolean; space: boolean; caseFold: boolean }
const PUNCT = ',.!?;:，。！？；：、（）()“”"\'‘’'

function normalize(text: string, o: NormOpt): string {
  let out = ''
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    const isCjk = (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)
    const isLatin = c >= 0x61 && c <= 0x7a
    const isUpper = c >= 0x41 && c <= 0x5a
    const isDigit = c >= 0x30 && c <= 0x39
    if (isCjk || isLatin) out += ch
    else if (isUpper) out += o.caseFold ? ch.toLowerCase() : ch
    else if (isDigit && o.digits) out += ch
    else if (PUNCT.includes(ch) && o.punct) out += ch
    else if ((ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') && o.space) out += ' '
  }
  return o.space ? out.replace(/ +/g, ' ').trim() : out
}

function hashStr(s: string, salt: number): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

interface Config { name: string; norm: NormOpt; order: 1 | 2 | 3 }
interface Built { uni: Map<string, number>; total: number; h1: Uint32Array; h2: Uint32Array; h3: Uint32Array }

function train(docs: Doc[], cfg: Config, bits: number): Built {
  const s1 = 1 << Math.min(bits, 18)
  const s2 = 1 << bits
  const s3 = 1 << bits
  const uni = new Map<string, number>()
  const h1 = new Uint32Array(s1)
  const h2 = new Uint32Array(s2)
  const h3 = new Uint32Array(s3)
  let total = 0
  for (const d of docs) {
    const t = normalize(d.text, cfg.norm)
    for (let i = 0; i < t.length; i++) {
      const c = t[i]
      uni.set(c, (uni.get(c) ?? 0) + 1); total++
      if (i >= 1) h2[(hashStr(c, 7) ^ hashStr(t[i - 1], 13)) & (s2 - 1)]++
      if (i >= 2) h3[(hashStr(c, 7) ^ hashStr(t[i - 1], 13) ^ hashStr(t[i - 2], 29)) & (s3 - 1)]++
      h1[hashStr(c, 7) & (s1 - 1)]++
    }
  }
  return { uni, total, h1, h2, h3 }
}

function score(m: Built, text: string, cfg: Config, bits: number, prune: number): number {
  const t = normalize(text, cfg.norm)
  if (t.length < 3) return -20
  const s2 = 1 << bits, s3 = 1 << bits
  let sum = 0, n = 0
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    const u = m.uni.get(c) ?? 0
    const p1 = u > 0 ? u / m.total : 1e-9
    let p2 = 0
    if (i >= 1) {
      const cnt = m.h2[(hashStr(c, 7) ^ hashStr(t[i - 1], 13)) & (s2 - 1)]
      const ctx = m.uni.get(t[i - 1]) ?? 0
      if (cnt >= prune && ctx > 0) p2 = cnt / ctx
    }
    let p3 = 0
    if (i >= 2 && cfg.order >= 3) {
      const cnt = m.h3[(hashStr(c, 7) ^ hashStr(t[i - 1], 13) ^ hashStr(t[i - 2], 29)) & (s3 - 1)]
      const ctx = m.h2[(hashStr(t[i - 1], 7) ^ hashStr(t[i - 2], 13)) & (s2 - 1)]
      if (cnt >= prune && ctx > 0) p3 = cnt / ctx
    }
    let p: number
    if (cfg.order >= 3) p = 0.55 * p3 + 0.33 * p2 + 0.12 * p1
    else if (cfg.order === 2) p = 0.8 * p2 + 0.2 * p1
    else p = p1
    sum += Math.log2(Math.max(p, 1e-9))
    n++
  }
  return sum / n
}

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

const all = loadCorpus()
const groups = [...new Set(all.map((d) => d.group))]
const rand = mulberry32(SEED)
const shuffled = [...groups].sort(() => rand() - 0.5)
const holdSet = new Set(shuffled.slice(0, Math.floor(groups.length * 0.2)))
const trainSet = all.filter((d) => !holdSet.has(d.group))
const testSet = all.filter((d) => holdSet.has(d.group))

const acaDocs: Doc[] = readJsonl(path.join(ROOT, 'crossdomain', 'academic_zh.jsonl'))
  .filter((r) => typeof r.text === 'string' && (r.text as string).length >= 120)
  .map((r, i) => ({ group: `aca#${i}`, domain: 'academic', label: (Number(r.label) === 1 ? 1 : 0) as 0 | 1, text: r.text as string }))

// 留出集抽 8000 篇做 AUC，控制耗时
const sub = (() => {
  const r = mulberry32(99)
  const byLabel = [testSet.filter((d) => d.label === 0), testSet.filter((d) => d.label === 1)]
  const out: Doc[] = []
  for (const arr of byLabel) {
    const s = [...arr].sort(() => r() - 0.5).slice(0, 4000)
    out.push(...s)
  }
  return out
})()

console.log(`语料 ${all.length} 篇 / 分组 ${groups.length}；留出抽样 ${sub.length} 篇；学术跨域 ${acaDocs.length} 篇\n`)

const configs: Config[] = [
  { name: 'base            ', norm: { digits: true, punct: true, space: true, caseFold: true }, order: 2 },
  { name: 'nodigit         ', norm: { digits: false, punct: true, space: true, caseFold: true }, order: 2 },
  { name: 'nodigitpunct    ', norm: { digits: false, punct: false, space: true, caseFold: true }, order: 2 },
  { name: 'nodigitpunct_nows', norm: { digits: false, punct: false, space: false, caseFold: true }, order: 2 },
  { name: 'base_order3     ', norm: { digits: true, punct: true, space: true, caseFold: true }, order: 3 },
]

console.log('=== 消融实验（order=2, 表 2^21）===')
for (const cfg of configs) {
  const bits = 21
  const hM = train(trainSet.filter((d) => d.label === 0), cfg, bits)
  const aM = train(trainSet.filter((d) => d.label === 1), cfg, bits)
  const labels: number[] = [], delta: number[] = []
  for (const d of sub) {
    delta.push(score(aM, d.text, cfg, bits, 1) - score(hM, d.text, cfg, bits, 1))
    labels.push(d.label)
  }
  const acaLabels: number[] = [], acaDelta: number[] = []
  for (const d of acaDocs) {
    acaDelta.push(score(aM, d.text, cfg, bits, 1) - score(hM, d.text, cfg, bits, 1))
    acaLabels.push(d.label)
  }
  let ne = 0
  for (let i = 0; i < hM.h2.length; i++) if (hM.h2[i] > 0) ne++
  console.log(`${cfg.name} 域内AUC=${auc(delta, labels).toFixed(3)}  跨域AUC=${auc(acaDelta, acaLabels).toFixed(3)}  人类模型非空bigram=${ne.toLocaleString()}`)
}

console.log('\n=== 体积/AUC 权衡（base, order=2）===')
const baseCfg = configs[0]
for (const bits of [19, 20, 21, 22]) {
  const hM = train(trainSet.filter((d) => d.label === 0), baseCfg, bits)
  const aM = train(trainSet.filter((d) => d.label === 1), baseCfg, bits)
  for (const prune of [1, 3]) {
    const labels: number[] = [], delta: number[] = []
    for (const d of sub) {
      delta.push(score(aM, d.text, baseCfg, bits, prune) - score(hM, d.text, baseCfg, bits, prune))
      labels.push(d.label)
    }
    let ne = 0
    for (let i = 0; i < hM.h2.length; i++) if (hM.h2[i] >= prune) ne++
    const sizeMB = ((hM.h2.length + aM.h2.length) * 1) / 1e6
    console.log(`bits=${bits} prune>=${prune}  AUC=${auc(delta, labels).toFixed(3)}  非空(人类)=${ne.toLocaleString()}  两模型uint8裸体积≈${sizeMB.toFixed(2)}MB`)
  }
}
