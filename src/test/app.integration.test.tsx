// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from '../App'
import { SAMPLE_ZH } from '../data/samples'

// React 19 要求在 jsdom 中显式声明 act 环境，否则每次 act() 都会打印
// "The current testing environment is not configured to support act(...)" 警告。
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('App integration (jsdom)', () => {
  it('loads a sample, runs analysis and renders the report', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    let root: Root | null = createRoot(container)
    await act(async () => {
      root!.render(<App />)
    })

    // Header and editor render
    expect(container.querySelector('h1')?.textContent).toContain('AI')
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea).toBeTruthy()
    const analyzeButton = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('开始可解释分析'))
    expect(analyzeButton).toBeTruthy()
    expect((analyzeButton as HTMLButtonElement).disabled).toBe(true)

    // Load the Chinese sample via the sample button
    const sampleButton = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('中文模板'))
    expect(sampleButton).toBeTruthy()
    await act(async () => { sampleButton!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe(SAMPLE_ZH)

    // Run the full analysis
    const enabledButton = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('开始可解释分析')) as HTMLButtonElement
    expect(enabledButton.disabled).toBe(false)
    await act(async () => { enabledButton.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    // 分析分 4 个阶段异步推进（约 800ms）。在 act 内用真实定时器等待其完成，
    // 让所有 setState 都被 act 追踪，避免 act 警告；不能在此处轮询 DOM，
    // 因为 act 结束前不会把更新提交到 DOM。
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 1200)) })
    expect(container.querySelector('#results')).toBeTruthy()

    // Report surface: score ring, metrics, sentence annotations, rubric tab
    expect(container.querySelector('.score-number strong')?.textContent).toMatch(/^\d+$/)
    expect(container.querySelectorAll('.metric-card').length).toBe(5)
    expect(container.querySelectorAll('.sentence-row').length).toBeGreaterThanOrEqual(10)
    expect(container.textContent).toContain('AI 写作特征指数')
    expect(container.textContent).toContain('不是 AI 生成概率')

    // 分数对不上说明：学生必问的「别人 100 我这里十几分」，正面回应不可退化
    expect(container.textContent).toContain('为什么别人判我 100 分')
    expect(container.querySelector('.score-gap-explain')).toBeTruthy()
    expect(container.textContent).toContain('61.3%')

    // Switch to the revision tab
    const revisionTab = [...container.querySelectorAll('.diagnosis-tabs button')].find((button) => button.textContent?.includes('修改路线'))
    await act(async () => { revisionTab!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(container.textContent).toContain('REVISION, NOT EVASION')

    await act(async () => { root!.unmount() })
    root = null
    container.remove()
  })
})
