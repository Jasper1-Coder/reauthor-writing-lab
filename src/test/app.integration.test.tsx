// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import App from '../App'
import { SAMPLE_ZH } from '../data/samples'

async function waitFor(predicate: () => boolean, timeoutMs = 3000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

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
    await waitFor(() => Boolean(container.querySelector('#results')))

    // Report surface: score ring, metrics, sentence annotations, rubric tab
    expect(container.querySelector('.score-number strong')?.textContent).toMatch(/^\d+$/)
    expect(container.querySelectorAll('.metric-card').length).toBe(5)
    expect(container.querySelectorAll('.sentence-row').length).toBeGreaterThanOrEqual(10)
    expect(container.textContent).toContain('AI 写作特征指数')
    expect(container.textContent).toContain('不是 AI 生成概率')

    // Switch to the revision tab
    const revisionTab = [...container.querySelectorAll('.diagnosis-tabs button')].find((button) => button.textContent?.includes('修改路线'))
    await act(async () => { revisionTab!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(container.textContent).toContain('REVISION, NOT EVASION')

    await act(async () => { root!.unmount() })
    root = null
    container.remove()
  })
})
