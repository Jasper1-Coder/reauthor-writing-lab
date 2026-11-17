/**
 * 零成本探针：真人学生作文，用现有产物打分，直接量「误伤率」。
 *
 * 为什么先做这个，而不是先花 token 造 AI 作文语料：
 *   学生交上来的是「议论文 / 记叙文」体裁，而训练语料是问答体。
 *   在体裁不匹配的情况下，有两种可能，修法完全不同：
 *     A. 模型把真人作文判低分 → 体裁不是障碍，直接把作文语料加进 AI 侧就能用；
 *     B. 模型把真人作文判高分 → 严重误伤，说明「书面连贯论述」这个特征被它当成了 AI 味，
 *        必须先做体裁专用模型，加多少 AI 语料都没用。
 *   这个实验只读现有产物 + 公开数据集，**不调用任何生成 API**，一分钱不花。
 *
 * 语料：ReIceCream/zuowen（真人学生作文，269,370 篇，CC BY-NC 4.0）
 *   仅取 300–2000 字的篇目（学生作文典型长度），按 ID 均匀抽样。
 *   数据不落盘到仓库，只在内存里过一遍（calibration/ 已 gitignore）。
 *
 * 用法：npx tsx scripts/probe-student-essays.ts [--n 1000]
 */
import fs from 'node:fs'
import path from 'node:path'
import { DEQUANT, LM_MASK, LM_W2, LM_W1, bigramBucket, normalizeLm } from '../src/lib/lmText'

const ROOT = process.cwd()
const OUT_DIR = path.join(ROOT, 'calibration', 'essays')
const API = 'https://datasets-server.huggingface.co/rows?dataset=ReIceCream%2Fzuowen&config=default&split=train'

const N = (() => {
  const i = process.argv.indexOf('--n')
  return i >= 0 ? Number(process.argv[i + 1]) : 1000
})()

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

interface Dialect {
  name: string
  h: Parsed
  a: Parsed
  cal: { mean: number; std: number; a: number; b: number }
}

function loadDialect(suffix: string, label: string): Dialect {
  const bin = path.join(ROOT, 'public', `lm-char2${suffix}.bin`)
  const metaPath = path.join(ROOT, 'src', 'data', `lmModel${suffix === '-modern' ? 'Modern' : ''}.json`)
  if (!fs.existsSync(bin)) throw new Error(`缺少 ${bin}，请先跑 npx tsx scripts/train-lm.ts`)
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
  const buf = fs.readFileSync(bin)
  const vocabH = buf.readUInt32LE(8)
  const vocabA = buf.readUInt32LE(12)
  const h = parse(buf, 24, vocabH, meta.models[0].chars)
  const a = parse(buf, h.next, vocabA, meta.models[1].chars)
  return { name: label, h: h.m, a: a.m, cal: meta.calibration }
}

const q = (arr: number[], p: number) => {
  if (!arr.length) return NaN
  const s = [...arr].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))]
}
const pct = (arr: number[], thr: number) => (arr.length ? (arr.filter((x) => x >= thr).length / arr.length) * 100 : NaN)

async function fetchEssays(want: number): Promise<Array<{ id: number; text: string }>> {
  // 269,370 行 → 每页 100 行，按等距 offset 抽样，避免只拿到开头那一段
  const TOTAL = 269370
  const out: Array<{ id: number; text: string }> = []
  const stride = Math.floor(TOTAL / Math.ceil((want * 2.2) / 100))
  const offsets: number[] = []
  for (let o = 0; o < TOTAL; o += Math.max(100, stride)) offsets.push(o)
  process.stdout.write(`抽样：${offsets.length} 页 `)
  let done = 0
  for (const offset of offsets) {
    if (out.length >= want) break
    try {
      const res = await fetch(`${API}&offset=${offset}&length=100`)
      if (!res.ok) continue
      const j = (await res.json()) as { rows: Array<{ row: { ID: number; content: string } }> }
      for (const r of j.rows ?? []) {
        const t = (r.row.content ?? '').replace(/\s+/g, ' ').trim()
        if (t.length < 300 || t.length > 2000) continue
        out.push({ id: r.row.ID, text: t })
        if (out.length >= want) break
      }
      done++
      if (done % 4 === 0) process.stdout.write('.')
    } catch {
      // 单页失败不影响整体抽样
    }
  }
  console.log(` → ${out.length} 篇（300–2000 字）`)
  return out
}

async function main() {
  const base = loadDialect('', '方言A/2023')
  const modern = loadDialect('-modern', '方言B/现代')
  console.log(`方言 A 标定 mean=${base.cal.mean.toFixed(4)} a=${base.cal.a.toFixed(3)} b=${base.cal.b.toFixed(3)}`)
  console.log(`方言 B 标定 mean=${modern.cal.mean.toFixed(4)} a=${modern.cal.a.toFixed(3)} b=${modern.cal.b.toFixed(3)}\n`)

  const essays = await fetchEssays(N)
  if (essays.length < 50) {
    console.log('抽样不足 50 篇，数据集接口可能限流。稍后重试或改 --n。')
    process.exit(1)
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, 'student-essays-sample.jsonl'),
    essays.map((e) => JSON.stringify(e)).join('\n'))

  const scoreWith = (d: Dialect, text: string) => {
    const delta = meanLogp(d.a, text) - meanLogp(d.h, text)
    const z = (delta - d.cal.mean) / d.cal.std
    return Math.round(Math.min(100, Math.max(0, 100 / (1 + Math.exp(-(d.cal.a * z + d.cal.b))))))
  }

  const lens = essays.map((e) => e.text.length)
  console.log(`真人学生作文 ${essays.length} 篇，长度 p25/p50/p75 = ${q(lens, 0.25)}/${q(lens, 0.5)}/${q(lens, 0.75)} 字\n`)

  const rows: Array<{ name: string; scores: number[] }> = []
  for (const d of [base, modern]) {
    const scores = essays.map((e) => scoreWith(d, e.text))
    rows.push({ name: d.name, scores })
  }
  // 取双方言较高者（与线上 runLmChannel 口径一致）
  const maxScores = essays.map((e) => Math.max(scoreWith(base, e.text), scoreWith(modern, e.text)))
  rows.push({ name: '线上口径（取较高）', scores: maxScores })

  console.log('─'.repeat(84))
  console.log('真人学生作文被判分'.padEnd(20) + 'p10'.padStart(6) + 'p25'.padStart(6) + 'p50'.padStart(6) +
    'p75'.padStart(6) + 'p90'.padStart(6) + '≥50'.padStart(9) + '≥70'.padStart(8) + '  中位分')
  console.log('─'.repeat(84))
  for (const r of rows) {
    console.log(
      r.name.padEnd(20) +
      String(q(r.scores, 0.1)).padStart(6) +
      String(q(r.scores, 0.25)).padStart(6) +
      String(q(r.scores, 0.5)).padStart(6) +
      String(q(r.scores, 0.75)).padStart(6) +
      String(q(r.scores, 0.9)).padStart(6) +
      (pct(r.scores, 50).toFixed(1) + '%').padStart(9) +
      (pct(r.scores, 70).toFixed(1) + '%').padStart(8) +
      '   ' + q(r.scores, 0.5),
    )
  }

  // 按长度分桶，看误伤是否随篇幅变化
  const BUCKETS = [
    { name: '300–500 字', lo: 300, hi: 500 },
    { name: '500–800 字', lo: 500, hi: 800 },
    { name: '800–1200 字', lo: 800, hi: 1200 },
    { name: '1200–2000 字', lo: 1200, hi: 2001 },
  ]
  console.log('\n按篇幅分桶（线上口径）：')
  console.log('桶'.padEnd(16) + 'n'.padStart(6) + 'p50'.padStart(7) + 'p90'.padStart(7) + '≥50'.padStart(9))
  for (const b of BUCKETS) {
    const idx = essays.map((e, i) => (e.text.length >= b.lo && e.text.length < b.hi ? i : -1)).filter((i) => i >= 0)
    if (!idx.length) continue
    const s = idx.map((i) => maxScores[i])
    console.log(b.name.padEnd(16) + String(s.length).padStart(6) + String(q(s, 0.5)).padStart(7) +
      String(q(s, 0.9)).padStart(7) + (pct(s, 50).toFixed(1) + '%').padStart(9))
  }

  console.log('\n分数分布直方（线上口径，10 分一档）：')
  const bins = new Array(11).fill(0)
  for (const s of maxScores) bins[Math.min(10, Math.floor(s / 10))]++
  const peak = Math.max(...bins)
  bins.forEach((c, i) => {
    const lo = i * 10
    const bar = '█'.repeat(Math.round((c / peak) * 40))
    console.log(`  ${String(lo).padStart(3)}–${String(lo + 9).padStart(3)} │${bar} ${c} (${((c / maxScores.length) * 100).toFixed(1)}%)`)
  })

  const med = q(maxScores, 0.5)
  console.log('\n判读：')
  if (med < 30) {
    console.log(`  真人作文中位分 ${med}，误伤率（≥50）${pct(maxScores, 50).toFixed(1)}% → **体裁不是障碍**。`)
    console.log('  下一步只需把 AI 侧补上作文体裁语料，人侧沿用现有真人作文即可。')
  } else if (med < 55) {
    console.log(`  真人作文中位分 ${med}，误伤率（≥50）${pct(maxScores, 50).toFixed(1)}% → 处在临界，必须做体裁专用模型。`)
  } else {
    console.log(`  真人作文中位分 ${med}，误伤率（≥50）${pct(maxScores, 50).toFixed(1)}% → **严重误伤**。`)
    console.log('  模型把「书面连贯论述」当成了 AI 味，当前产物不能用于学生作文，必须换体裁专用语料。')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
