/**
 * 零成本探针：AI 腔学生作文 vs 真人学生作文，看现有产物在「作文体裁」上到底分不分得开。
 *
 * 为什么必须做这一步：
 *   probe-student-essays.ts 已证明真人作文被判 0–2 分（误伤率 0.1%）。
 *   但如果 AI 写的中文作文也被判 0–2 分，那这个通道在作文体裁上就是废的（AUC≈0.5）。
 *   只有「真人低分 + AI 高分」同时成立，才说明体裁不是障碍。
 *
 * AI 样本来源（关键：不花任何 API 费用）：
 *   - scripts/data/ai-essays.jsonl：由本项目在编码阶段直接撰写的 AI 腔作文样本，
 *     每篇标注 prompt（题目）与 style（写法）。这些是模型的原始输出，未经人工改写内容，
 *     只做过长度控制。**用途仅限探针，不作为训练语料**（样本量远不足以训练）。
 *   - 对照组：OpenNCEE-Chinese-Essay 中的人类高考范文（不是 AI 生成，有具体素材与错别字可证）。
 *
 * 用法：npx tsx scripts/probe-essay-ai.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { DEQUANT, LM_MASK, LM_W2, LM_W1, bigramBucket, normalizeLm } from '../src/lib/lmText'

const ROOT = process.cwd()
const AI_SAMPLES = path.join(ROOT, 'scripts', 'data', 'ai-essays.jsonl')
const REAL_SAMPLE = path.join(ROOT, 'calibration', 'essays', 'student-essays-sample.jsonl')
const OPENNCEE = 'https://datasets-server.huggingface.co/rows?dataset=BabelTowerProject%2FOpenNCEE-Chinese-Essay&config=default&split=train'

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

interface Dialect { name: string; h: Parsed; a: Parsed; cal: { mean: number; std: number; a: number; b: number } }

function loadDialect(suffix: string, label: string): Dialect {
  const bin = path.join(ROOT, 'public', `lm-char2${suffix}.bin`)
  const metaPath = path.join(ROOT, 'src', 'data', `lmModel${suffix === '-modern' ? 'Modern' : ''}.json`)
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

async function fetchNcee(limit = 300): Promise<Array<{ prompt: string; text: string }>> {
  const out: Array<{ prompt: string; text: string }> = []
  for (let offset = 0; offset < limit; offset += 100) {
    try {
      const res = await fetch(`${OPENNCEE}&offset=${offset}&length=100`)
      if (!res.ok) break
      const j = (await res.json()) as { rows: Array<{ row: { messages: Array<{ role: string; content: string }> } }> }
      for (const r of j.rows ?? []) {
        const m = r.row.messages ?? []
        const prompt = m[1]?.content ?? ''
        const text = m[2]?.content ?? ''
        if (text.length < 400) continue
        out.push({ prompt: prompt.replace(/\n/g, ' ').trim(), text: text.replace(/\n/g, ' ').trim() })
      }
    } catch { break }
  }
  return out
}

async function main() {
  const base = loadDialect('', '方言A/2023')
  const modern = loadDialect('-modern', '方言B/现代')

  const scoreWith = (d: Dialect, text: string) => {
    const delta = meanLogp(d.a, text) - meanLogp(d.h, text)
    const z = (delta - d.cal.mean) / d.cal.std
    return Math.round(Math.min(100, Math.max(0, 100 / (1 + Math.exp(-(d.cal.a * z + d.cal.b))))))
  }
  const scoreAny = (text: string) => Math.max(scoreWith(base, text), scoreWith(modern, text))

  // ---- AI 样本 ----
  const aiRows = fs.readFileSync(AI_SAMPLES, 'utf-8').trim().split('\n').filter(Boolean)
    .map((l) => JSON.parse(l) as { prompt: string; style: string; text: string })
  console.log(`AI 腔作文样本：${aiRows.length} 篇（本项目直接撰写，未改动内容）`)

  // ---- 真人样本：普通学生作文 ----
  let realRows: Array<{ text: string }> = []
  if (fs.existsSync(REAL_SAMPLE)) {
    realRows = fs.readFileSync(REAL_SAMPLE, 'utf-8').trim().split('\n').filter(Boolean)
      .map((l) => JSON.parse(l) as { text: string })
    console.log(`真人普通学生作文：${realRows.length} 篇（zuowen 抽样，300–2000 字）`)
  } else {
    console.log('缺少 calibration/essays/student-essays-sample.jsonl，先跑 probe-student-essays.ts')
  }

  // ---- 真人样本：高考范文（高分） ----
  process.stdout.write('拉取 OpenNCEE 人类范文…')
  const ncee = await fetchNcee(300)
  console.log(` ${ncee.length} 篇`)

  const groups = [
    { name: 'AI 腔作文', scores: aiRows.map((r) => scoreAny(r.text)), lens: aiRows.map((r) => r.text.length) },
    { name: '真人·普通学生作文', scores: realRows.map((r) => scoreAny(r.text)), lens: realRows.map((r) => r.text.length) },
    { name: '真人·高考范文', scores: ncee.map((r) => scoreAny(r.text)), lens: ncee.map((r) => r.text.length) },
  ]

  console.log('\n' + '─'.repeat(92))
  console.log('组别'.padEnd(22) + 'n'.padStart(6) + '字数p50'.padStart(9) + 'p10'.padStart(6) + 'p50'.padStart(6) +
    'p90'.padStart(6) + '≥50'.padStart(9) + '≥70'.padStart(8))
  console.log('─'.repeat(92))
  for (const g of groups) {
    if (!g.scores.length) { console.log(g.name.padEnd(22) + '（无样本）'); continue }
    console.log(
      g.name.padEnd(22) + String(g.scores.length).padStart(6) + String(q(g.lens, 0.5)).padStart(9) +
      String(q(g.scores, 0.1)).padStart(6) + String(q(g.scores, 0.5)).padStart(6) + String(q(g.scores, 0.9)).padStart(6) +
      ((g.scores.filter((s) => s >= 50).length / g.scores.length) * 100).toFixed(1).padStart(8) + '%' +
      ((g.scores.filter((s) => s >= 70).length / g.scores.length) * 100).toFixed(1).padStart(7) + '%',
    )
  }

  // ---- 判别力：AI vs 真人（两种真人混合） ----
  const negatives = [
    ...groups[1].scores.map((s) => ({ s, tag: '普通学生作文' })),
    ...groups[2].scores.map((s) => ({ s, tag: '高考范文' })),
  ]
  if (groups[0].scores.length && negatives.length) {
    const scores = [...groups[0].scores, ...negatives.map((n) => n.s)]
    const labels = [...groups[0].scores.map(() => 1), ...negatives.map(() => 0)]
    console.log(`\n作文体裁内 AUC（AI 作文 vs 真人作文）= ${auc(scores, labels).toFixed(3)}  n=${scores.length}（AI ${groups[0].scores.length} / 真人 ${negatives.length}）`)
  }

  // ---- 逐篇 ----
  console.log('\nAI 腔作文逐篇得分：')
  aiRows.forEach((r) => {
    const s = scoreAny(r.text)
    const flag = s >= 50 ? '⚠️ 未被识别' : '✅'
    console.log(`  ${flag} ${String(s).padStart(3)} 分 [${r.style}] ${r.prompt.slice(0, 34)}（${r.text.length} 字）`)
  })

  const missRate = aiRows.length ? (aiRows.filter((r) => scoreAny(r.text) < 50).length / aiRows.length) * 100 : NaN
  console.log('\n判读：')
  if (missRate <= 20) {
    console.log(`  AI 作文漏检率 ${missRate.toFixed(1)}%，真人误伤率极低 → **现有产物在作文体裁上已经能用**，不需要新语料。`)
  } else if (missRate <= 50) {
    console.log(`  AI 作文漏检率 ${missRate.toFixed(1)}% → 部分可用，需要补作文体裁的 AI 语料再训一版。`)
  } else {
    console.log(`  AI 作文漏检率 ${missRate.toFixed(1)}% → **当前产物在作文体裁上不可用**：它只认问答体的 AI 腔。`)
    console.log('  必须做体裁专用模型，且 AI 侧需要真实作文题目的 AI 语料（不能用问答语料代替）。')
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
