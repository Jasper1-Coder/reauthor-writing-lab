import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowRight, Check, FileLock2, Github, Menu, X } from 'lucide-react'
import { Analyzer } from './components/Analyzer'
import { Methodology } from './components/Methodology'
import { Results } from './components/Results'
import type { AnalysisReport } from './lib/types'

export default function App() {
  const [report, setReport] = useState<AnalysisReport | null>(null)
  // 保留上一份报告（改前），供"改后全文回填重测"后做整篇前后对比。
  const [previousReport, setPreviousReport] = useState<AnalysisReport | null>(null)
  const [toast, setToast] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [incomingText, setIncomingText] = useState<{ text: string; nonce: number } | undefined>(undefined)
  const toastTimer = useRef<number | undefined>(undefined)

  const showToast = (message: string) => {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 3400)
  }

  useEffect(() => {
    if (!report) return
    const timer = window.setTimeout(() => {
      const resultsEl = document.getElementById('results')
      // jsdom / 部分 WebView 未实现 scrollIntoView；缺失时静默跳过，避免未捕获异常打断测试或页面
      if (resultsEl && typeof resultsEl.scrollIntoView === 'function') {
        resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }, 80)
    // 组件卸载或报告刷新时清除定时器，避免卸载后访问已销毁的 document。
    return () => window.clearTimeout(timer)
  }, [report])

  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  return (
    <div className="app-shell" id="top">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="ReAuthor 首页">
          <span className="brand-symbol">R<span>e</span></span>
          <span><strong>ReAuthor</strong><small>重写权 · 学生写作诊断台</small></span>
        </a>
        <nav className={menuOpen ? 'open' : ''} aria-label="主导航">
          <a href="#analyzer" onClick={() => setMenuOpen(false)}>开始诊断</a>
          <a href="#methodology" onClick={() => setMenuOpen(false)}>原理说明（选读）</a>
          <a href="#manifesto" onClick={() => setMenuOpen(false)}>我们的立场</a>
          <a className="nav-github" href="https://github.com/Jasper1-Coder/reauthor-writing-lab" target="_blank" rel="noreferrer"><Github size={16} /> GitHub</a>
          <button className="nav-close" type="button" aria-label="关闭菜单" onClick={() => setMenuOpen(false)}><X size={20} /></button>
        </nav>
        <button className="menu-button" type="button" aria-label="打开菜单" onClick={() => setMenuOpen(true)}><Menu size={22} /></button>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="hero-kicker">被 AI 检测判了？先把话说清楚</p>
            <h1>被判「AI 写的」？<br />先别认，<br /><em>把话说明白。</em></h1>
            <p className="hero-lead">逐句看清：它为什么觉得可疑、证据在哪、你怎么把它改回自己的文字。检测不是判决，解释权和改写权都在你手里。</p>
            <div className="hero-actions">
              <a className="primary-button" href="#analyzer">贴进来，看看它凭什么判你 <ArrowRight size={18} /></a>
              <a className="ghost-link" href="#analyzer">先试一份样例 <ArrowDown size={16} /></a>
            </div>
            <ul className="hero-claims">
              <li><Check size={16} /> 每句都能点开看依据</li>
              <li><Check size={16} /> 自己动手改，改完立刻看变化</li>
              <li><Check size={16} /> 原稿不离开你的电脑</li>
            </ul>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <div className="annotated-paper">
              <span className="paper-line-1">在当今社会，AI 产生深远的影响。</span>
              <span className="margin-note note-orange">套话 → 具体到谁、何时、什么变化</span>
              <span className="paper-line-2">But my two sources could not be found.</span>
              <span className="margin-note note-green">具体证据 · 保留并展开</span>
              <span className="paper-line-3">它不仅提高了效率，而且优化了体验。</span>
              <span className="margin-note note-yellow">空泛 → 补数据 / 案例 / 验证方式</span>
            </div>
            <div className="privacy-chip"><FileLock2 size={16} /> 原稿只在你的浏览器里被读取</div>
          </div>
        </section>

        <Analyzer
          onAnalyzed={(next) => { setPreviousReport(report); setReport(next) }}
          onToast={showToast}
          incomingText={incomingText}
        />
        {report && (
          <Results
            report={report}
            previousReport={previousReport}
            onToast={showToast}
            onUseFullText={(text) => { setPreviousReport(report); setIncomingText({ text, nonce: Date.now() }) }}
          />
        )}
        <Methodology />
      </main>

      <footer className="site-footer">
        <div className="footer-brand">
          <span className="brand-symbol">R<span>e</span></span>
          <p><strong>ReAuthor · 重写权</strong><br />把「像不像 AI」的判决，拆成你看得懂的证据，再把修改权还给你。逐句讲理由、自己动手改、原稿不上传。</p>
        </div>
        <div className="footer-links">
          <a href="https://github.com/Jasper1-Coder/reauthor-writing-lab" target="_blank" rel="noreferrer"><Github size={17} /> 源码与评分常量</a>
          <a href="#methodology">方法论</a>
          <a href="#manifesto">立场</a>
        </div>
        <p className="footer-note">本工具不提供学术不端判定。教师、期刊与学生应结合过程材料与对话使用检测结果。</p>
      </footer>

      {toast && <div className="toast" role="status" aria-live="polite"><Check size={16} /> {toast}</div>}
    </div>
  )
}
