import { describe, expect, it } from 'vitest'
import { LM_MASK, bigramBucket } from '../lib/lmText'
import { calibrateDelta, percentileOf, pickBaseline, scoreLmText, type LmModel } from '../lib/lmChannel'

/**
 * 用构造的微型模型验证通道的核心行为。
 *
 * 不去加载真实的 1.1MB 产物：单元测试要跑得快、跑得稳，
 * 真实产物的正确性由 scripts/verify-lm.ts 独立复算负责（那是另一层验收）。
 */

const VOCAB = ['甲', '乙', '丙']

function makeModel(boost: [string, string] | null): {
  index: Map<number, number>
  unigram: Float32Array
  table: Uint8Array
  total: number
} {
  const index = new Map<number, number>()
  VOCAB.forEach((c, i) => index.set(c.codePointAt(0)!, i))
  const unigram = new Float32Array(VOCAB.length).fill(1_000_000)
  const table = new Uint8Array(1 << 19)
  if (boost) {
    // q=189 → 反量化约 4.9e5，配合 unigram 1e6 得到约 0.49 的 bigram 概率
    table[bigramBucket(boost[0], boost[1], LM_MASK)] = 189
  }
  return { index, unigram, table, total: 3_000_000 }
}

// 人类模型偏爱「甲甲」，AI 模型偏爱「乙乙」
const model: LmModel = {
  human: makeModel(['甲', '甲']),
  ai: makeModel(['乙', '乙']),
}

const humanish = '甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲甲'
const aiish = '乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙乙'

describe('语言模型通道', () => {
  it('AI 文风文本的读数高于真人文风文本', () => {
    const a = scoreLmText(model, aiish)
    const h = scoreLmText(model, humanish)
    expect(a.available).toBe(true)
    expect(h.available).toBe(true)
    expect(a.delta).toBeGreaterThan(0)
    expect(h.delta).toBeLessThan(0)
    expect(a.score).toBeGreaterThan(h.score)
  })

  it('分数被限制在 0–100 且随似然比单调递增', () => {
    const scores = [-3, -1, 0, 1, 3].map((d) => calibrateDelta(d))
    for (const s of scores) {
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(100)
    }
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1])
    }
  })

  it('文本过短时拒判，不返回读数', () => {
    const r = scoreLmText(model, '甲甲乙')
    expect(r.available).toBe(false)
    expect(r.sentences).toEqual([])
  })

  it('句级读数按分数降序，便于学生先看最像的几句', () => {
    const text = `${aiish}。${humanish}。${aiish}。`
    const r = scoreLmText(model, text)
    expect(r.available).toBe(true)
    const scores = r.sentences.map((s) => s.score)
    expect(scores.length).toBeGreaterThan(0)
    expect([...scores].sort((x, y) => y - x)).toEqual(scores)
  })

  it('句间波动为非负数（突发度指标）', () => {
    const r = scoreLmText(model, `${aiish}。${humanish}。${aiish}。`)
    expect(r.burstiness).toBeGreaterThanOrEqual(0)
  })
})


/**
 * 百分位参照系（v0.15）。
 *
 * 为什么要它：固定 Platt 曲线是在问答体上拟合的，真人作文的 delta 比问答体真人低 1.85 个
 * 标准差，换到作文体裁整条曲线平移——实测 12 篇 AI 腔中文作文全部落在 20 分以下。
 * 改成「在同类真人文本中的百分位」后阈值自动落位：作文体裁 AUC 0.981、95 百分位召回 100%。
 */
describe('百分位参照系', () => {
  it('pickBaseline：中文长文走作文基线，英文或短文走问答基线', () => {
    expect(pickBaseline('甲'.repeat(300))).toBe('essay')
    expect(pickBaseline('a '.repeat(300))).toBe('qa')
    expect(pickBaseline('甲'.repeat(50))).toBe('qa') // 太短，不足以判定体裁
  })

  it('percentileOf：单调不减，且两端夹在 0–100', () => {
    const tiny = -99
    const huge = 99
    expect(percentileOf(tiny, 'essay')).toBe(0)
    expect(percentileOf(huge, 'essay')).toBe(100)
    expect(percentileOf(tiny, 'qa')).toBe(0)
    expect(percentileOf(huge, 'qa')).toBe(100)
    const mid = percentileOf(-1.232, 'essay')
    expect(mid).toBeGreaterThanOrEqual(0)
    expect(mid).toBeLessThanOrEqual(100)
    // 同一个 delta 在作文基线下应高于问答基线（作文真人分布整体更低）
    const d = -0.9
    expect(percentileOf(d, 'essay')).toBeGreaterThan(percentileOf(d, 'qa'))
  })

  it('参照系分体裁：同一段文字的百分位在两条基线下不同，这是设计意图', () => {
    // 真人作文的典型 delta 约 -1.2（作文真人 p50 = -1.23）：在作文基线里接近中位，
    // 在问答基线里落到 p10 附近——同一个 delta、两条基线，差出 45 个百分点，正是必须分体裁的原因
    expect(percentileOf(-1.2, 'essay')).toBeGreaterThan(40)
    expect(percentileOf(-1.2, 'essay')).toBeLessThan(70)
    expect(percentileOf(-1.2, 'qa')).toBeLessThan(20)
  })
})
