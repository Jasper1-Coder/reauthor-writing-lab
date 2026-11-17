/**
 * 导出「真人 delta 的经验分布表（ECDF）」，供浏览器端把 delta 换算成百分位。
 *
 * 为什么需要这一步（三个探针依次打脸后的结论）：
 *   1. 真人学生作文 1000 篇全被判 0–2 分，误伤率 0.1%——真人侧本来就不误伤。
 *   2. AI 腔作文 12 篇也全低于 50 分——看着像漏检，其实是 Math.round 取整把排序压平了。
 *   3. 用原始 delta 排序，现有模型在作文体裁上 AUC 0.981——能力在，只是分数尺度错位。
 *   4. 真人作文的 delta 比问答体真人低 1.85 个标准差，所以固定在问答体上拟合的
 *      Platt 曲线到作文体裁整条平移，"50 分"不再对应任何有意义的操作点。
 *
 * 修法：不再用「Platt 概率」当分数，改用「在同类真人文本中的百分位」。
 * 百分位天然按体裁归一化，不需要任何 AI 作文语料，也不需要额外生成任何文本。
 *
 * 数据来源（全部公开、零成本）：
 *   - 问答体真人：calibration/lm/holdout.jsonl 中 label=0（HC3 人类答案）
 *   - 作文体真人：calibration/essays/student-essays-sample.jsonl（ReIceCream/zuowen 抽样，
 *     269,370 篇真人学生作文，CC BY-NC 4.0）+ OpenNCEE-Chinese-Essay 的人类高考范文
 *
 * 产物：src/data/lmEcdf.json（约 8KB，201 个分位点 × 2 套基线）
 *
 * 用法：npx tsx scripts/build-ecdf.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { DEQUANT, LM_MASK, LM_W2, LM_W1, bigramBucket, normalizeLm } from '../src/lib/lmText'

const ROOT = process.cwd()
const OUT = path.join(ROOT, 'src', 'data', 'lmEcdf.json')
const POINTS = 201 // 每 0.5 百分位一个格点

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

const b1 = loadDialect('')
const b2 = loadDialect('-modern')
/** 与线上 runLmChannel 完全一致：取两种方言中更接近 AI 的那个 */
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

/** 分位点表：第 i 个格点是 p = i/(POINTS-1) 处的 delta 值（升序） */
function quantileTable(deltas: number[]): number[] {
  const s = [...deltas].sort((x, y) => x - y)
  const out: number[] = []
  for (let i = 0; i < POINTS; i++) {
    const p = i / (POINTS - 1)
    out.push(Number(s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))].toFixed(5)))
  }
  return out
}

async function main() {
  // ── 问答体真人（HC3） ──
  const holdPath = path.join(ROOT, 'calibration', 'lm', 'holdout.jsonl')
  if (!fs.existsSync(holdPath)) {
    console.error('缺少 calibration/lm/holdout.jsonl，请先运行 npx tsx scripts/train-lm.ts')
    process.exit(1)
  }
  const qaHuman = fs.readFileSync(holdPath, 'utf-8').trim().split('\n').filter(Boolean)
    .map((l) => JSON.parse(l) as { label: number; text: string })
    .filter((r) => r.label === 0).map((r) => r.text)

  // ── 作文体真人 ──
  const essayPath = path.join(ROOT, 'calibration', 'essays', 'student-essays-sample.jsonl')
  if (!fs.existsSync(essayPath)) {
    console.error('缺少 calibration/essays/student-essays-sample.jsonl，请先运行 npx tsx scripts/probe-student-essays.ts --n 1000')
    process.exit(1)
  }
  const essays = fs.readFileSync(essayPath, 'utf-8').trim().split('\n').filter(Boolean)
    .map((l) => (JSON.parse(l) as { text: string }).text)
  process.stdout.write('拉取高考范文…')
  const ncee = await fetchNcee(300)
  console.log(` ${ncee.length} 篇`)

  const qaDeltas = qaHuman.map(maxDelta).filter(Number.isFinite)
  const essayDeltas = [...essays, ...ncee].map(maxDelta).filter(Number.isFinite)

  const q = (arr: number[], p: number) => {
    const s = [...arr].sort((x, y) => x - y)
    return s[Math.min(s.length - 1, Math.round(p * (s.length - 1)))]
  }
  console.log(`问答体真人 ${qaDeltas.length} 篇：delta p50=${q(qaDeltas, 0.5).toFixed(3)} p95=${q(qaDeltas, 0.95).toFixed(3)} p99=${q(qaDeltas, 0.99).toFixed(3)}`)
  console.log(`作文体真人 ${essayDeltas.length} 篇：delta p50=${q(essayDeltas, 0.5).toFixed(3)} p95=${q(essayDeltas, 0.95).toFixed(3)} p99=${q(essayDeltas, 0.99).toFixed(3)}`)

  const payload = {
    meta: {
      note: '真人 delta 的经验分位表。delta = logP(AI模型) − logP(真人模型)，取两种方言的较大值。'
        + ' 浏览器端用二分查表把 delta 换算成「在同类真人文本中的百分位」，代替在问答体上拟合的固定 Platt 曲线。'
        + ' 这样换体裁时阈值自动落到正确位置——实测作文体裁 AUC 0.981、阈值 95 百分位召回 100% / 误伤 4.9%。',
      protocol: '每套基线 201 个分位点（p0–p100，步长 0.5）；只统计真人文本，拟合过程不使用任何 AI 样本',
      sources: {
        qa: 'HC3 中文人类答案（留出集 label=0）',
        essay: 'ReIceCream/zuowen 真人学生作文抽样（CC BY-NC 4.0）+ OpenNCEE-Chinese-Essay 人类高考范文',
      },
      counts: { qa: qaDeltas.length, essay: essayDeltas.length },
      builtAt: new Date().toISOString().slice(0, 10),
      reproducible: 'npx tsx scripts/build-ecdf.ts',
      limitations: [
        '作文体裁的评估样本只有 12 篇 AI 腔中文作文（由本项目在编码阶段直接撰写，不是学生真实使用的 ChatGPT / 豆包 / Kimi 输出），AUC 0.981 的置信区间很宽（±0.1 量级），只能看方向不能当定论。',
        '参照系的选择是启发式规则（中文字符占比 ≥50% 且长度 ≥200 字 → 作文基线），不是体裁分类器；中文长问答会被分到作文基线，可能读到偏高的百分位。',
        '百分位衡量的是「偏离真人写作常态的程度」，不是「作者是否用了 AI」；百分位高也可能只是文风规整、模板化、或被老师改写过。',
        '两条基线的真人样本都偏「中低分作文」：zuowen 是学生习作集合，OpenNCEE 是人类范文，但都不含 2026 年主流 AI 辅助写作后的学生真实文本。',
        '真人样本里没有「AI 润色过的学生作文」这一类，因此无法验证对「人机混写」的判别力。',
      ],
    },
    points: POINTS,
    qa: quantileTable(qaDeltas),
    essay: quantileTable(essayDeltas),
  }
  fs.writeFileSync(OUT, JSON.stringify(payload))
  console.log(`\n已写出 ${path.relative(ROOT, OUT)}（${(fs.statSync(OUT).size / 1024).toFixed(1)} KB）`)
  console.log(`提示线建议：95 百分位 → 问答体 delta ≥ ${q(qaDeltas, 0.95).toFixed(3)}、作文体 delta ≥ ${q(essayDeltas, 0.95).toFixed(3)}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
