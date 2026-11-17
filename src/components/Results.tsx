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
import { buildMarkdownReport, downloadText, getRevisionPlan } from '../lib/report'
import { DefenseKit } from './DefenseKit'
import { RewriteWorkbench } from './RewriteWorkbench'
import { evaluateSpread } from '../lib/crosscheck'
import { RETRIEVAL_CORPUS_LABEL, RETRIEVAL_FORMULA, loadExcerpts, runRetrievalChannel } from '../lib/retrieval'
import calibrationData from '../data/calibration.json'
import { CALIBRATED_MODEL_INFO as modelInfo } from '../lib/calibrated'
import type { AnalysisReport, RetrievalChannelResult, SentenceAnalysis } from '../lib/types'

interface ResultsProps {
  report: AnalysisReport
  onToast: (message: string) => void
  onUseFullText: (text: string) => void
}

type Tab = 'sentences' | 'rewrite' | 'revision' | 'rubric' | 'defense'
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

export function Results({ report, onToast, onUseFullText }: ResultsProps) {
  const [tab, setTab] = useState<Tab>('sentences')
  const [filter, setFilter] = useState<Filter>('all')
  const [retr, setRetr] = useState<RetrievalChannelResult>({ status: 'idle', message: '' })
  const [showNeighbors, setShowNeighbors] = useState(false)
  const [excerpts, setExcerpts] = useState<string[] | null>(null)

  const toggleNeighbors = async () => {
    if (showNeighbors) { setShowNeighbors(false); return }
    setShowNeighbors(true)
    if (!excerpts) {
      try { setExcerpts(await loadExcerpts()) }
      catch { onToast('原文片段加载失败，请检查网络后重试') }
    }
  }
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
    if (retr.status !== 'done' || typeof retr.score !== 'number') return base
    const lowCoverage = typeof retr.coverage === 'number' && retr.coverage < 0.32
    const detectors = [
      ...base.detectors,
      {
        id: 'retrieval' as const,
        name: lowCoverage ? '语料检索（低覆盖）' : '语料检索通道',
        englishName: 'Corpus retrieval',
        family: lowCoverage
          ? '基座匹配度低：与问答语料差异较大，读数仅作定性参考'
          : '本地检索 6010 段真实语料的最近邻，零模型零联网',
        score: retr.score,
        detail: retr.message,
      },
    ]
    const spread = evaluateSpread(detectors.map((detector) => detector.score))
    return {
      ...base,
      detectors,
      ...spread,
      note: lowCoverage
        ? '语料检索通道显示基座匹配度偏低——很可能因为你的文本是学术/论文写作，而基座来自问答语料（该场景跨域 AUC 仅约 0.53）。请把检索读数当定性参考，不要当分数引用。'
        : spread.verdict === 'aligned'
          ? '各通道读数接近，但请注意：表层规则通道在真实数据上接近随机。结论请以逐句证据为准。'
          : spread.verdict === 'mixed'
            ? '加入检索通道后存在分歧。这正说明"AI 率"没有唯一真值——请对比逐句证据，而不是挑一个你喜欢的数字。'
            : '通道严重分歧。任何检测网站此时给出的精确百分比（包括本站）都不应被引用。',
    }
  }, [report, retr])

  const launchRetrieval = async () => {
    if (retr.status === 'loading' || retr.status === 'running') return
    setShowNeighbors(false)
    const result = await runRetrievalChannel(report.originalText, (update) => setRetr(update))
    setRetr(result)
  }

  const jumpToTab = (target: Tab) => {
    setTab(target)
    window.setTimeout(() => {
      const workspace = document.getElementById('diagnosis-workspace')
      if (workspace && typeof workspace.scrollIntoView === 'function') {
        workspace.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }, 30)
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
          <p className="eyebrow">先看结论 · 再看依据</p>
          <h2 id="results-title">你的写作诊断报告</h2>
        </div>
        <div className="report-actions">
          <button type="button" onClick={copyReport}><Clipboard size={16} /> 复制报告</button>
          <button type="button" onClick={() => window.print()}><Printer size={16} /> 打印</button>
          <button className="export-button" type="button" onClick={() => { downloadText(buildMarkdownReport(report), `ReAuthor-写作诊断-${new Date(report.createdAt).toISOString().slice(0, 10)}.md`); onToast('诊断报告已下载为 Markdown 文件') }}><ArrowDownToLine size={16} /> 下载报告</button>
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
          <div>
            <strong>样本不足，系统已撤回风险定性</strong>
            <p>
              判定标准：中文 ≥400 字或英文 ≥180 词，且 ≥6 句（中英混排时任一语言达标即可）。{report.sufficiencyHint}
              当前分数只用于查看规则如何工作。
            </p>
          </div>
        </div>
      )}

      <div className="next-step-bar">
        <div className="next-step-lead">
          <Lightbulb size={20} />
          <div>
            <strong>接下来做什么？</strong>
            <p>{flaggedCount > 0 ? `报告里有 ${flaggedCount} 句值得多看一眼。` : '这篇暂时没有需要特别留意的句子。'}挑一个入口开始就行：</p>
          </div>
        </div>
        <div className="next-step-actions">
          <button type="button" onClick={() => jumpToTab('sentences')}>逐句看：为什么被标</button>
          <button type="button" onClick={() => jumpToTab('rewrite')}>自己动手改一句</button>
          <button type="button" onClick={() => jumpToTab('defense')}>被判了，要申诉</button>
        </div>
      </div>

      <details className="tech-details">
        <summary>
          <FlaskConical size={17} />
          <span>想看分数是怎么算的？展开技术依据（校准 / 权重 / 交叉验证 / 检索）</span>
          <ChevronDown size={17} className="tech-chevron" />
        </summary>
        <div className="tech-details-body">
      <div className="calibration-strip calibrated-strip" role="note">
        <FlaskConical size={19} />
        <p>
          <strong>校准模型读数：{report.calibratedScore} / 100</strong>——这是 v0.5 在 HC3-Chinese 上以分层 5 折交叉验证训练的逻辑回归通道
          （留出折 AUC <strong>{modelInfo.cvAuc} ± {modelInfo.aucStd}</strong>，灵敏度 {Math.round(modelInfo.sensitivity * 100)}% / 特异度 {Math.round(modelInfo.specificity * 100)}%，8 个特征系数全公开）。
          上方主分数来自手调规则引擎（HC3 上 AUC {calibrationData.results.rocAuc}，接近随机，仅供参考）；<strong>校准通道才是有公开误差数据的读数</strong>。
          训练域为问答文本，学术论文场景可能偏移；两者都不构成作者身份判定。
        </p>
      </div>
      <div className="calibration-strip" role="note">
        <FlaskConical size={19} />
        <p>
          <strong>规则引擎自我校准披露：</strong>在 HC3 中文数据集（{calibrationData.dataset.sampleCount} 篇真人 / AI 问答）上，手调规则区分真人与 AI 的
          AUC 仅为 <strong>{calibrationData.results.rocAuc}</strong>——接近随机。我们保留它只是因为它的逐句解释能力，而非判别力。完整混淆数据见方法页。
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
          <article className="crosscheck-card retrieval-card">
            <div className="crosscheck-score">
              {retr.status === 'done' && typeof retr.score === 'number'
                ? <><strong>{retr.score}</strong><span>/100</span></>
                : <strong className="neural-na">—</strong>}
            </div>
            <h4>语料检索通道</h4>
            <p className="crosscheck-en">Corpus retrieval · nearest neighbors</p>
            {retr.status === 'done' && <div className="crosscheck-bar"><i style={{ width: `${retr.score}%` }} /></div>}
            {retr.status === 'idle' && (
              <div className="neural-launch">
                <p>{RETRIEVAL_CORPUS_LABEL}</p>
                <button type="button" className="neural-button" onClick={launchRetrieval}>
                  <Sparkles size={15} /> 检索真实语料基座
                </button>
                <small>首次加载约 911 KB 索引（之后浏览器缓存）；纯本地计算，零模型、零联网、文本不上传。</small>
              </div>
            )}
            {(retr.status === 'loading' || retr.status === 'running') && (
              <div className="neural-launch">
                <p className="neural-progress"><LoaderCircle size={15} className="spin" /> {retr.message}</p>
              </div>
            )}
            {retr.status === 'error' && (
              <div className="neural-launch">
                <p className="neural-error"><AlertCircle size={15} /> {retr.message}</p>
                <small>{retr.error}</small>
                <button type="button" className="neural-button" onClick={launchRetrieval}>重试</button>
              </div>
            )}
            {retr.status === 'done' && (
              <>
                <p className="crosscheck-family">
                  基座匹配度 {retr.coverage?.toFixed(2)} · 检索 {retr.corpusSize} 段真实语料
                </p>
                <p className="crosscheck-detail">{retr.message}</p>
                {retr.neighbors && retr.neighbors.length > 0 && (
                  <div className="retrieval-neighbors">
                    <button type="button" className="retrieval-toggle" onClick={toggleNeighbors} aria-expanded={showNeighbors}>
                      <ListFilter size={14} /> {showNeighbors ? '收起' : '查看'}最像的 {retr.neighbors.length} 段原文
                      <ChevronDown size={14} className={showNeighbors ? 'rotated' : ''} />
                    </button>
                    {showNeighbors && (
                      excerpts === null
                        ? <p className="retrieval-loading"><LoaderCircle size={14} className="spin" /> 正在加载原文片段（约 300 KB，仅首次）…</p>
                        : <ol className="neighbor-list">
                            {retr.neighbors.map((n, i) => (
                              <li key={n.docIndex} className={`neighbor-item neighbor-${n.label}`}>
                                <div className="neighbor-meta">
                                  <span className="neighbor-rank">#{i + 1}</span>
                                  <span className="neighbor-tag">{n.label === 1 ? 'AI 生成' : '真人撰写'}</span>
                                  <span className="neighbor-sim">相似度 {n.similarity.toFixed(3)}</span>
                                </div>
                                <p>“{excerpts[n.docIndex] ?? n.excerpt ?? ''}…”</p>
                              </li>
                            ))}
                          </ol>
                    )}
                  </div>
                )}
                <p className="retrieval-formula">口径公开：{RETRIEVAL_FORMULA}</p>
              </>
            )}
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
        </div>
      </details>

      <div className="diagnosis-workspace" id="diagnosis-workspace">
        <div className="diagnosis-tabs" role="tablist" aria-label="诊断报告视图">
          <button type="button" role="tab" id="tab-sentences" aria-controls="panel-sentences" aria-selected={tab === 'sentences'} className={tab === 'sentences' ? 'active' : ''} onClick={() => setTab('sentences')}>逐句看：为什么被标 <span>{report.stats.sentences}</span></button>
          <button type="button" role="tab" id="tab-rewrite" aria-controls="panel-rewrite" aria-selected={tab === 'rewrite'} className={tab === 'rewrite' ? 'active' : ''} onClick={() => setTab('rewrite')}>改一改：更像你的 <span>动手</span></button>
          <button type="button" role="tab" id="tab-defense" aria-controls="panel-defense" aria-selected={tab === 'defense'} className={tab === 'defense' ? 'active' : ''} onClick={() => setTab('defense')}>要申诉：给老师的说明 <span>盾</span></button>
          <button type="button" role="tab" id="tab-revision" aria-controls="panel-revision" aria-selected={tab === 'revision'} className={tab === 'revision' ? 'active' : ''} onClick={() => setTab('revision')}>修改路线 <span>03</span></button>
          <button type="button" role="tab" id="tab-rubric" aria-controls="panel-rubric" aria-selected={tab === 'rubric'} className={tab === 'rubric' ? 'active' : ''} onClick={() => setTab('rubric')}>分数怎么算的 <span>?</span></button>
        </div>

        {tab === 'sentences' && (
          <div className="sentences-panel" role="tabpanel" id="panel-sentences" aria-labelledby="tab-sentences">
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

        {tab === 'rewrite' && (
          <RewriteWorkbench report={report} onToast={onToast} onUseFullText={onUseFullText} />
        )}

        {tab === 'revision' && (
          <div className="revision-panel" role="tabpanel" id="panel-revision" aria-labelledby="tab-revision">
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
          <div className="rubric-panel" role="tabpanel" id="panel-rubric" aria-labelledby="tab-rubric">
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

        {tab === 'defense' && <DefenseKit report={report} retrieval={retr} onToast={onToast} />}
      </div>
    </section>
  )
}
