import { useEffect, useState } from 'react'
import { Brain, ChevronDown, Info, LoaderCircle, TriangleAlert } from 'lucide-react'
import {
  LM_MODEL_LABEL,
  LM_REFERENCE,
  LM_REFERENCE_MODERN,
  runLmChannel,
  type LmChannelResult,
} from '../lib/lmChannel'

interface LmChannelCardProps {
  text: string
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; result: LmChannelResult }
  | { status: 'unavailable' }

/**
 * 语言模型通道卡片。
 *
 * 这是本项目唯一「真训练出来的模型」的展示位，因此必须同时展示：
 * 读数、它到底在量什么、以及它什么时候会失效（跨域 0.473）。
 * 不给这三个，等于又造了一个黑箱百分比，违背项目立意。
 */
export function LmChannelCard({ text }: LmChannelCardProps) {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    ;(async () => {
      // 两种 AI 方言（2023 ChatGPT / 2025–26 现代模型）各自加载、各自打分，取较高者
      const result = await runLmChannel(text)
      if (!alive) return
      setState(result ? { status: 'ready', result } : { status: 'unavailable' })
    })()
    return () => { alive = false }
  }, [text])

  if (state.status === 'loading') {
    return (
      <section className="lm-card lm-card-loading" aria-live="polite">
        <LoaderCircle size={18} className="lm-spin" />
        <p>正在加载两种方言的语言模型…（首次约 {(LM_REFERENCE.sizeMB + LM_REFERENCE_MODERN.sizeMB).toFixed(1)}MB，预压缩 {LM_REFERENCE.gzKB + LM_REFERENCE_MODERN.gzKB}KB，之后走浏览器缓存；全部在本机计算，文本不上传）</p>
      </section>
    )
  }

  if (state.status === 'unavailable') {
    return (
      <section className="lm-card lm-card-failed" role="status">
        <TriangleAlert size={18} />
        <p>语言模型通道未加载成功（可能网络中断）。其余证据与逐句批注不受影响，可以继续使用。</p>
      </section>
    )
  }

  const r = state.result
  const crossAuc = LM_REFERENCE.crossDomainAuc
  const band = r.score >= 67 ? 'high' : r.score >= 34 ? 'mid' : 'low'
  const bandLabel = r.score >= 67 ? '接近训练语料中的 AI 文风' : r.score >= 34 ? '处于中间地带' : '更接近训练语料中的真人写法'

  return (
    <section className="lm-card" aria-labelledby="lm-title">
      <header className="lm-head">
        <div className="lm-head-title">
          <Brain size={20} />
          <div>
            <h3 id="lm-title">语言模型读数</h3>
            <p>{LM_MODEL_LABEL}</p>
          </div>
        </div>
        <span className="lm-badge">本项目自训模型</span>
      </header>

      <div className="lm-body">
        <div className={`lm-score lm-score-${band}`}>
          <strong>{r.score}</strong>
          <span>/ 100</span>
          <em>{bandLabel}</em>
        </div>

        <div className="lm-explain">
          <p>
            原理很直白：我们训练了两个「文字接龙」模型，一个只读真人写的东西，一个只读 AI 写的东西。
            然后把你的文本分别喂给它们，看哪一个更容易预测出下一字。
          </p>
          <div className="lm-probs">
            <div>
              <span>真人写作模型下的平均预测难度</span>
              <strong>{(-r.humanLogp).toFixed(2)} bit/字</strong>
            </div>
            <div>
              <span>AI 文风模型下的平均预测难度</span>
              <strong>{(-r.aiLogp).toFixed(2)} bit/字</strong>
            </div>
            <div className="lm-probs-note">
              {r.delta >= 0
                ? `AI 模型比真人模型更容易预测这段文字（差值 ${r.delta.toFixed(3)}），所以读数偏高。`
                : `真人模型比 AI 模型更容易预测这段文字（差值 ${r.delta.toFixed(3)}），所以读数偏低。`}
            </div>
          </div>
        </div>
      </div>

      {r.sentences.length > 0 && (
        <div className="lm-sentences">
          <h4>单句读数最高的几句（供你对照检查，不是定罪）</h4>
          <ol>
            {r.sentences.slice(0, 4).map((s, i) => (
              <li key={`${i}-${s.text.slice(0, 12)}`}>
                <span className={`lm-sent-score lm-sent-${s.score >= 67 ? 'high' : s.score >= 34 ? 'mid' : 'low'}`}>{s.score}</span>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {r.dialects && (
        <div className="lm-dialects">
          <div className={r.closestDialect === 'chatgpt2023' ? 'lm-dialect active' : 'lm-dialect'}>
            <span>像 2023 年 ChatGPT</span>
            <strong>{r.dialects.chatgpt2023 !== null ? r.dialects.chatgpt2023 : '—'}</strong>
            <em>AUC {LM_REFERENCE.holdoutAuc.toFixed(3)}</em>
          </div>
          <div className={r.closestDialect === 'modern' ? 'lm-dialect active' : 'lm-dialect'}>
            <span>像 2025–26 现代模型</span>
            <strong>{r.dialects.modern !== null ? r.dialects.modern : '—'}</strong>
            <em>AUC {LM_REFERENCE_MODERN.holdoutAuc.toFixed(3)}</em>
          </div>
          <p className="lm-dialects-note">
            两种方言各训一个模型，<strong>取较接近的那个</strong>作为本通道读数——因为 2026 年的「AI 文风」已经是两种写法。
          </p>
        </div>
      )}

      <div className="lm-metrics">
        <div><span>域内留出集 AUC</span><strong>{LM_REFERENCE.holdoutAuc.toFixed(3)}</strong><em>{LM_REFERENCE.holdoutN.toLocaleString()} 篇</em></div>
        <div><span>5 折交叉验证</span><strong>{LM_REFERENCE.cvAuc.toFixed(3)} ± {LM_REFERENCE.cvAucStd.toFixed(3)}</strong><em>同组不跨集</em></div>
        <div className="lm-metric-warn"><span>学术论文跨域 AUC</span><strong>{crossAuc !== null ? crossAuc.toFixed(3) : '—'}</strong><em>失效（n={LM_REFERENCE.crossDomainN}）</em></div>
        <div><span>现代模型召回（阈值 50）</span><strong>{LM_REFERENCE_MODERN.recall50 !== null ? `${(LM_REFERENCE_MODERN.recall50 * 100).toFixed(1)}%` : '—'}</strong><em>2025–26 模型写的文本被读到 ≥50 的比例</em></div>
        <div className="lm-metric-warn"><span>阈值 50 特异度</span><strong>{(LM_REFERENCE.specificity * 100).toFixed(1)}%</strong><em>真人被误判高的比例</em></div>
        {LM_REFERENCE.formatBaseline && (
          <div className="lm-metric-warn">
            <span>模型 vs「只看长度」</span>
            <strong>{LM_REFERENCE.formatBaseline.modelAuc.toFixed(3)} / {LM_REFERENCE.formatBaseline.lengthAuc.toFixed(3)}</strong>
            <em>{LM_REFERENCE.formatBaseline.domain} 域跑不过长度基线</em>
          </div>
        )}
      </div>

      <details className="lm-caveats">
        <summary>
          <Info size={15} />
          <span>这个读数什么时候不能用？（建议先读这 30 秒）</span>
          <ChevronDown size={15} className="tech-chevron" />
        </summary>
        <ul>
          {LM_REFERENCE.caveats.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </details>
    </section>
  )
}
