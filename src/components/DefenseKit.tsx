import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownToLine,
  Clipboard,
  Gavel,
  Plus,
  Printer,
  Trash2,
} from 'lucide-react'
import { buildAppealPacket, ONE_PAGER_LINES, type AppealPacket } from '../lib/appealPacket'
import type { PlatformRecord } from '../lib/defense'
import { buildAppealLetterMarkdown, downloadText } from '../lib/report'
import type { AnalysisReport, RetrievalChannelResult } from '../lib/types'

interface DefenseKitProps {
  report: AnalysisReport
  retrieval?: RetrievalChannelResult
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

/** 功能点 4 · 给老师的一页纸：3 条本文证据 + 2 句可念话术；降级时只显示降级说明 */
function OnePager({ packet }: { packet: AppealPacket }) {
  if (packet.degraded) {
    return (
      <section className="defense-onepager" aria-label="给老师的一页纸">
        <h3>给老师看的 3 条证据</h3>
        <p className="defense-degraded-notice">{packet.degradedNotice}</p>
      </section>
    )
  }

  const { disagreement, crossDomain, retrieval, rewrite } = packet
  const evidence1 = `本站对本文跑出 ${disagreement.channels.length} 条独立读数（${disagreement.channels.map((c) => `${c.name} ${c.score}`).join('、')}），通道分歧度为 ${disagreement.spread}。`
  const evidence2 = `本站校准模型在真实学术摘要跨域测试中，绝对分数仅 ${crossDomain.calibratedScoreMin}–${crossDomain.calibratedScoreMax}、阈值 50 灵敏度 ${Math.round(crossDomain.at50Sensitivity * 100)}%，可复现：${crossDomain.reproduceCommand}。`
  const evidence3 = retrieval.available && typeof retrieval.coverage === 'number'
    ? `检索通道覆盖率为 ${Math.round(retrieval.coverage * 100)}%，匹配度偏低，读数仅作定性参考。`
    : `改写前后对照记录 ${rewrite.hasEntries ? `${rewrite.entries.length} 句` : '尚未附上'}。`

  return (
    <section className="defense-onepager" aria-label="给老师的一页纸">
      <h3>给老师看的 3 条证据</h3>
      <ol>
        <li>{evidence1}</li>
        <li>{evidence2}</li>
        <li>{evidence3}</li>
      </ol>
      <div className="onepager-lines">
        <p>{ONE_PAGER_LINES[0]}</p>
        <p>{ONE_PAGER_LINES[1]}</p>
      </div>
    </section>
  )
}

export function DefenseKit({ report, retrieval, onToast }: DefenseKitProps) {
  const [records, setRecords] = useState<PlatformRecord[]>(loadRecords)
  const [platform, setPlatform] = useState('')
  const [score, setScore] = useState('')
  const [date, setDate] = useState('')
  const [timeline, setTimeline] = useState('')
  const [evidenceNotes, setEvidenceNotes] = useState('')
  const [aiUsage, setAiUsage] = useState('')

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  }, [records])

  // 已算好的本报告证据自动带入；学生只需补充平台信息与写作过程自述
  const packet = useMemo(
    () => buildAppealPacket(report, retrieval, {
      platform,
      score,
      platformRecords: records,
      timeline,
      evidenceNotes,
      aiUsage,
    }),
    [report, retrieval, platform, score, records, timeline, evidenceNotes, aiUsage],
  )

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
    if (packet.degraded) return
    const markdown = buildAppealLetterMarkdown(packet)
    downloadText(markdown, `reauthor-appeal-letter-${new Date().toISOString().slice(0, 10)}.md`)
    onToast('申诉信已下载，请确认写作过程自述如实填写后再提交')
  }

  const copyDocument = async () => {
    if (packet.degraded) return
    const markdown = buildAppealLetterMarkdown(packet)
    try {
      await navigator.clipboard.writeText(markdown)
      onToast('申诉信已复制到剪贴板，请确认写作过程自述如实填写后再提交')
    } catch {
      onToast('复制失败，请改用下载或打印')
    }
  }

  const crossDomain = packet.crossDomain

  return (
    <div className="defense-panel" role="tabpanel" id="panel-defense" aria-labelledby="tab-defense">
      <div className="defense-intro">
        <Gavel size={22} />
        <div>
          <h3>被判了不认？这里帮你把话说清楚。</h3>
          <p>下面会自动带出这份报告的证据，整理成一页能直接交给老师的说明。你只需补充只有你本人知道的写作过程，且务必如实填写。</p>
        </div>
      </div>

      {/* 常驻伦理红线横幅（步骤之前） */}
      <div className="defense-ethics-banner" role="note">{packet.ethicsNotice}</div>

      {/* 功能点 4 · 给老师的一页纸 */}
      <OnePager packet={packet} />

      {packet.degraded && (
        <div className="defense-degraded-banner" role="alert">
          <p><strong>{packet.degradedNotice}</strong></p>
          <p>补齐字数与句数后可生成可用的申诉信。</p>
        </div>
      )}

      <section className="defense-step">
        <header><span>STEP 1</span><h4>判决概况</h4></header>
        <p className="defense-note">以下为本报告已算好的读数，无需你填写。</p>
        <div className="site-readings">
          <span>本站写作特征指数：<strong>{packet.verdict.siteReading}</strong>（{packet.verdict.siteLevelLabel}）</span>
          <span>本站校准模型通道读数：<strong>{packet.verdict.siteCalibratedScore}</strong></span>
        </div>
        <div className="record-form">
          <input value={platform} onChange={(event) => setPlatform(event.target.value)} placeholder="被判平台名（如：知网 / 维普 / PaperPass）" aria-label="平台名称" />
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
          </div>
        )}
      </section>

      <section className="defense-step">
        <header><span>STEP 2</span><h4>多通道分歧</h4></header>
        <p className="defense-note">
          本站对本文跑出 {packet.disagreement.channels.length} 条独立读数：{packet.disagreement.channels.map((c) => `${c.name} ${c.score}`).join('、')}，通道分歧度为 {packet.disagreement.spread}。{packet.disagreement.caveat}
        </p>
      </section>

      <section className="defense-step">
        <header><span>STEP 3</span><h4>跨域阈值</h4></header>
        <p className="defense-note">
          本站校准模型训练于问答语料，在真实学术摘要跨域测试中绝对分数塌缩至 {crossDomain.calibratedScoreMin}–{crossDomain.calibratedScoreMax}、阈值 50 灵敏度为 {Math.round(crossDomain.at50Sensitivity * 100)}%（可复现：`{crossDomain.reproduceCommand}`）。
        </p>
      </section>

      <section className="defense-step">
        <header><span>STEP 4</span><h4>写作过程自述</h4></header>
        <p className="defense-note">以下三段必须如实填写，拒绝代写与虚构；未填写时导出稿仅保留占位引导，不会替你编造过程。</p>
        <div className="process-form">
          <label>
            写作时间线（必须如实，拒绝代写与虚构）
            <textarea
              value={timeline}
              onChange={(event) => setTimeline(event.target.value)}
              rows={3}
              placeholder={packet.selfStatement.isPlaceholder ? packet.selfStatement.placeholder.timeline : undefined}
            />
          </label>
          <label>
            修改痕迹与过程证据（必须如实，拒绝代写与虚构）
            <textarea
              value={evidenceNotes}
              onChange={(event) => setEvidenceNotes(event.target.value)}
              rows={3}
              placeholder={packet.selfStatement.isPlaceholder ? packet.selfStatement.placeholder.evidenceNotes : undefined}
            />
          </label>
          <label>
            AI 工具使用声明（必须如实，拒绝代写与虚构）
            <textarea
              value={aiUsage}
              onChange={(event) => setAiUsage(event.target.value)}
              rows={2}
              placeholder={packet.selfStatement.isPlaceholder ? packet.selfStatement.placeholder.aiUsage : undefined}
            />
          </label>
        </div>
      </section>

      <div className="defense-actions">
        <button type="button" className="defense-primary" disabled={packet.degraded} onClick={generateDocument}><ArrowDownToLine size={15} /> 下载申诉信</button>
        <button type="button" disabled={packet.degraded} onClick={copyDocument}><Clipboard size={15} /> 复制内容</button>
        <button type="button" onClick={() => window.print()}><Printer size={15} /> 打印</button>
      </div>
      <p className="defense-ethics">
        红线提醒：这份材料的力量来自<b>真实</b>。用伪造的过程材料去对抗检测器，你只是在用另一种不诚实替换算法的不诚实——而且会被一次面谈戳穿。
      </p>
    </div>
  )
}
