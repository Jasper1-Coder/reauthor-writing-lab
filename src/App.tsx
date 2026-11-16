import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowRight, Check, FileLock2, Github, Menu, X } from 'lucide-react'
import { Analyzer } from './components/Analyzer'
import { Methodology } from './components/Methodology'
import { Results } from './components/Results'
import type { AnalysisReport } from './lib/types'

export default function App() {
  const [report, setReport] = useState<AnalysisReport | null>(null)
  const [toast, setToast] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const toastTimer = useRef<number | undefined>(undefined)

  const showToast = (message: string) => {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 3400)
  }

  useEffect(() => {
    if (!report) return
    const timer = window.setTimeout(() => {
      document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
          <a href="#analyzer" onClick={() => setMenuOpen(false)}>检测台</a>
          <a href="#methodology" onClick={() => setMenuOpen(false)}>评分方法</a>
          <a href="#manifesto" onClick={() => setMenuOpen(false)}>学生宣言</a>
          <a className="nav-github" href="https://github.com/Jasper1-Coder/reauthor-writing-lab" target="_blank" rel="noreferrer"><Github size={16} /> GitHub</a>
          <button className="nav-close" type="button" aria-label="关闭菜单" onClick={() => setMenuOpen(false)}><X size={20} /></button>
        </nav>
        <button className="menu-button" type="button" aria-label="打开菜单" onClick={() => setMenuOpen(true)}><Menu size={22} /></button>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="hero-kicker">STUDENT-OWNED WRITING FORENSICS · BY STUDENTS, FOR STUDENTS</p>
            <h1>你的文字，<br />不该只剩一个<br /><em>AI 百分比。</em></h1>
            <p className="hero-lead">ReAuthor 是给中文和英文写作者的诊断台：像编辑一样逐句批注，把「为什么可疑」「证据在哪」「怎么改」摊开在桌面上。检测不是终审，解释才是起点。</p>
            <div className="hero-actions">
              <a className="primary-button" href="#analyzer">开始分析我的原稿 <ArrowRight size={18} /></a>
              <a className="ghost-link" href="#methodology">先看判分依据 <ArrowDown size={16} /></a>
            </div>
            <ul className="hero-claims">
              <li><Check size={16} /> 逐句证据 + 修改方向</li>
              <li><Check size={16} /> 透明加权公式</li>
              <li><Check size={16} /> 样本不足就拒判</li>
              <li><Check size={16} /> 原稿不上传服务器</li>
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

        <Analyzer onAnalyzed={setReport} onToast={showToast} />
        {report && <Results report={report} onToast={showToast} />}
        <Methodology />
      </main>

      <footer className="site-footer">
        <div className="footer-brand">
          <span className="brand-symbol">R<span>e</span></span>
          <p><strong>ReAuthor · 重写权</strong><br />学生自己的 AI 写作特征诊断台。多通道交叉验证 + 公开校准数据，开源、可复核、不上传文本。</p>
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
