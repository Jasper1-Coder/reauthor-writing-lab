import { describe, expect, it } from 'vitest'
import { SAMPLE_EN, SAMPLE_HUMAN_ZH, SAMPLE_ZH } from '../data/samples'
import { evaluateDisagreement } from '../data/defenseEvidence'
import { buildDefenseDocument } from '../lib/defense'
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
    expect(report.sufficiencyHint).toContain('400')
  })

  it('accepts mixed-language papers when either language meets its own threshold', () => {
    const chineseBody = `本研究讨论大模型辅助写作在小组项目中的使用模式。我们跟踪了四个小组的修改历史，发现学生会在方法段落保留模板表达，而在论证部分大幅改写。访谈进一步说明，学生并非随机接受或拒绝生成内容，而是按任务风险做出选择。这个分布特征提示，检测工具按句均匀打分的做法可能与真实使用模式不匹配。`.repeat(4)
    const mixed = `We tracked four groups of students across eight weeks of coursework. Each group produced 2.3 ChatGPT drafts on average before peer review.\n\n${chineseBody}`
    const report = analyzeText(mixed, options)
    expect(report.stats.chineseCharacters).toBeGreaterThanOrEqual(400)
    expect(report.isSampleSufficient).toBe(true)
    expect(report.level).not.toBe('insufficient')
  })

  it('still abstains when a long text has too few sentences', () => {
    const longOneSentence = `这一段只有一句话但写得非常长。`.repeat(0) + '这句话本身没有句号分隔'.repeat(40)
    const report = analyzeText(longOneSentence, options)
    expect(report.isSampleSufficient).toBe(false)
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

describe('defense kit', () => {
  it('flags severe platform disagreement and builds the argument', () => {
    const verdict = evaluateDisagreement([5, 70, 50])
    expect(verdict.level).toBe('severely-divergent')
    expect(verdict.spread).toBe(65)
    expect(verdict.argument).toContain('65')
  })

  it('warns that consistency does not imply correctness', () => {
    const verdict = evaluateDisagreement([44, 45])
    expect(verdict.level).toBe('consistent')
    expect(verdict.argument).toContain('一致性不等于正确性')
  })

  it('builds a defense document with evidence, records and honesty guardrails', () => {
    const report = analyzeText(SAMPLE_EN, options)
    const doc = buildDefenseDocument(
      report,
      [{ platform: '知网', score: 78, date: '2026-11-16' }, { platform: 'PaperPass', score: 30, date: '2026-11-16' }],
      evaluateDisagreement([78, 30]),
      { timeline: '', evidenceNotes: '', aiUsage: '未使用 AI 生成正文' },
    )
    expect(doc).toContain('AIGC 检测结果申诉参考材料')
    expect(doc).toContain('61.3%')
    expect(doc).toContain('写作过程陈述')
    expect(doc).toContain('未使用 AI 生成正文')
    expect(doc).toContain('| 知网 | 78% | 2026-11-16 |')
    expect(doc).toContain('只应填写真实信息')
    expect(doc).toContain('机器初检')
  })
})
