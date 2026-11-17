// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { SAMPLE_ZH } from '../data/samples'
import { analyzeText } from '../lib/analyzer'
import { loadDrafts, loadRewriteEntries, pickTargets, rewriteStorageKey } from '../lib/rewriteStore'

const options = { language: 'auto', documentType: 'academic' } as const
const report = analyzeText(SAMPLE_ZH, options)

beforeEach(() => {
  window.localStorage.clear()
})

describe('改写 → 申诉证据回流（P0-1：修复数据链断裂）', () => {
  it('无草稿时返回空数组，绝不虚构过程材料', () => {
    expect(loadRewriteEntries(report)).toEqual([])
  })

  it('按报告 createdAt 隔离草稿，读出学生真实改写为 RewriteEntry', () => {
    const target = pickTargets(report)[0]
    const drafts = {
      [target.id]: { text: '根据课堂记录，这个方法使检索时间缩短了三成。', reason: '补上了原始数据' },
    }
    window.localStorage.setItem(rewriteStorageKey(report), JSON.stringify(drafts))

    const entries = loadRewriteEntries(report)
    expect(entries).toHaveLength(1)
    expect(entries[0].sentenceId).toBe(target.id)
    expect(entries[0].original).toBe(target.text)
    expect(entries[0].draft).toContain('课堂记录')
    expect(entries[0].reason).toBe('补上了原始数据')
    expect(entries[0].originalScore).toBe(target.score)
    // 改写后分数用与改写台完全相同的口径重算
    expect(typeof entries[0].draftScore).toBe('number')
  })

  it('另一份报告的草稿不会串到本报告（按 createdAt 隔离）', () => {
    const other = { ...report, createdAt: report.createdAt + '-other' }
    const target = pickTargets(report)[0]
    window.localStorage.setItem(
      rewriteStorageKey(other),
      JSON.stringify({ [target.id]: { text: '别报告的改写', reason: 'x' } }),
    )
    expect(loadRewriteEntries(report)).toEqual([])
  })

  it('localStorage 内容损坏时静默降级为空', () => {
    window.localStorage.setItem(rewriteStorageKey(report), '{not valid json')
    expect(loadDrafts(report)).toEqual({})
    expect(loadRewriteEntries(report)).toEqual([])
  })
})
