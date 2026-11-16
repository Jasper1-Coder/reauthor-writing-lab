/** 探查：五个子指标在 HC3 human vs ai 上的分布差异 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyzeText } from '../src/lib/analyzer'

const ROOT = join(import.meta.dirname, '..')
const lines = readFileSync(join(ROOT, 'calibration', 'hc3_zh_sample.jsonl'), 'utf-8').split('\n').filter(Boolean)

const stats: Record<string, Record<'human' | 'ai', number[]>> = {}
const push = (key: string, label: 'human' | 'ai', value: number) => {
  stats[key] ??= { human: [], ai: [] }
  stats[key][label].push(value)
}

lines.forEach((line) => {
  const sample = JSON.parse(line) as { label: 'human' | 'ai'; text: string }
  const report = analyzeText(sample.text, { language: 'zh', documentType: 'general' })
  report.metrics.forEach((metric) => push(metric.id, sample.label, metric.score))
  push('total', sample.label, report.score)
  const rhythm = report.metrics.find((metric) => metric.id === 'rhythm')!
  push('cvRhythm', sample.label, rhythm.score)
  push('lenChars', sample.label, report.stats.chineseCharacters)
})

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const auc = (h: number[], a: number[]) => {
  let wins = 0
  let ties = 0
  a.forEach((av) => {
    h.forEach((hv) => {
      if (av > hv) wins += 1
      else if (av === hv) ties += 1
    })
  })
  return (wins + ties / 2) / (a.length * h.length)
}

console.log('metric          | human median | ai median | AUC(ai>human)')
for (const [key, buckets] of Object.entries(stats)) {
  const h = buckets.human
  const a = buckets.ai
  console.log(
    `${key.padEnd(15)} | ${median(h).toFixed(1).padStart(8)} | ${median(a).toFixed(1).padStart(8)} | ${auc(h, a).toFixed(3)}`,
  )
}
