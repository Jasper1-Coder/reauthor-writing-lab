/**
 * ReAuthor 校准管线 v0.2
 * 数据源：Hello-SimpleAI/HC3 中文子集（open_qa / wiki_csai / finance / medicine）
 * 运行：npx tsx scripts/calibrate.ts
 * 输出：src/data/calibration.json（站点展示）+ calibration/hc3_zh_sample.jsonl（可复现样本）
 *
 * 诚实披露：HC3 的 AI 答案来自 2023 年初的 ChatGPT（gpt-3.5-turbo 一代），
 * 不代表 2026 年模型；本校准只回答"本引擎对老一代 AI 问答文本的分辨力"。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyzeText } from '../src/lib/analyzer'

const ROOT = join(import.meta.dirname, '..')
const RAW_DIR = join(ROOT, 'calibration', 'raw')
const OUT_DIR = join(ROOT, 'src', 'data')
const DOMAINS = ['open_qa', 'wiki_csai', 'finance', 'medicine'] as const
const MAX_PER_CLASS_PER_DOMAIN = 60
const MIN_CHARS = 120
const MAX_CHARS = 3000

interface Hc3Row {
  question: string
  human_answers: string[]
  chatgpt_answers: string[]
}

interface Sample {
  label: 'human' | 'ai'
  domain: string
  text: string
}

const clampShort = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS)

function extract(rows: Hc3Row[], domain: string): Sample[] {
  const human: string[] = []
  const ai: string[] = []
  rows.forEach((row) => {
    row.human_answers.forEach((answer) => {
      const clean = clampShort(answer)
      if (clean.length >= MIN_CHARS) human.push(clean)
    })
    row.chatgpt_answers.forEach((answer) => {
      const clean = clampShort(answer)
      if (clean.length >= MIN_CHARS) ai.push(clean)
    })
  })
  const pick = (pool: string[], label: 'human' | 'ai'): Sample[] => {
    const stride = Math.max(1, Math.floor(pool.length / MAX_PER_CLASS_PER_DOMAIN))
    return pool
      .filter((_, index) => index % stride === 0)
      .slice(0, MAX_PER_CLASS_PER_DOMAIN)
      .map((text) => ({ label, domain, text }))
  }
  return [...pick(human, 'human'), ...pick(ai, 'ai')]
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function auc(scores: Array<{ label: 'human' | 'ai'; score: number }>): number {
  const positives = scores.filter((item) => item.label === 'ai')
  const negatives = scores.filter((item) => item.label === 'human')
  if (!positives.length || !negatives.length) return 0.5
  const sortedNeg = negatives.map((item) => item.score).sort((a, b) => a - b)
  let wins = 0
  let ties = 0
  positives.forEach(({ score }) => {
    let left = 0
    while (left < sortedNeg.length && sortedNeg[left] < score) left += 1
    let right = left
    while (right < sortedNeg.length && sortedNeg[right] === score) right += 1
    wins += left
    ties += right - left
  })
  return (wins + ties / 2) / (positives.length * negatives.length)
}

const samples: Sample[] = DOMAINS.flatMap((domain) => {
  const lines = readFileSync(join(RAW_DIR, `${domain}.jsonl`), 'utf-8').split('\n').filter(Boolean)
  const rows = lines.map((line) => JSON.parse(line) as Hc3Row)
  return extract(rows, domain)
})

console.log(`样本：${samples.length} 条（human ${samples.filter((s) => s.label === 'human').length} / ai ${samples.filter((s) => s.label === 'ai').length}）`)

const scored = samples.map((sample, index) => {
  const report = analyzeText(sample.text, { language: 'zh', documentType: 'general' })
  if ((index + 1) % 60 === 0) console.log(`  已分析 ${index + 1}/${samples.length}`)
  return { ...sample, score: report.score, sufficient: report.isSampleSufficient }
})

const FLAG_THRESHOLD = 55
const human = scored.filter((item) => item.label === 'human')
const ai = scored.filter((item) => item.label === 'ai')
const fpr = human.filter((item) => item.score >= FLAG_THRESHOLD).length / human.length
const fnr = ai.filter((item) => item.score < FLAG_THRESHOLD).length / ai.length
const balancedAccuracy = 1 - (fpr + fnr) / 2
const rocAuc = auc(scored)

const byDomain = DOMAINS.map((domain) => {
  const subset = scored.filter((item) => item.domain === domain)
  return {
    domain,
    humanMedian: Number(median(subset.filter((item) => item.label === 'human').map((item) => item.score)).toFixed(1)),
    aiMedian: Number(median(subset.filter((item) => item.label === 'ai').map((item) => item.score)).toFixed(1)),
    count: subset.length,
  }
})

const payload = {
  generatedAt: new Date().toISOString().slice(0, 10),
  dataset: {
    name: 'HC3 中文子集（Hello-SimpleAI/HC3：open_qa / wiki_csai / finance / medicine）',
    aiModelEra: '2023 年初 ChatGPT（gpt-3.5 一代）',
    sampleCount: scored.length,
    humanCount: human.length,
    aiCount: ai.length,
    sampling: `每领域每类最多 ${MAX_PER_CLASS_PER_DOMAIN} 条等距抽样；答案 ≥${MIN_CHARS} 字符，截断至 ${MAX_CHARS} 字符`,
  },
  engineVersion: 'rules-v0.2.0',
  results: {
    rocAuc: Number(rocAuc.toFixed(3)),
    flagThreshold: FLAG_THRESHOLD,
    falsePositiveRate: Number(fpr.toFixed(3)),
    falseNegativeRate: Number(fnr.toFixed(3)),
    balancedAccuracy: Number(balancedAccuracy.toFixed(3)),
    humanMedian: Number(median(human.map((item) => item.score)).toFixed(1)),
    aiMedian: Number(median(ai.map((item) => item.score)).toFixed(1)),
  },
  sufficiency: {
    humanSufficientRatio: Number((human.filter((item) => item.sufficient).length / human.length).toFixed(3)),
    aiSufficientRatio: Number((ai.filter((item) => item.sufficient).length / ai.length).toFixed(3)),
  },
  byDomain,
  disclosures: [
    'AI 样本来自 2023 年初 ChatGPT，对 2026 年模型与洗稿文本的分辨力未在本报告中声称。',
    '阈值 55 是本站"模板化特征较集中"的分级线，不是司法或学术处分意义上的判定线。',
    '本表只描述本引擎在本数据集上的统计行为，不构成对任何具体文本的作者判断。',
  ],
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'calibration.json'), JSON.stringify(payload, null, 2), 'utf-8')
mkdirSync(join(ROOT, 'calibration'), { recursive: true })
writeFileSync(
  join(ROOT, 'calibration', 'hc3_zh_sample.jsonl'),
  samples.map((sample) => JSON.stringify(sample)).join('\n'),
  'utf-8',
)
console.log('\n===== 校准结果（阈值 55）=====')
console.log(JSON.stringify(payload.results, null, 2))
console.log('已写入 src/data/calibration.json')
