import { useEffect, useState } from 'react'
import {
  ArrowDownToLine,
  Clipboard,
  ExternalLink,
  Gavel,
  Plus,
  Printer,
  ShieldQuestion,
  Trash2,
} from 'lucide-react'
import { DEFENSE_EVIDENCE, evaluateDisagreement } from '../data/defenseEvidence'
import { buildDefenseDocument, type PlatformRecord } from '../lib/defense'
import { downloadText } from '../lib/report'
import type { AnalysisReport } from '../lib/types'

interface DefenseKitProps {
  report: AnalysisReport
  onToast: (message: string) => void
}

const STORAGE_KEY = 'reauthor-defense-records'

function loadRecords(): PlatformRecord[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PlatformRecord[]
    return Array.isArray(parsed) ? parsed.filter((r) => typeof r.platform === 'string' && typeof r.score === 'number') : []
  } catch {
    return []
  }
}

export function DefenseKit({ report, onToast }: DefenseKitProps) {
  const [records, setRecords] = useState<PlatformRecord[]>(loadRecords)
  const [platform, setPlatform] = useState('')
  const [score, setScore] = useState('')
  const [date, setDate] = useState('')
  const [showProcessForm, setShowProcessForm] = useState(false)
  const [timeline, setTimeline] = useState('')
  const [evidenceNotes, setEvidenceNotes] = useState('')
  const [aiUsage, setAiUsage] = useState('')

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  }, [records])

  const verdict = evaluateDisagreement(records.map((record) => record.score))

  const addRecord = () => {
    const trimmed = platform.trim()
    const value = Number(score)
    if (!trimmed || Number.isNaN(value) || value < 0 || value > 100) {
      onToast('请填写平台名称和 0–100 之间的检测值')
      return
    }
    setRecords((current) => [...current, { platform: trimmed, score: Math.round(value), date: date.trim() }])
    setPlatform('')
    setScore('')
    setDate('')
    onToast('已录入，可继续添加其他平台做对照')
  }

  const generateDocument = () => {
    const markdown = buildDefenseDocument(report, records, verdict, { timeline, evidenceNotes, aiUsage })
    downloadText(markdown, `reauthor-defense-kit-${new Date().toISOString().slice(0, 10)}.md`)
    onToast('申诉参考材料已下载，请先如实填写第一部分再使用')
  }

  const copyDocument = async () => {
    const markdown = buildDefenseDocument(report, records, verdict, { timeline, evidenceNotes, aiUsage })
    try {
      await navigator.clipboard.writeText(markdown)
      onToast('申诉材料已复制到剪贴板')
    } catch {
      onToast('复制失败，请改用下载或打印')
    }
  }

  return (
    <div className="defense-panel" role="tabpanel" id="panel-defense" aria-labelledby="tab-defense">
      <div className="defense-intro">
        <Gavel size={22} />
        <div>
          <h3>被别的平台判了高 AI 率？这里帮你组织质疑，不是组织作弊。</h3>
          <p>
            打分数仗你赢不了——本站自己的校准都接近随机。你能赢的是<b>质疑权</b>：公开研究证明这类检测器系统性地冤枉规整写作，
            公开报道证明各平台结论互相矛盾。下面三步，生成一份拿着证据说话的申诉参考材料。
          </p>
        </div>
      </div>

      <section className="defense-step">
        <header><span>STEP 1</span><h4>核对公开证据：这些质疑每一条都有出处</h4></header>
        <div className="defense-evidence-list">
          {DEFENSE_EVIDENCE.map((item) => (
            <article className="defense-evidence" key={item.id}>
              <div className="evidence-head">
                <strong className="evidence-stat">{item.stat}</strong>
                <span className="evidence-year">{item.year}</span>
              </div>
              <h5>{item.title}</h5>
              <p>{item.summary}</p>
              <blockquote>“{item.quote}”</blockquote>
              <div className="evidence-uses">
                <span><ShieldQuestion size={13} /> 何时用：{item.useFor}</span>
                <a href={item.sourceUrl} target="_blank" rel="noreferrer">原始出处 <ExternalLink size={12} /></a>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="defense-step">
        <header><span>STEP 2</span><h4>录入其他平台给你的检测值，自动生成分歧论证</h4></header>
        <div className="record-form">
          <input value={platform} onChange={(event) => setPlatform(event.target.value)} placeholder="平台名（如：知网 / 维普 / PaperPass）" aria-label="平台名称" />
          <input value={score} onChange={(event) => setScore(event.target.value)} placeholder="AI 率 %" inputMode="numeric" aria-label="检测百分比" />
          <input value={date} onChange={(event) => setDate(event.target.value)} placeholder="日期（可选）" aria-label="检测日期" />
          <button type="button" onClick={addRecord}><Plus size={15} /> 录入</button>
        </div>
        {records.length > 0 && (
          <div className="record-table">
            {records.map((record, index) => (
              <div className="record-row" key={`${record.platform}-${index}`}>
                <strong>{record.platform}</strong>
                <em>{record.score}%</em>
                <span>{record.date || '—'}</span>
                <button type="button" onClick={() => setRecords(records.filter((_, i) => i !== index))} aria-label={`删除 ${record.platform} 的记录`}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <div className={`record-verdict verdict-${verdict.level}`}>
              <strong>{verdict.label}</strong>
              <p>{verdict.argument}</p>
            </div>
          </div>
        )}
      </section>

      <section className="defense-step">
        <header><span>STEP 3</span><h4>生成申诉参考材料（Markdown，可编辑后提交）</h4></header>
        <p className="defense-note">
          文档包含五部分：写作过程陈述模板（<b>必须如实填写</b>）· 七条公开证据 · 平台分歧记录 · 本报告逐句解释 · 申诉请求建议。
        </p>
        <button type="button" className="defense-toggle" onClick={() => setShowProcessForm(!showProcessForm)}>
          {showProcessForm ? '收起过程材料填写' : '可选：现在就填写写作过程（也可生成后再填）'}
        </button>
        {showProcessForm && (
          <div className="process-form">
            <label>写作时间线<textarea value={timeline} onChange={(event) => setTimeline(event.target.value)} rows={3} placeholder="例：10/2 定提纲；10/15 初稿；10/28 按导师意见重写第三章……" /></label>
            <label>修改痕迹与过程证据<textarea value={evidenceNotes} onChange={(event) => setEvidenceNotes(event.target.value)} rows={3} placeholder="例：在线文档版本历史截图、文献笔记、导师沟通记录……" /></label>
            <label>AI 工具使用声明<textarea value={aiUsage} onChange={(event) => setAiUsage(event.target.value)} rows={2} placeholder="如实填写：未使用，或说明在哪些环节用了什么。" /></label>
          </div>
        )}
        <div className="defense-actions">
          <button type="button" className="defense-primary" onClick={generateDocument}><ArrowDownToLine size={15} /> 下载申诉材料</button>
          <button type="button" onClick={copyDocument}><Clipboard size={15} /> 复制内容</button>
          <button type="button" onClick={() => window.print()}><Printer size={15} /> 打印</button>
        </div>
        <p className="defense-ethics">
          红线提醒：这份材料的力量来自<b>真实</b>。用伪造的过程材料去对抗检测器，你只是在用另一种不诚实替换算法的不诚实——而且会被一次面谈戳穿。
        </p>
      </section>
    </div>
  )
}
