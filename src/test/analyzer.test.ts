import { describe, expect, it } from 'vitest'
import { SAMPLE_EN, SAMPLE_HUMAN_ZH, SAMPLE_ZH } from '../data/samples'
import { analyzeText, detectLanguage, splitSentences } from '../lib/analyzer'

const options = { language: 'auto', documentType: 'academic' } as const

describe('language and sentence processing', () => {
  it('detects Chinese and English text', () => {
    expect(detectLanguage(SAMPLE_ZH)).toBe('zh')
    expect(detectLanguage(SAMPLE_EN)).toBe('en')
  })

  it('splits Chinese and English sentences', () => {
    expect(splitSentences(SAMPLE_ZH).length).toBeGreaterThanOrEqual(10)
    expect(splitSentences(SAMPLE_EN).length).toBeGreaterThanOrEqual(10)
  })
})

describe('transparent heuristic scoring', () => {
  it('gives the template-heavy Chinese sample a higher feature score', () => {
    const templated = analyzeText(SAMPLE_ZH, options)
    const personal = analyzeText(SAMPLE_HUMAN_ZH, options)
    expect(templated.score).toBeGreaterThan(personal.score)
    expect(templated.metrics.find((metric) => metric.id === 'formulaic')!.score).toBeGreaterThan(30)
  })

  it('keeps the evidence-rich English draft below the template-heavy Chinese sample', () => {
    const english = analyzeText(SAMPLE_EN, options)
    const templated = analyzeText(SAMPLE_ZH, options)
    expect(english.score).toBeLessThan(templated.score)
    expect(english.sentenceAnalyses.length).toBeGreaterThan(5)
  })

  it('abstains from a risk label on short samples', () => {
    const report = analyzeText('In conclusion, AI is very important in today’s society. It has many benefits.', options)
    expect(report.isSampleSufficient).toBe(false)
    expect(report.level).toBe('insufficient')
    expect(report.levelLabel).toContain('暂不判定')
  })

  it('uses weights that sum to one', () => {
    const report = analyzeText(SAMPLE_ZH, options)
    expect(report.metrics.reduce((sum, metric) => sum + metric.weight, 0)).toBeCloseTo(1)
  })

  it('provides actionable suggestions for every flagged sentence', () => {
    const report = analyzeText(SAMPLE_ZH, options)
    const flagged = report.sentenceAnalyses.filter((sentence) => sentence.level !== 'low')
    expect(flagged.length).toBeGreaterThan(0)
    flagged.forEach((sentence) => expect(sentence.suggestions.length).toBeGreaterThan(0))
  })

  it('returns deterministic scores for the same text', () => {
    const first = analyzeText(SAMPLE_EN, options)
    const second = analyzeText(SAMPLE_EN, options)
    expect(first.score).toBe(second.score)
    expect(first.metrics).toEqual(second.metrics)
  })

  it('reports four independent detectors with a consistent cross-validation verdict', () => {
    const report = analyzeText(SAMPLE_ZH, options)
    const cross = report.crossValidation
    expect(cross.detectors.map((detector) => detector.id)).toEqual([
      'lexicon',
      'rhythm',
      'repetition',
      'specificity',
    ])
    const scores = cross.detectors.map((detector) => detector.score)
    expect(cross.spread).toBe(Math.max(...scores) - Math.min(...scores))
    expect(['aligned', 'mixed', 'divergent']).toContain(cross.verdict)
    expect(cross.note.length).toBeGreaterThan(10)
  })
})
