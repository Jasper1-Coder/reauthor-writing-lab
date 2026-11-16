import { useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowDownToLine,
  Check,
  ChevronDown,
  Clipboard,
  FileCheck2,
  Flag,
  FlaskConical,
  Info,
  Lightbulb,
  ListFilter,
  LoaderCircle,
  Printer,
  Quote,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { buildMarkdownReport, downloadMarkdown, getRevisionPlan } from '../lib/report'
import { evaluateSpread } from '../lib/crosscheck'
import { PROBABILITY_FORMULA, PROBABILITY_MODEL_LABEL, runProbabilityChannel } from '../lib/probability'
import calibrationData from '../data/calibration.json'
import type { AnalysisReport, ProbabilityChannelResult, SentenceAnalysis } from '../lib/types'

interface ResultsProps {
  report: AnalysisReport
  onToast: (message: string) => void
}

type Tab = 'sentences' | 'revision' | 'rubric'
type Filter = 'all' | 'attention' | 'low'

const languageNames = { zh: '中文', en: 'English', mixed: '中英混合' }
const documentNames = { academic: '学术论文', coursework: '课程作业', essay: '议论文 / 文书', general: '通用文本' }

function summaryFor(report: AnalysisReport) {
  if (!report.isSampleSufficient) return '当前只能观察表层特征。请增加完整段落后重新分析，不对作者身份作任何推断。'
  if (report.score < 30) return '较少模板化堆叠，具体证据与个人分析较清晰。无需为了“降分”改写自然的表达。'
  if (report.score < 55) return '文本同时出现个人论证与模板表达。优先修改高分句，不必重写整篇文章。'
  if (report.score < 75) return '模板衔接与抽象评价较集中。建议先补证据，再调整句式，而不是只做同义词替换。'
  return '表层模板特征高度集中，但仍不能推断作者。建议回到论点与证据，重建自己的论证链。'
}

function SentenceRow({ sentence, expanded, onToggle }: { sentence: SentenceAnalysis; expanded: boolean; onToggle: () => void }) {
  return (
    <article className={`sentence-row level-${sentence.level}`}>
      <button className="sentence-trigger" type="button" onClick={onToggle} aria-expanded={expanded}>
        <span className="sentence-number">{String(sentence.id).padStart(2, '0')}</span>
        <span className="sentence-copy">{sentence.text}</span>
        <span className={`sentence-score score-${sentence.level}`}>{sentence.score}</span>
        <ChevronDown className={expanded ? 'rotated' : ''} size={18} />
      </button>
      {expanded && (
        <div className="annotation-panel">
          <div className="annotation-column">
            <h4><Flag size={15} /> 判分依据</h4>
            <ul>{sentence.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          </div>
          <div className="annotation-column suggestion-column">
            <h4><Lightbulb size={15} /> 修改方向</h4>
            {sentence.suggestions.length ? (
              <ul>{sentence.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul>
            ) : <p>无需为了降低分数强行改写。优先核查事实、论证与引用。</p>}
          </div>
          {sentence.strengths.length > 0 && (
            <div className="strength-note"><Check size={15} /><span>{sentence.strengths.join('；')}</span></div>
          )}
        </div>
      )}
    </article>
  )
}

export function Results({ report, onToast }: ResultsProps) {
  const [tab, setTab] = useState<Tab>('sentences')
  const [filter, setFilter] = useState<Filter>('all')
  const [prob, setProb] = useState<ProbabilityChannelResult>({ status: 'idle', message: '' })
  const [expandedId, setExpandedId] = useState<number | null>(report.sentenceAnalyses.find((sentence) => sentence.level === 'priority')?.id ?? 1)
  const revisionPlan = getRevisionPlan(report)
  const circumference = 2 * Math.PI * 76
  const flaggedCount = report.sentenceAnalyses.filter((sentence) => sentence.level !== 'low').length
  const visibleSentences = report.sentenceAnalyses.filter((sentence) => {
    if (filter === 'attention') return sentence.level !== 'low'
    if (filter === 'low') return sentence.level === 'low'
    return true
  })
  const phraseHits = useMemo(() => {
    const hits = report.sentenceAnalyses.flatMap((sentence) => sentence.patternHits)
    const unique = new Map<string, { phrase: string; label: string; suggestion: string; count: number }>()
    hits.forEach((hit) => {
      const key = `${hit.phrase}-${hit.label}`
      unique.set(key, { ...hit, count: (unique.get(key)?.count ?? 0) + 1 })
    })
    return [...unique.values()].slice(0, 10)
  }, [report])

  const crossCheck = useMemo(() => {
    const base = report.crossValidation
    if (prob.status !== 'done' || typeof prob.score !== 'number') return base
    const detectors = [
      ...base.detectors,
      {
        id: 'probability' as const,
        name: '神经通道（实验）',
        englishName: 'Neural (beta)',
        family: '浏览器本地 token 概率：困惑度 + 突发度，Qwen2.5-0.5B 量化版',
        score: prob.score,
        detail: prob.message,
      },
    ]
    const spread = evaluateSpread(detectors.map((detector) => detector.score))
    return {
      ...base,
      detectors,
      ...spread,
      note:
        spread.verdict === 'aligned'
          ? '所有通道（含神经通道）读数接近，但请注意：本校准显示表层规则通道在真实数据上接近随机，神经通道为实验性未校准。结论请以逐句证据为准。'
          : spread.verdict === 'mixed'
            ? '加入神经通道后分歧扩大。这正说明"AI 率"没有唯一真值——请对比逐句证据，而不是挑一个你喜欢的数字。'
            : '通道严重分歧。任何检测网站此时给出的精确百分比（包括本站）都不应被引用。',
    }
  }, [report, prob])

  const launchProbability = async () => {
    if (prob.status === 'loading' || prob.status === 'running') return
    const result = await runProbabilityChannel(report.originalText, (update) => setProb(update))
    setProb(result)
  }

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(buildMarkdownReport(report))
      onToast('完整 Markdown 报告已复制，可粘贴到笔记或文档')
    } catch {
      onToast('浏览器未允许剪贴板访问，请改用“下载报告”')
    }
  }

  return (
    <section className="results-shell" id="results" aria-labelledby="results-title">
      <div className="section-index light-index">
        <span>02</span>
        <p>不是判决，是一份可复核的编辑意见</p>
      </div>
      <div className="results-heading">
        <div>
          <p className="eyebrow">EVIDENCE BEFORE VERDICT</p>
          <h2 id="results-title">你的写作诊断报告</h2>
        </div>
        <div className="report-actions">
          <button type="button" onClick={copyReport}><Clipboard size={16} /> 复制报告</button>
          <button type="button" onClick={() => window.print()}><Printer size={16} /> 打印</button>
          <button className="export-button" type="button" onClick={() => { downloadMarkdown(report); onToast('诊断报告已下载为 Markdown 文件') }}><ArrowDownToLine size={16} /> 下载报告</button>
        </div>
      </div>

      <div className="score-overview">
        <div className="score-main">
          <div className={`score-ring ring-${report.level}`}>
            <svg viewBox="0 0 180 180" role="img" aria-label={`AI 写作特征指数 ${report.score} 分`}>
              <circle className="ring-track" cx="90" cy="90" r="76" />
              <circle
                className="ring-value"
                cx="90"
                cy="90"
                r="76"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - report.score / 100)}
              />
            </svg>
            <div className="score-number"><strong>{report.score}</strong><span>/ 100</span></div>
          </div>
          <div className="score-interpretation">
            <span className={`level-pill pill-${report.level}`}>{report.levelLabel}</span>
            <h3>AI 写作特征指数</h3>
            <p>{summaryFor(report)}</p>
            <div className="not-probability"><Info size={15} /> 不是 AI 生成概率，不用于判定学术不端</div>
          </div>
        </div>
        <div className="report-meta">
          <div><span>语言</span><strong>{languageNames[report.language]}</strong></div>
          <div><span>文本类型</span><strong>{documentNames[report.documentType]}</strong></div>
          <div><span>分析规模</span><strong>{report.stats.sentences} 句 · {report.stats.characters} 字符</strong></div>
          <div><span>待复核句</span><strong>{flaggedCount} / {report.stats.sentences}</strong></div>
          <div className="evidence-meter">
            <span>证据充分度 <strong>{report.evidenceSufficiency}/100 · {report.evidenceLabel}</strong></span>
            <div><i style={{ width: `${report.evidenceSufficiency}%` }} /></div>
          </div>
        </div>
      </div>

      {!report.isSampleSufficient && (
        <div className="insufficient-banner" role="alert">
          <AlertCircle size={21} />
          <div><strong>样本不足，系统已撤回风险定性</strong><p>建议中文达到 400 字、英文达到 180 词，并至少有 6 句。当前分数只用于查看规则如何工作。</p></div>
        </div>
      )}

      <div className="calibration-strip" role="note">
        <FlaskConical size={19} />
        <p>
          <strong>自我校准披露：</strong>在 HC3 中文数据集（{calibrationData.dataset.sampleCount} 篇真人 / AI 问答）上，本引擎区分真人与 AI 的
          AUC 仅为 <strong>{calibrationData.results.rocAuc}</strong>——接近随机。所以我们称它为"写作特征反馈工具"，<strong>不是检测器</strong>。
          完整混淆数据见下方方法页。商业检测器敢公布自己的这个数字吗？
        </p>
      </div>

      <div className="metrics-grid">
        {report.metrics.map((metric, index) => (
          <article className="metric-card" key={metric.id}>
            <div className="metric-top"><span>0{index + 1}</span><strong>{Math.round(metric.weight * 100)}% 权重</strong></div>
            <h3>{metric.label}</h3>
            <p className="metric-english">{metric.englishLabel}</p>
            <div className="metric-score"><strong>{metric.score}</strong><span>/100</span></div>
            <div className="metric-bar"><i style={{ width: `${metric.score}%` }} /></div>
            <p>{metric.description}</p>
            <div className="metric-evidence"><FileCheck2 size={14} /> {metric.evidence}</div>
          </article>
        ))}
      </div>

      <div className="crosscheck-panel">
        <div className="crosscheck-heading">
          <span className="eyebrow">CROSS-CHECK · 交叉验证</span>
          <h3>同一篇文本，{crossCheck.detectors.length} 条相互独立的证据链。</h3>
          <p>
            每个通道只依赖一类特征，互不共享计算。读数一致，结论才相对可靠；读数分歧，说明"AI 率"没有唯一真值——
            Pangram 给你的 100 分、别的网站给你的 87 分、以及本站的分数，都应放进这个框架里怀疑。
          </p>
        </div>
        <div className="crosscheck-grid">
          {crossCheck.detectors.map((detector) => (
            <article className="crosscheck-card" key={detector.id}>
              <div className="crosscheck-score"><strong>{detector.score}</strong><span>/100</span></div>
              <h4>{detector.name}</h4>
              <p className="crosscheck-en">{detector.englishName}</p>
              <div className="crosscheck-bar"><i style={{ width: `${detector.score}%` }} /></div>
              <p className="crosscheck-family">{detector.family}</p>
              <p className="crosscheck-detail">{detector.detail}</p>
            </article>
          ))}
          <article className="crosscheck-card neural-card">
            <div className="crosscheck-score">
              {prob.status === 'done' && typeof prob.score === 'number'
                ? <><strong>{prob.score}</strong><span>/100</span></>
                : <strong className="neural-na">—</strong>}
            </div>
            <h4>神经通道（实验）</h4>
            <p className="crosscheck-en">Neural · token 概率</p>
            {prob.status === 'done' && <div className="crosscheck-bar"><i style={{ width: `${prob.score}%` }} /></div>}
            {prob.status === 'idle' && (
              <div className="neural-launch">
                <p>{PROBABILITY_MODEL_LABEL}</p>
                <button type="button" className="neural-button" onClick={launchProbability}>
                  <Sparkles size={15} /> 启动本地模型分析
                </button>
                <small>下载约 350 MB（国内镜像），之后浏览器缓存；全程本地推理，文本不上传。</small>
              </div>
            )}
            {(prob.status === 'loading' || prob.status === 'running') && (
              <div className="neural-launch">
                <p className="neural-progress"><LoaderCircle size={15} className="spin" /> {prob.message}</p>
              </div>
            )}
            {prob.status === 'error' && (
              <div className="neural-launch">
                <p className="neural-error"><AlertCircle size={15} /> {prob.message}</p>
                <small>{prob.error}</small>
                <button type="button" className="neural-button" onClick={launchProbability}>重试</button>
              </div>
            )}
            {prob.status === 'done' && <p className="crosscheck-family">困惑度 {prob.perplexity}，突发度 {prob.burstiness}（{prob.tokens} tokens）</p>}
            {prob.status === 'done' && <p className="crosscheck-detail">换算公式公开：{PROBABILITY_FORMULA}</p>}
          </article>
        </div>
        <div className={`crosscheck-verdict verdict-${crossCheck.verdict}`}>
          <div className="spread-visual">
            <span className="spread-label">通道分歧度（最大 − 最小）</span>
            <div className="spread-track">
              <i style={{ width: `${Math.min(100, crossCheck.spread)}%` }} />
              <em className="spread-marker" style={{ left: '25%' }} data-label="一致≤25" />
              <em className="spread-marker" style={{ left: '45%' }} data-label="分歧≤45" />
            </div>
            <strong className="spread-value">{crossCheck.spread}</strong>
          </div>
          <div className="verdict-text">
            <strong>{crossCheck.verdictLabel}</strong>
            <p>{crossCheck.note}</p>
          </div>
        </div>
      </div>

      <div className="diagnosis-workspace">
        <div className="diagnosis-tabs" role="tablist" aria-label="诊断报告视图">
          <button role="tab" aria-selected={tab === 'sentences'} className={tab === 'sentences' ? 'active' : ''} onClick={() => setTab('sentences')}>逐句批注 <span>{report.stats.sentences}</span></button>
          <button role="tab" aria-selected={tab === 'revision'} className={tab === 'revision' ? 'active' : ''} onClick={() => setTab('revision')}>修改路线 <span>03</span></button>
          <button role="tab" aria-selected={tab === 'rubric'} className={tab === 'rubric' ? 'active' : ''} onClick={() => setTab('rubric')}>判分依据 <span>?</span></button>
        </div>

        {tab === 'sentences' && (
          <div className="sentences-panel" role="tabpanel">
            <div className="filter-bar">
              <span><ListFilter size={15} /> 筛选批注</span>
              <div>
                <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>全部 {report.stats.sentences}</button>
                <button className={filter === 'attention' ? 'active' : ''} onClick={() => setFilter('attention')}>需复核 {flaggedCount}</button>
                <button className={filter === 'low' ? 'active' : ''} onClick={() => setFilter('low')}>低特征 {report.stats.sentences - flaggedCount}</button>
              </div>
              <p>点击句子展开证据与建议</p>
            </div>
            <div className="sentence-list">
              {visibleSentences.map((sentence) => (
                <SentenceRow key={sentence.id} sentence={sentence} expanded={expandedId === sentence.id} onToggle={() => setExpandedId(expandedId === sentence.id ? null : sentence.id)} />
              ))}
            </div>
          </div>
        )}

        {tab === 'revision' && (
          <div className="revision-panel" role="tabpanel">
            <div className="revision-intro"><span>REVISION, NOT EVASION</span><h3>目标不是骗过检测器，<br />是让论证真正变成你的。</h3><p>按“分数贡献 × 可修改性”排序。不要机械替换同义词，那只会把文章变成另一种模板。</p></div>
            <div className="revision-steps">
              {revisionPlan.map((item) => (
                <article key={item.metric.id}>
                  <span className="priority-number">0{item.priority}</span>
                  <div><p className="revision-kicker">优先处理 · {item.metric.label} {item.metric.score}/100</p><h4>{item.title}</h4><p>{item.action}</p><small>{item.detail}</small></div>
                </article>
              ))}
            </div>
            <div className="phrase-table-wrap">
              <h4><Quote size={17} /> 本文实际命中的用词与句式</h4>
              {phraseHits.length ? (
                <div className="phrase-table">
                  {phraseHits.map((hit) => <div className="phrase-row" key={`${hit.phrase}-${hit.label}`}><span className="phrase">“{hit.phrase}” <small>×{hit.count}</small></span><span>{hit.label}</span><p>{hit.suggestion}</p></div>)}
                </div>
              ) : <p className="empty-note">没有命中预设套话。这不证明作者身份，只说明本文未触发当前词表。</p>}
            </div>
          </div>
        )}

        {tab === 'rubric' && (
          <div className="rubric-panel" role="tabpanel">
            <div className="formula-card">
              <span>TRANSPARENT FORMULA</span>
              <h3>每一分都能被重算。</h3>
              <code>总分 = 节奏 × 20% + 套话 × 25% + 重复 × 20% + 抽象 × 20% + 证据稀缺 × 15%</code>
              <p>所有指标先归一化到 0–100，再加权求和。当前规则常量公开在源码 <strong>src/lib/analyzer.ts</strong>，没有隐藏的“AI 黑箱分”。</p>
            </div>
            <div className="threshold-card">
              <h3>结果如何分级</h3>
              <div><span>0–29</span><p>较少模板化特征</p></div>
              <div><span>30–54</span><p>人机特征可能并存</p></div>
              <div><span>55–74</span><p>模板化特征较集中</p></div>
              <div><span>75–100</span><p>高度集中的模板化特征</p></div>
              <p><AlertCircle size={15} /> 样本不足时不进入以上任何等级。</p>
            </div>
            <div className="limitations-card">
              <h3><ShieldCheck size={19} /> 三条不可越过的边界</h3>
              <ol>{report.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ol>
              <p>引擎版本：{report.version} · 生成时间：{new Date(report.createdAt).toLocaleString('zh-CN')}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
