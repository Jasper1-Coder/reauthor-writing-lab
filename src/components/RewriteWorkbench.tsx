import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronDown,
  Clipboard,
  Info,
  PenLine,
  RotateCcw,
  Sparkles,
} from 'lucide-react'
import { makeScoringContext, scoreSentenceDraft } from '../lib/analyzer'
import {
  buildRewriteComparisonMarkdown,
  downloadText,
  type RewriteEntry,
} from '../lib/report'
import type { AnalysisReport, SentenceAnalysis } from '../lib/types'

interface RewriteWorkbenchProps {
  report: AnalysisReport
  onToast: (message: string) => void
  onUseFullText: (text: string) => void
}

interface Draft {
  text: string
  reason: string
}

const STORAGE_PREFIX = 'reauthor-rewrites-v1:'

function storageKey(report: AnalysisReport) {
  return `${STORAGE_PREFIX}${report.createdAt}`
}

function loadDrafts(report: AnalysisReport): Record<number, Draft> {
  try {
    const raw = window.localStorage.getItem(storageKey(report))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<number, Draft>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const levelName = { priority: '优先改写', review: '建议复核', low: '低特征' }

export function RewriteWorkbench({ report, onToast, onUseFullText }: RewriteWorkbenchProps) {
  const context = useMemo(() => makeScoringContext(report.originalText, report.language), [report])
  // 挑出最值得动手的句子：按原句特征值降序，最多 6 句。若全都很低也至少给 3 句作为练习。
  const targets = useMemo(() => {
    const ranked = [...report.sentenceAnalyses].sort((a, b) => b.score - a.score)
    const needy = ranked.filter((s) => s.level !== 'low')
    return (needy.length >= 3 ? needy : ranked).slice(0, 6)
  }, [report])

  const [drafts, setDrafts] = useState<Record<number, Draft>>(() => loadDrafts(report))
  const [expandedId, setExpandedId] = useState<number | null>(targets[0]?.id ?? null)

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey(report), JSON.stringify(drafts))
    } catch {
      // 隐私模式或存储配额满时静默降级，不影响改写功能
    }
  }, [drafts, report])

  const scoredDrafts = useMemo(() => {
    const map = new Map<number, SentenceAnalysis>()
    targets.forEach((sentence) => {
      const draft = drafts[sentence.id]
      if (draft?.text?.trim()) map.set(sentence.id, scoreSentenceDraft(draft.text, context))
    })
    return map
  }, [drafts, targets, context])

  const finishedCount = targets.filter((s) => drafts[s.id]?.text?.trim()).length
  const reasonFilledCount = targets.filter((s) => drafts[s.id]?.text?.trim() && drafts[s.id]?.reason?.trim()).length

  const setDraft = (id: number, patch: Partial<Draft>) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: { text: prev[id]?.text ?? '', reason: prev[id]?.reason ?? '', ...patch },
    }))
  }

  const clearDraft = (id: number) => {
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

  const buildEntries = (): RewriteEntry[] =>
    targets
      .filter((s) => drafts[s.id]?.text?.trim())
      .map((sentence) => {
        const draft = drafts[sentence.id]
        const scored = scoredDrafts.get(sentence.id)
        const cleared = sentence.patternHits
          .filter((hit) => !draft.text.includes(hit.phrase))
          .map((hit) => hit.phrase)
        return {
          sentenceId: sentence.id,
          original: sentence.text,
          draft: draft.text.trim(),
          originalScore: sentence.score,
          draftScore: scored?.score ?? sentence.score,
          reason: draft.reason.trim(),
          hitsCleared: [...new Set(cleared)],
        }
      })

  const exportComparison = () => {
    const entries = buildEntries()
    if (!entries.length) {
      onToast('先改写至少一句，才能导出对照表')
      return
    }
    if (reasonFilledCount < entries.length) {
      onToast(`还有 ${entries.length - reasonFilledCount} 句没写"我为什么这样改"，导出的是当前内容`)
    }
    downloadText(buildRewriteComparisonMarkdown(report, entries), `ReAuthor-改写过程证据-${new Date().toISOString().slice(0, 10)}.md`)
    onToast('改写对照表已导出——它记录的是你的思考过程，请如实使用')
  }

  const copyFullText = async () => {
    // 把学生改写稿替换回原文，得到一份"改后全文"，可粘回检测台重新诊断，形成闭环。
    const replacements = new Map<number, string>()
    targets.forEach((s) => {
      if (drafts[s.id]?.text?.trim()) replacements.set(s.id, drafts[s.id].text.trim())
    })
    if (!replacements.size) {
      onToast('先改写至少一句，才能生成改后全文')
      return
    }
    const rebuilt = report.sentenceAnalyses
      .map((sentence) => replacements.get(sentence.id) ?? sentence.text)
      .join('\n\n')
    try {
      await navigator.clipboard.writeText(rebuilt)
      onToast('改后全文已复制，可粘回检测台重新分析（改写会保存到本机）')
    } catch {
      onUseFullText(rebuilt)
      onToast('剪贴板不可用，改后全文已填入输入框')
    }
  }

  const resetAll = () => {
    if (!window.confirm('确定清空本报告的全部改写记录吗？此操作不可撤销。')) return
    setDrafts({})
    onToast('已清空全部改写记录')
  }

  return (
    <div className="rewrite-panel" role="tabpanel" id="panel-rewrite" aria-labelledby="tab-rewrite">
      <div className="rewrite-ethics">
        <Info size={20} />
        <div>
          <strong>这一页不是"降 AI 率"工具，是让你把想法写清楚的工作台。</strong>
          <p>
            系统不会替你改写——改写的只有你自己。每句改完，用与原报告<strong>完全相同的规则</strong>即时复测，让你亲眼看到哪些模板表达被你换掉了。
            特征值下降≠文章变好；请如实填写"为什么这样改"，这张对照表才是你能拿给老师看的<strong>过程证据</strong>。
          </p>
        </div>
      </div>

      <div className="rewrite-progress">
        <div>
          <span className="eyebrow">YOUR REVISION, YOUR EVIDENCE</span>
          <h3>把高特征句，改成你自己的话。</h3>
          <p>按特征值从高到低排列，先改最上面几句。每句改写都会即时复测。</p>
        </div>
        <div className="rewrite-progress-stats">
          <div><strong>{finishedCount}/{targets.length}</strong><span>已改写</span></div>
          <div><strong>{reasonFilledCount}/{targets.length}</strong><span>已写理由</span></div>
        </div>
      </div>

      <div className="rewrite-actions">
        <button type="button" onClick={exportComparison}><ArrowDownToLine size={16} /> 导出「改写过程证据」</button>
        <button type="button" onClick={copyFullText}><Clipboard size={16} /> 复制改后全文（可重测）</button>
        <button type="button" className="rewrite-reset" onClick={resetAll} disabled={!finishedCount}><RotateCcw size={15} /> 清空</button>
        <span className="rewrite-local"><Check size={14} /> 改写只保存在你的浏览器</span>
      </div>

      <div className="rewrite-list">
        {targets.map((sentence) => {
          const draft = drafts[sentence.id]
          const hasDraft = Boolean(draft?.text?.trim())
          const scored = scoredDrafts.get(sentence.id)
          const delta = scored ? scored.score - sentence.score : null
          const expanded = expandedId === sentence.id
          return (
            <article className={`rewrite-card${hasDraft ? ' done' : ''}`} key={sentence.id}>
              <button
                type="button"
                className="rewrite-card-head"
                aria-expanded={expanded}
                onClick={() => setExpandedId(expanded ? null : sentence.id)}
              >
                <span className="rewrite-num">{String(sentence.id).padStart(2, '0')}</span>
                <span className={`rewrite-badge badge-${sentence.level}`}>{levelName[sentence.level]}</span>
                <span className="rewrite-original-preview">{sentence.text}</span>
                <span className="rewrite-head-score">
                  {hasDraft && scored ? <><s>{sentence.score}</s> <em>{scored.score}</em></> : <em>{sentence.score}</em>}
                </span>
                <ChevronDown className={expanded ? 'rotated' : ''} size={18} />
              </button>

              {expanded && (
                <div className="rewrite-card-body">
                  <div className="rewrite-source">
                    <span className="rewrite-col-label">原句</span>
                    <p>{sentence.text}</p>
                    <div className="rewrite-why">
                      <span>为什么它被标出：</span>
                      <ul>{sentence.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                    </div>
                  </div>

                  <div className="rewrite-editor">
                    {hasDraft && (
                      <button type="button" className="rewrite-clear-one" onClick={() => clearDraft(sentence.id)}>
                        <RotateCcw size={13} /> 重置本句
                      </button>
                    )}
                    <label>
                      <span className="rewrite-col-label"><PenLine size={14} /> 我的改写</span>
                      <textarea
                        value={draft?.text ?? ''}
                        onChange={(event) => setDraft(sentence.id, { text: event.target.value })}
                        placeholder="用你自己的话重写这一句。可以补一个具体例子、数据来源，或说明你的判断依据——不要只做同义词替换。"
                        rows={3}
                      />
                    </label>
                    <label>
                      <span className="rewrite-col-label"><Sparkles size={14} /> 我为什么这样改（过程证据的关键）</span>
                      <textarea
                        value={draft?.reason ?? ''}
                        onChange={(event) => setDraft(sentence.id, { reason: event.target.value })}
                        placeholder="例如：这里我补上了课堂笔记里的原始数据，并把笼统的'效果显著'换成具体的观测结果。"
                        rows={2}
                      />
                    </label>

                    {hasDraft && scored && (
                      <div className="rewrite-result">
                        <div className="rewrite-result-head">
                          <span>即时复测（与原报告同一规则）</span>
                          <strong className={delta !== null && delta < 0 ? 'improved' : delta === 0 ? 'same' : 'worse'}>
                            {sentence.score} → {scored.score}
                            {delta !== null && <em>（{delta > 0 ? '+' : ''}{delta}）</em>}
                          </strong>
                        </div>
                        <div className="rewrite-result-notes">
                          {scored.reasons.length ? (
                            <p><strong>仍被标出的特征：</strong>{scored.reasons.join('；')}</p>
                          ) : (
                            <p className="rewrite-clean"><Check size={14} /> 这句已不再命中主要模板规则。<strong>但仍请检查事实、证据与论证是否真的更清楚。</strong></p>
                          )}
                          {delta !== null && delta >= 0 && (
                            <p className="rewrite-hint">分数没降，往往是因为只换了词、没有补证据或改变句式结构。回到"为什么它被标出"那栏逐条改。</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </div>

      <div className="rewrite-footer">
        <p><Info size={15} /> 改完后点「复制改后全文」粘回检测台重测一次——对比两次报告，就是一份完整的修订轨迹。</p>
        <button type="button" onClick={() => document.getElementById('analyzer')?.scrollIntoView({ behavior: 'smooth' })}>
          回到检测台重测 <ArrowRight size={16} />
        </button>
      </div>
    </div>
  )
}
