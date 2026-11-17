/**
 * 用现代模型（DeepSeek，2025–26 文风）对 HC3 的**同一批问题**生成答案，
 * 补上训练语料里「AI 侧只有 2023 年 ChatGPT」这个致命缺口。
 *
 * 为什么必须同题：
 *   训练脚本按「域名 + 归一化题目」做并查集分组。同一个问题的三种答案
 *   （人写 / 2023 ChatGPT / 2026 DeepSeek）必须落进同一个 group，
 *   否则会出现「问题 X 的人写答案在训练集、现代 AI 答案在留出集」这种同题跨集泄漏——
 *   这正是 v0.13.0 被红队打回三次的那个坑，不能重犯。
 *
 * 输出：calibration/raw/modern_ai_zh.jsonl
 *   每行 { question, source_domain, gen: {...}, modern_answers: [...] }
 *   source_domain 由训练脚本读取，用来把新样本挂回原域的分组键。
 *
 * 用法：
 *   npx tsx scripts/gen-modern-ai.ts --per-domain 60 --styles 2 --concurrency 8
 *   npx tsx scripts/gen-modern-ai.ts --per-domain 300 --styles 3   # 正式规模
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = process.cwd()
const RAW = path.join(ROOT, 'calibration', 'raw')
const OUT = path.join(RAW, 'modern_ai_zh.jsonl')
const BASE = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
const KEY = process.env.DEEPSEEK_API_KEY ?? ''
const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat'

function arg(name: string, dflt: number): number {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? Number(process.argv[i + 1]) : dflt
}
const PER_DOMAIN = arg('per-domain', 60)
const CONCURRENCY = arg('concurrency', 8)

/** 三种「现代助手」的常见回话姿势，覆盖单一样式带来的捷径风险 */
const STYLES = [
  { id: 'plain', temp: 1.0, system: '你是一个常用助手。直接回答用户问题，语言自然，不要开场客套，不要自我说明。' },
  { id: 'structured', temp: 0.8, system: '你是一个助手。用简洁的书面语回答，条理清晰，必要时分点。不要开场客套。' },
  { id: 'casual', temp: 1.25, system: '你是一个助手。回答尽量简短、口语化，像朋友聊天，不要客套和总结陈词。' },
].slice(0, arg('styles', 2))

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(arr: readonly T[], rnd: () => number): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

interface Job { question: string; domain: string; style: typeof STYLES[number] }

async function call(job: Job): Promise<{ text: string; usage: { in: number; out: number } } | null> {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: job.style.system },
      { role: 'user', content: job.question.slice(0, 1500) },
    ],
    temperature: job.style.temp,
    max_tokens: 900,
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      })
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); continue }
        return null
      }
      const json = await res.json() as {
        choices?: Array<{ message?: { content?: string } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const text = (json.choices?.[0]?.message?.content ?? '').trim()
      if (!text) return null
      return { text, usage: { in: json.usage?.prompt_tokens ?? 0, out: json.usage?.completion_tokens ?? 0 } }
    } catch {
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)))
    }
  }
  return null
}

const MIN_CHARS = 40
const REFUSAL = /^(i'?m sorry|i am sorry|sorry,|as an ai|作为一个?ai|很抱歉|抱歉，我|我无法(?:提供|回答|完成))/i

async function main() {
  if (!KEY) throw new Error('缺少 DEEPSEEK_API_KEY 环境变量')
  const files = fs.readdirSync(RAW).filter((f) => f.startsWith('zh_') && f.endsWith('.jsonl'))

  // 已存在的进度（支持断点续跑，重新执行不会重复烧钱）
  const done = new Map<string, Set<string>>() // question hash → style ids
  if (fs.existsSync(OUT)) {
    fs.readFileSync(OUT, 'utf-8').trim().split('\n').filter(Boolean).forEach((l) => {
      try {
        const o = JSON.parse(l) as { question: string; styles?: string[] }
        const h = hashQ(o.question)
        if (!done.has(h)) done.set(h, new Set())
        ;(o.styles ?? []).forEach((s) => done.get(h)!.add(s))
      } catch { /* ignore */ }
    })
  }

  const jobs: Job[] = []
  for (const f of files) {
    const domain = f.replace('.jsonl', '')
    const rows = fs.readFileSync(path.join(RAW, f), 'utf-8').trim().split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l) as { question?: string } } catch { return {} } })
      .filter((r) => typeof r.question === 'string' && (r.question as string).length > 8)
    const picked = shuffle(rows, mulberry32(20261117 ^ domain.length * 7919)).slice(0, PER_DOMAIN)
    console.log(`${domain.padEnd(20)} 候选 ${String(rows.length).padStart(5)} → 取 ${picked.length}`)
    for (const r of picked) {
      const q = (r.question as string).trim()
      const h = hashQ(q)
      for (const style of STYLES) {
        if (done.get(h)?.has(style.id)) continue
        jobs.push({ question: q, domain, style })
      }
    }
  }

  console.log(`\n待生成 ${jobs.length} 条（并发 ${CONCURRENCY}，模型 ${MODEL}）\n`)
  const out = fs.createWriteStream(OUT, { flags: 'a' })
  let ok = 0, fail = 0, skipped = 0, tokensIn = 0, tokensOut = 0
  const byQ = new Map<string, { question: string; domain: string; answers: string[]; styles: string[] }>()
  const t0 = Date.now()

  let cursor = 0
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < jobs.length) {
      const job = jobs[cursor++]
      const res = await call(job)
      if (!res) { fail++; continue }
      const t = res.text
      if (t.length < MIN_CHARS || REFUSAL.test(t.slice(0, 60))) { skipped++; continue }
      tokensIn += res.usage.in; tokensOut += res.usage.out
      const h = hashQ(job.question)
      const rec = byQ.get(h) ?? { question: job.question, domain: job.domain, answers: [], styles: [] }
      rec.answers.push(t)
      rec.styles.push(job.style.id)
      byQ.set(h, rec)
      ok++
      if (ok % 25 === 0) {
        const el = (Date.now() - t0) / 1000
        console.log(`  ${ok}/${jobs.length} 完成 · ${(ok / el).toFixed(1)} 条/s · 已用 token ${(tokensIn + tokensOut).toLocaleString()}`)
      }
    }
  })
  await Promise.all(workers)

  for (const rec of byQ.values()) {
    out.write(JSON.stringify({
      question: rec.question,
      source_domain: rec.domain,
      styles: rec.styles,
      gen: { model: MODEL, base: BASE, date: new Date().toISOString().slice(0, 10), note: '本文件由 scripts/gen-modern-ai.ts 生成，用于补现代模型文风' },
      modern_answers: rec.answers,
    }) + '\n')
  }
  await new Promise<void>((r) => out.end(() => r()))

  console.log(`\n完成：成功 ${ok} 条，失败 ${fail}，过滤 ${skipped}；覆盖问题 ${byQ.size} 个`)
  console.log(`token：输入 ${tokensIn.toLocaleString()} / 输出 ${tokensOut.toLocaleString()}；耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  console.log(`落盘：${path.relative(ROOT, OUT)}`)
}

function hashQ(q: string): string {
  return crypto.createHash('sha256').update(q.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex').slice(0, 16)
}

main().catch((e) => { console.error(e); process.exit(1) })
