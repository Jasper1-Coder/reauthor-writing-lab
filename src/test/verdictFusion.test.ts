import { describe, expect, it } from 'vitest'
import { fuseRecord, fuseVerdicts, fusionToAppealText, type FusionRecordInput } from '../lib/verdictFusion'
import { buildAppealLetterMarkdown } from '../lib/report'
import { buildAppealPacket } from '../lib/appealPacket'
import { analyzeText } from '../lib/analyzer'
import { SAMPLE_ZH } from '../data/samples'

function rec(partial: Partial<FusionRecordInput> & { score: number }): FusionRecordInput {
  return { platform: '测试平台', date: '2026-01-01', ...partial }
}

describe('verdictFusion · 多平台判定证据拆解', () => {
  it('默认中性：未勾选任何事实时零折扣，原始分不被改写', () => {
    const result = fuseVerdicts([rec({ platform: '平台A', score: 90 }), rec({ platform: '平台B', score: 85 })])
    expect(result.conflictCount).toBe(0)
    expect(result.uncalibratedCount).toBe(2)
    // 未公开校准仍算一条折扣项（默认按"未公开"处理），但原始分字段保持原样
    expect(result.records[0].record.score).toBe(90)
    expect(result.rawScores).toEqual([90, 85])
    expect(result.meanRaw).toBe(88)
    // 没有勾选利益冲突时绝不含利益冲突折扣
    expect(result.records[0].discounts.some((d) => d.label.includes('付费改稿'))).toBe(false)
  })

  it('勾选利益冲突后权重下调，且折扣依据只陈述可核查关系、不写动机断言', () => {
    const single = fuseRecord(rec({ score: 100, sellsRewriteService: true, publishedCalibration: true }), 0)
    const conflict = single.discounts.find((d) => d.label.includes('付费改稿'))
    expect(conflict).toBeTruthy()
    expect(conflict!.amount).toBe(25)
    expect(single.evidenceWeight).toBe(75)
    expect(conflict!.basis).toContain('可核查')
    const allText = single.discounts.map((d) => d.label + d.basis).join('')
    for (const banned of ['故意判高', '牟利', '想让学生付钱', '骗', '动机不纯']) {
      expect(allText).not.toContain(banned)
    }
  })

  it('极差越大一致性系数越低，综合证据强度随之下降', () => {
    const aligned = fuseVerdicts([rec({ platform: 'A', score: 60 }), rec({ platform: 'B', score: 62 })])
    const spread = fuseVerdicts([rec({ platform: 'A', score: 5 }), rec({ platform: 'B', score: 70 })])
    expect(aligned.scoreRange).toBe(2)
    expect(spread.scoreRange).toBe(65)
    expect(aligned.consistencyFactor).toBe(1)
    expect(spread.consistencyFactor).toBe(0.7)
    expect(spread.weightedEvidence).toBeLessThan(aligned.weightedEvidence)
    expect(spread.conclusion).toContain('极差 65')
  })

  it('单条判定极差为 0，不做极差折扣、不新增判罚结论', () => {
    const result = fuseVerdicts([rec({ score: 100, publishedCalibration: true })])
    expect(result.scoreRange).toBe(0)
    expect(result.records[0].discounts.length).toBe(0)
    expect(result.records[0].evidenceWeight).toBe(100)
  })

  it('空录入降级：不生成任何本案证据式断言', () => {
    const result = fuseVerdicts([])
    expect(result.records).toEqual([])
    expect(result.conclusion).toContain('尚未录入')
    expect(result.conclusion).not.toContain('证明')
    expect(fusionToAppealText(result)).toBe('')
  })

  it('导出文本保留原始分与折扣依据，且结论只评证据强度、不判作者身份', () => {
    const result = fuseVerdicts([
      rec({ platform: '平台A', score: 95, sellsRewriteService: true, publishedCalibration: true }),
      rec({ platform: '平台B', score: 20, publishedCalibration: true }),
    ])
    const text = fusionToAppealText(result)
    expect(text).toContain('对外部检测判定的证据拆解')
    expect(text).toContain('95%')
    expect(text).toContain('20%')
    expect(text).toContain('付费改稿')
    expect(text).toContain('证据强度')
    expect(text).toContain('不是对你是否使用 AI 的判定')
    for (const banned of ['真实 AI 率', '证明你', '被冤枉', '故意判高', '牟利']) {
      expect(text).not.toContain(banned)
    }
  })

  it('同类平台一视同仁：相同标记得到相同权重，无针对特定平台的分支', () => {
    const a = fuseRecord(rec({ platform: '知网', score: 80, sellsRewriteService: true }), 0)
    const b = fuseRecord(rec({ platform: 'Pangram', score: 80, sellsRewriteService: true }), 0)
    expect(a.evidenceWeight).toBe(b.evidenceWeight)
    expect(a.discounts.map((d) => d.amount)).toEqual(b.discounts.map((d) => d.amount))
  })

  it('接入申诉信：传入融合文本则落地段落，不传则向后兼容不出现', () => {
    const report = analyzeText(SAMPLE_ZH, { language: 'auto', documentType: 'academic' })
    const packet = buildAppealPacket(report)
    const fusion = fuseVerdicts([rec({ platform: '平台A', score: 92, sellsRewriteService: true, publishedCalibration: true })])
    const text = fusionToAppealText(fusion)
    const withFusion = buildAppealLetterMarkdown(packet, text)
    const withoutFusion = buildAppealLetterMarkdown(packet)
    expect(withFusion).toContain('对外部检测判定的证据拆解')
    expect(withFusion).toContain('92%')
    expect(withoutFusion).not.toContain('对外部检测判定的证据拆解')
  })
})
