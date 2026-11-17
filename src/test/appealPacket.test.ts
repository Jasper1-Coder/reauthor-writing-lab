// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { SAMPLE_ZH } from '../data/samples'
import { analyzeText } from '../lib/analyzer'
import {
  DEGRADED_NOTICE,
  ETHICS_NOTICE,
  ONE_PAGER_LINES,
  SELF_PLACEHOLDER,
  SINGLE_PERCENTAGE_CAVEAT,
  buildAppealPacket,
} from '../lib/appealPacket'
import { buildAppealLetterMarkdown } from '../lib/report'
import { DefenseKit } from '../components/DefenseKit'
import type { AnalysisReport, RetrievalChannelResult } from '../lib/types'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// 拦截 downloadText，直接拿到传给它的 Markdown 字符串，避免 jsdom  unsupported 的 Blob URL
const { downloadMock } = vi.hoisted(() => ({ downloadMock: vi.fn() }))
vi.mock('../lib/report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/report')>()
  return { ...actual, downloadText: downloadMock }
})

const options = { language: 'auto', documentType: 'academic' } as const
const report = analyzeText(SAMPLE_ZH, options)
const shortReport = analyzeText('In conclusion, AI is very important in today’s society. It has many benefits.', options)

const retrieval: RetrievalChannelResult = {
  status: 'done',
  message: '检索完成',
  score: 42,
  coverage: 0.21,
  corpusSize: 6010,
  neighbors: [
    { label: 1, similarity: 0.87, excerpt: '语料片段一', docIndex: 3 },
    { label: 0, similarity: 0.81, excerpt: '语料片段二', docIndex: 5 },
    { label: 1, similarity: 0.79, excerpt: '语料片段三', docIndex: 7 },
    { label: 0, similarity: 0.7, excerpt: '语料片段四', docIndex: 9 },
  ],
}

beforeEach(() => {
  window.localStorage.clear()
  downloadMock.mockClear()
})

function renderKit(target: AnalysisReport, channel?: RetrievalChannelResult) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const onToast = vi.fn()
  return {
    container,
    onToast,
    render: async () => {
      await act(async () => {
        root.render(createElement(DefenseKit, { report: target, retrieval: channel, onToast }))
      })
    },
    unmount: async () => {
      await act(async () => { root.unmount() })
      container.remove()
    },
  }
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function clickButtons(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(label)) as HTMLButtonElement
  expect(button).toBeTruthy()
  return button
}

describe('证据装配器 · 字段与常量', () => {
  it('逐字段装配：分数校验、检索通道追加、JSON 真实数字、最近邻最多 3 条', () => {
    const packet = buildAppealPacket(report, retrieval, {
      platform: '知网',
      score: '88',
      platformRecords: [{ platform: '知网', score: 78, date: '2026-11-16' }],
    })
    expect(packet.sufficient).toBe(true)
    expect(packet.degraded).toBe(false)
    expect(packet.degradedNotice).toBe('')
    expect(packet.verdict.judgedPlatform).toBe('知网')
    expect(packet.verdict.judgedScore).toBe(88)
    expect(packet.verdict.siteReading).toBe(report.score)
    expect(packet.verdict.siteLevelLabel).toBe(report.levelLabel)
    expect(packet.verdict.siteCalibratedScore).toBe(report.calibratedScore)
    expect(packet.disagreement.channels.length).toBe(report.crossValidation.detectors.length + 1)
    expect(packet.disagreement.channels.at(-1)).toEqual({ name: '语料检索通道', score: retrieval.score })
    expect(packet.disagreement.spread).toBe(report.crossValidation.spread)
    expect(packet.disagreement.caveat).toBe(SINGLE_PERCENTAGE_CAVEAT)
    expect(packet.crossDomain.calibratedAuc).toBe(0.859)
    expect(packet.crossDomain.calibratedScoreMin).toBe(0)
    expect(packet.crossDomain.calibratedScoreMax).toBe(18)
    expect(packet.crossDomain.at50Sensitivity).toBe(0)
    expect(packet.crossDomain.at50Specificity).toBe(1)
    expect(packet.crossDomain.ruleAuc).toBe(0.223)
    expect(packet.crossDomain.reproduceCommand).toBe('npx tsx scripts/crossdomain-test.ts')
    expect(packet.retrieval.available).toBe(true)
    expect(packet.retrieval.nearestNeighbors.length).toBe(3)
    expect(packet.retrieval.note).not.toContain('暂缺')
    expect(packet.selfStatement.isPlaceholder).toBe(true)
    expect(packet.ethicsNotice).toBe(ETHICS_NOTICE)
  })

  it('非法分数与缺省信息得到 null / 空值，检索缺省给出不可用文案', () => {
    const packet = buildAppealPacket(report, undefined, { score: 'abc' })
    expect(packet.verdict.judgedScore).toBeNull()
    expect(packet.verdict.judgedPlatform).toBe('')
    expect(packet.verdict.platformRecords).toEqual([])
    expect(packet.disagreement.channels.length).toBe(report.crossValidation.detectors.length)
    expect(packet.retrieval.available).toBe(false)
    expect(packet.retrieval.nearestNeighbors).toEqual([])
    expect(packet.retrieval.score).toBeNull()
    expect(packet.rewrite.hasEntries).toBe(false)
    expect(packet.rewrite.placeholder).toContain('改写工作台')
  })

  it('用户填写写作过程后 isPlaceholder 为假', () => {
    const packet = buildAppealPacket(report, retrieval, { timeline: '  ', evidenceNotes: '版本历史截图', aiUsage: '   ' })
    expect(packet.selfStatement.isPlaceholder).toBe(false)
    expect(packet.selfStatement.evidenceNotes).toBe('版本历史截图')
  })
})

describe('AC-1 · 导出信内容完整性', () => {
  it('包含每个通道分数、分歧度、脚注、自述占位与两条固定口径', () => {
    const packet = buildAppealPacket(report, retrieval, { platform: '知网', score: 78 })
    const md = buildAppealLetterMarkdown(packet)
    packet.disagreement.channels.forEach((channel) => expect(md).toContain(`${channel.name}：${channel.score}`))
    expect(md).toContain(`通道分歧度：${packet.disagreement.spread}`)
    expect(md).toMatch(/crossDomainValidation\.json|calibratedModel\.json|scripts\/crossdomain-test\.ts|scripts\/train-model\.ts/)
    expect(md).toContain(SELF_PLACEHOLDER.timeline)
    expect(md).toContain(SELF_PLACEHOLDER.evidenceNotes)
    expect(md).toContain(SELF_PLACEHOLDER.aiUsage)
    expect(md).toContain(SINGLE_PERCENTAGE_CAVEAT)
    expect(md).toContain(ETHICS_NOTICE)
    expect(md).toContain('## 八、申诉请求')
  })

  it('改写记录存在时逐句列出原文/改写/理由/分数变化', () => {
    const packet = buildAppealPacket(report, retrieval, {
      rewriteEntries: [{
        sentenceId: 3,
        original: '在当今社会，人工智能技术正在产生深远的影响。',
        draft: '根据我记录的课堂数据，该工具使检索时间减少了约三成。',
        originalScore: 55,
        draftScore: 24,
        reason: '补上了具体来源和可核查的数据。',
        hitsCleared: ['深远影响'],
      }],
    })
    expect(packet.rewrite.hasEntries).toBe(true)
    const md = buildAppealLetterMarkdown(packet)
    expect(md).toContain('## 五、改写前后对照')
    expect(md).toContain('55 → 24')
    expect(md).toContain('我为什么这样改')
    expect(md).toContain('补上了具体来源和可核查的数据。')
  })
})

describe('AC-2 · 工作台默认自动填充', () => {
  it('默认展示自动填充证据；录入平台分数后下载已填充申诉信', async () => {
    const kit = renderKit(report)
    await kit.render()

    expect(kit.container.textContent).toContain(String(report.score))
    expect(kit.container.textContent).toContain(String(report.crossValidation.spread))
    expect(kit.container.textContent).toContain('本站校准模型通道读数')
    expect(kit.container.textContent).toContain(String(buildAppealPacket(report).crossDomain.calibratedScoreMin))
    expect(kit.container.textContent).not.toContain('（待填写）')

    const inputs = kit.container.querySelectorAll('.record-form input')
    await act(async () => {
      setInputValue(inputs[0] as HTMLInputElement, '知网')
      setInputValue(inputs[1] as HTMLInputElement, '78')
    })
    await act(async () => { clickButtons(kit.container, '录入').click() })
    await act(async () => { clickButtons(kit.container, '下载申诉信').click() })

    expect(downloadMock).toHaveBeenCalledTimes(1)
    const [markdown, filename] = downloadMock.mock.calls[0]
    expect(filename).toMatch(/^reauthor-appeal-letter-\d{4}-\d{2}-\d{2}\.md$/)
    expect(markdown).toContain('知网')
    expect(markdown).toContain('78%')
    expect(markdown).toContain('- 被判分数：78')
    expect(markdown).not.toContain('- 被判分数：（待填写）')
    expect(markdown).toContain('## 一、判决概况')
    expect(markdown).toContain('## 二、本文多通道分歧实证')
    expect(markdown).toContain('## 六、写作过程自述')
    expect(markdown).toContain(SELF_PLACEHOLDER.timeline)

    await kit.unmount()
  })
})

describe('AC-3 · 样本不足降级（三层）', () => {
  it('letter 降级分支不含申诉请求段，含降级说明与伦理红线', () => {
    expect(shortReport.isSampleSufficient).toBe(false)
    const packet = buildAppealPacket(shortReport)
    expect(packet.degraded).toBe(true)
    expect(packet.degradedNotice).toBe(DEGRADED_NOTICE)
    const md = buildAppealLetterMarkdown(packet)
    expect(md).not.toContain('## 八、申诉请求')
    expect(md).not.toContain('AIGC 检测结果申诉信')
    expect(md).toContain('# 规则观察说明（样本不足）')
    expect(md).toContain(DEGRADED_NOTICE)
    expect(md).toContain(ETHICS_NOTICE)
  })

  it('工作台禁用下载/复制，一页纸只显示降级说明', async () => {
    const kit = renderKit(shortReport)
    await kit.render()
    const buttons = [...kit.container.querySelectorAll('.defense-actions button')] as HTMLButtonElement[]
    expect(buttons.length).toBeGreaterThanOrEqual(2)
    expect(buttons[0].disabled).toBe(true)
    expect(buttons[1].disabled).toBe(true)

    const onepager = kit.container.querySelector('.defense-onepager')!
    expect(onepager.textContent).toContain(DEGRADED_NOTICE)
    expect(onepager.textContent).not.toContain(ONE_PAGER_LINES[0])
    expect(onepager.textContent).not.toContain(ONE_PAGER_LINES[1])
    expect(kit.container.querySelector('[role="alert"]')!.textContent).toContain(DEGRADED_NOTICE)

    await act(async () => { clickButtons(kit.container, '下载申诉信').click() })
    expect(downloadMock).not.toHaveBeenCalled()
    await kit.unmount()
  })
})

describe('AC-4 · 一页纸卡片', () => {
  it('含 3 条本文证据 + 恰好 2 句话术，且无断言词', async () => {
    const packet = buildAppealPacket(report, retrieval)
    const kit = renderKit(report, retrieval)
    await kit.render()

    const card = kit.container.querySelector('.defense-onepager')!
    const text = card.textContent ?? ''
    expect(text).toContain('给老师看的 3 条证据')
    expect(text).toContain(String(report.crossValidation.spread))
    expect(text).toContain(`${packet.crossDomain.calibratedScoreMin}–${packet.crossDomain.calibratedScoreMax}`)
    expect(text).toContain('检索通道覆盖率')
    expect(text).toContain(ONE_PAGER_LINES[0])
    expect(text).toContain(ONE_PAGER_LINES[1])
    expect(text.indexOf(ONE_PAGER_LINES[0])).toBe(text.lastIndexOf(ONE_PAGER_LINES[0]))
    expect(text.indexOf(ONE_PAGER_LINES[1])).toBe(text.lastIndexOf(ONE_PAGER_LINES[1]))
    ;['保证成功', '证明身份', '一定能', '包过'].forEach((word) => expect(text).not.toContain(word))

    await kit.unmount()
  })

  it('检索缺省时第三证据改为改写记录状态', async () => {
    const kit = renderKit(report)
    await kit.render()
    const text = kit.container.querySelector('.defense-onepager')!.textContent ?? ''
    expect(text).toContain('改写前后对照记录 尚未附上')
    expect(text).not.toContain('检索通道覆盖率')
    await kit.unmount()
  })
})

describe('AC-5 · 全量与纯函数', () => {
  it('同一入参连续调用两次深比较相等，且不修改入参', () => {
    const input = { platform: '维普', score: 65, timeline: '  ' }
    const first = buildAppealPacket(report, retrieval, input)
    const second = buildAppealPacket(report, retrieval, input)
    expect(first).toEqual(second)
    expect(input).toEqual({ platform: '维普', score: 65, timeline: '  ' })
  })
})

describe('判决概况 · judgedScore 口径与边界', () => {
  it('录入平台记录后输入框清空：平台名与分数从最后一条记录回填，导出信不再显示待填写', () => {
    // 复刻工作台「录入」后的真实状态：输入框已清空，但 records 里保留如实录入的数据
    const packet = buildAppealPacket(report, undefined, {
      platform: '',
      score: '',
      platformRecords: [
        { platform: '知网', score: 78, date: '2026-11-16' },
        { platform: '维普', score: 65, date: '2026-11-17' },
      ],
    })
    expect(packet.verdict.judgedPlatform).toBe('维普')
    expect(packet.verdict.judgedScore).toBe(65)
    const md = buildAppealLetterMarkdown(packet)
    expect(md).toContain('- 被判平台：维普')
    expect(md).toContain('- 被判分数：65')
    expect(md).not.toContain('- 被判分数：（待填写）')
    // 记录表格仍完整保留两条真实录入，无数据丢失
    expect(md).toContain('| 知网 | 78% |')
    expect(md).toContain('| 维普 | 65% |')
  })

  it('用户当场填写优先于记录回填', () => {
    const packet = buildAppealPacket(report, undefined, {
      platform: 'PaperPass',
      score: '88',
      platformRecords: [{ platform: '知网', score: 78, date: '' }],
    })
    expect(packet.verdict.judgedPlatform).toBe('PaperPass')
    expect(packet.verdict.judgedScore).toBe(88)
  })

  it('分数边界：未填/空串/非法/越界为 null，0 与 100 正常保留且 0 不被误判为缺失', () => {
    expect(buildAppealPacket(report).verdict.judgedScore).toBeNull()
    expect(buildAppealPacket(report, undefined, { score: '' }).verdict.judgedScore).toBeNull()
    expect(buildAppealPacket(report, undefined, { score: 'abc' }).verdict.judgedScore).toBeNull()
    expect(buildAppealPacket(report, undefined, { score: 101 }).verdict.judgedScore).toBeNull()
    expect(buildAppealPacket(report, undefined, { score: -1 }).verdict.judgedScore).toBeNull()
    expect(buildAppealPacket(report, undefined, { score: 0 }).verdict.judgedScore).toBe(0)
    expect(buildAppealPacket(report, undefined, { score: '0' }).verdict.judgedScore).toBe(0)
    expect(buildAppealPacket(report, undefined, { score: 100 }).verdict.judgedScore).toBe(100)
    // 0 是合法分数，即便存在平台记录也不能被回填覆盖
    expect(buildAppealPacket(report, undefined, {
      score: 0,
      platformRecords: [{ platform: '知网', score: 78, date: '' }],
    }).verdict.judgedScore).toBe(0)
  })
})
