/**
 * 对抗性审计 #2：泄漏审查（v2，适配「题目哈希 + 近似重复聚类」切分）
 *
 * 背景：v1 版本审计发现旧切分（按 `域名#行号` 分组）存在两类泄漏——
 *   ① 同题跨集：96 个重复 question 里有 36 个横跨训练/留出；
 *   ② 近似重复：771 对 8-gram Jaccard>0.8 的文本跨集，留出集 147 篇（1.7%）能在训练集找到近重复。
 * 训练脚本已改为并查集分组（题目哈希 ∪ 近似重复）并重训。本脚本负责**验证修复是否真的生效**，
 * 而不是相信训练脚本的自述。
 *
 * 三件事：
 *  A) group / id 是否真的不重叠（读 train.jsonl 与 holdout.jsonl 直接对账）。
 *  B) 同题跨集：用审计自己实现的归一化重新算题目键，不读训练脚本的 group，看是否还有跨集。
 *  C) 近似重复跨集：用**比训练更激进的 LSH（16 band × 3 行 vs 训练 8 × 6）**找候选，
 *     宁可多算候选，也要尽量抓住训练期可能漏掉的近重复对。
 *
 * 用法：npx tsx scripts/audit-lm-leak.ts
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DIR = path.join(ROOT, 'calibration', 'lm')
const TRAIN = path.join(DIR, 'train.jsonl')
const HOLDOUT = path.join(DIR, 'holdout.jsonl')
const SPLIT = path.join(DIR, 'split.json')

interface Row { id: string; group: string; q: string; label: number; domain: string; text: string }

function readJsonl(file: string): Row[] {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row)
}

const train = readJsonl(TRAIN)
const hold = readJsonl(HOLDOUT)
const split = fs.existsSync(SPLIT) ? JSON.parse(fs.readFileSync(SPLIT, 'utf-8')) : null

console.log('=== A. 分组隔离 ===')
if (split) console.log(`split.json: ${split.method ?? '(旧格式)'}｜组 ${split.groups ?? '?'}｜同题合并 ${split.mergedByQuestion ?? '?'}｜近重复合并 ${split.mergedByNearDup ?? '?'}`)
console.log(`实际篇数：train ${train.length} / holdout ${hold.length}｜AI ${hold.filter((r) => Number(r.label) === 1).length} / 真人 ${hold.filter((r) => Number(r.label) === 0).length}`)
if (split) {
  console.log(`与 split.json 对账：train ${train.length === split.trainCount ? '✅' : '❌'}${split.trainCount} / holdout ${hold.length === split.holdoutCount ? '✅' : '❌'}${split.holdoutCount}`)
}
const trainGroups = new Set(train.map((r) => r.group))
const holdGroups = new Set(hold.map((r) => r.group))
const sharedGroups = [...holdGroups].filter((g) => trainGroups.has(g))
const trainIds = new Set(train.map((r) => r.id))
const sharedIds = hold.filter((r) => trainIds.has(r.id))
console.log(`group 跨集 = ${sharedGroups.length} ${sharedGroups.length === 0 ? '✅ 0（必须为 0）' : '❌ 存在泄漏'}`)
console.log(`id 跨集    = ${sharedIds.length} ${sharedIds.length === 0 ? '✅ 0（必须为 0）' : '❌ 存在泄漏'}`)

console.log('\n=== B. 同题跨集（审计独立重算题目键，不信训练脚本的 group）===')
const normQ = (q: string) => q.toLowerCase().replace(/[^0-9a-z\u4e00-\u9fff]+/g, '')
const qMap = new Map<string, { train: number; hold: number }>()
for (const r of train) {
  if (!r.q) continue
  const k = `${r.domain}|${normQ(r.q)}`
  const v = qMap.get(k) ?? { train: 0, hold: 0 }
  v.train++
  qMap.set(k, v)
}
for (const r of hold) {
  if (!r.q) continue
  const k = `${r.domain}|${normQ(r.q)}`
  const v = qMap.get(k) ?? { train: 0, hold: 0 }
  v.hold++
  qMap.set(k, v)
}
const dupQ = [...qMap.values()].filter((v) => v.train + v.hold > 1).length
const crossQ = [...qMap.entries()].filter(([, v]) => v.train > 0 && v.hold > 0)
console.log(`重复题目键 = ${dupQ}｜其中「训练与留出各占」的题 = ${crossQ.length} ${crossQ.length === 0 ? '✅ 无同题跨集' : '⚠️ 仍有同题跨集'}`)
crossQ.slice(0, 8).forEach(([k]) => console.log(`  ${k.slice(0, 70)}`))

console.log('\n=== C. 近似重复跨集（LSH 24 band × 2 行，比训练期 16×3 更高召回）===')
const K = 8
const SIG = 48
function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
function shingleSet(text: string): Set<number> {
  const t = text.toLowerCase().replace(/\s+/g, ' ')
  const s = new Set<number>()
  for (let i = 0; i + K <= t.length; i++) s.add(hashStr(t.slice(i, i + K)))
  return s
}
function signature(text: string): number[] {
  const t = text.toLowerCase().replace(/\s+/g, ' ')
  const heap: number[] = []
  const seen = new Set<number>()
  for (let i = 0; i + K <= t.length; i++) {
    const h = hashStr(t.slice(i, i + K))
    if (seen.has(h)) continue
    seen.add(h)
    if (heap.length < SIG) {
      heap.push(h)
      if (heap.length === SIG) heap.sort((a, b) => b - a)
    } else if (h < heap[0]) {
      heap[0] = h
      heap.sort((a, b) => b - a)
    }
  }
  return heap.sort((a, b) => a - b)
}

const all = [...train, ...hold]
const holdIndex = new Set(hold.map((r) => r.id))
const sigs = all.map((r) => signature(r.text))
const BANDS = 24
const ROWS = 2
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
const isHold = (i: number) => holdIndex.has(all[i].id)

// 只对候选对做精确 Jaccard；缓存带容量上限，避免 43k 篇全量 shingle 撑爆内存
const cache = new Map<number, Set<number>>()
function shinglesOf(i: number): Set<number> {
  const hit = cache.get(i)
  if (hit) return hit
  const s = shingleSet(all[i].text)
  if (cache.size > 4000) cache.delete(cache.keys().next().value as number)
  cache.set(i, s)
  return s
}
const pairs: Array<{ a: number; b: number; j: number }> = []
let candidates = 0
let bigBucketSampled = 0
let bigBucketViolations = 0
const jaccardOf = (ai: number, bj: number): number => {
  const sa = shinglesOf(ai)
  const sb = shinglesOf(bj)
  const [small, big] = sa.size < sb.size ? [sa, sb] : [sb, sa]
  let inter = 0
  for (const x of small) if (big.has(x)) inter++
  return inter / Math.max(1, sa.size + sb.size - inter)
}
for (const ids of buckets.values()) {
  if (ids.length < 2) continue
  if (ids.length > 30) {
    // 大桶 = 同一段文本的几十份副本（模板垃圾）。训练期是链式合并处理，
    // 这里抽样核对：跨集的对是否真的 >0.8。全量比较代价过高，但绝不能像 v1 那样直接跳过。
    const holds = ids.filter((i) => isHold(i))
    const trains = ids.filter((i) => !isHold(i))
    if (holds.length === 0 || trains.length === 0) continue
    const sampleHolds = holds.slice(0, 4)
    const sampleTrains = trains.slice(0, 4)
    for (const ai of sampleHolds) {
      for (const bj of sampleTrains) {
        bigBucketSampled++
        const jac = jaccardOf(ai, bj)
        if (jac > 0.8) { bigBucketViolations++; pairs.push({ a: ai, b: bj, j: jac }) }
      }
    }
    continue
  }
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const ai = ids[i]
      const bj = ids[j]
      if (isHold(ai) === isHold(bj)) continue // 同侧不算跨集
      candidates++
      const jac = jaccardOf(ai, bj)
      if (jac > 0.8) pairs.push({ a: ai, b: bj, j: jac })
    }
  }
}
console.log(`跨集候选对 ${candidates}，确认 J>0.8 = ${pairs.length} ${pairs.length === 0 ? '✅ 无近似重复跨集' : '⚠️ 仍有近似重复跨集'}`)
console.log(`大桶（>30 份副本）抽样核对 ${bigBucketSampled} 对，其中 J>0.8 = ${bigBucketViolations} ${bigBucketViolations === 0 ? '✅' : '⚠️'}`)
pairs.sort((x, y) => y.j - x.j).slice(0, 5).forEach((p) => {
  console.log(`  J=${p.j.toFixed(3)} 「${all[p.a].text.slice(0, 60).replace(/\n/g, ' ')}」↔「${all[p.b].text.slice(0, 60).replace(/\n/g, ' ')}」`)
})

console.log('\n=== D. 脏数据残留（接口报错 / 拒答模板）===')
const JUNK = /^!?\s*(network error|your authentication token has expired|too many requests|error generating a response|only one message at a time)/i
const JUNK_ANY = /(there was an error generating a response|your authentication token has expired|too many requests in 1 hour|only one message at a time)/i
const REFUSAL = /^(i'?m sorry|i am sorry|sorry,|as an ai|as a language model|作为一个?ai|作为ai|很抱歉|抱歉，我|我无法(?:提供|回答|完成)|我(?:不能|无法)协助)/i
const isJunkText = (t: string) => JUNK.test(t.slice(0, 80).replace(/\s+/g, ' ').trim()) || JUNK_ANY.test(t)
const junkHold = hold.filter((r) => isJunkText(r.text))
const refHold = hold.filter((r) => REFUSAL.test(r.text.slice(0, 80).replace(/\s+/g, ' ').trim()))
console.log(`留出集接口报错模板 = ${junkHold.length} ${junkHold.length === 0 ? '✅ 已清空' : '⚠️ 仍在'}｜拒答模板 = ${refHold.length} ${refHold.length === 0 ? '✅' : '⚠️'}`)

console.log('\n=== E. 留出集内部重复（不构成训练泄漏，但会让指标略乐观）===')
const seen = new Set<string>()
let intraDup = 0
for (const r of hold) {
  const key = signature(r.text).join(',')
  if (seen.has(key)) intraDup++
  else seen.add(key)
}
console.log(`bottom-48 签名完全相同 ≈ ${intraDup} 篇（占 ${(intraDup / hold.length * 100).toFixed(2)}%）`)

const failed = sharedGroups.length > 0 || sharedIds.length > 0 || crossQ.length > 0 || pairs.length > 0
console.log(`\n${failed ? '❌ 审计未通过' : '✅ 审计通过：group/id 隔离、同题、近似重复均无跨集'}`)
if (failed) process.exit(1)

// 落盘泄漏清单（供 audit-lm-recompute.ts 做「剔除泄漏后」的敏感性分析）
fs.writeFileSync(path.join(DIR, 'audit-leak-ids.json'), JSON.stringify(pairs.flatMap((p) => {
  const ids: string[] = []
  if (holdIndex.has(all[p.a].id)) ids.push(all[p.a].id)
  if (holdIndex.has(all[p.b].id)) ids.push(all[p.b].id)
  return ids
})))
