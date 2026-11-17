import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  Clipboard,
  Gavel,
  Info,
  Plus,
  Printer,
  Scale,
  Trash2,
} from 'lucide-react'
import { DEFENSE_EVIDENCE } from '../data/defenseEvidence'
import { buildAppealPacket, ONE_PAGER_LINES, type AppealPacket } from '../lib/appealPacket'
import type { PlatformRecord } from '../lib/defense'
import { fuseVerdicts, fusionToAppealText, type FusionResult } from '../lib/verdictFusion'
import { buildAppealLetterMarkdown, downloadText, type RewriteEntry } from '../lib/report'
import type { AnalysisReport, RetrievalChannelResult } from '../lib/types'
import { loadRewriteEntries } from '../lib/rewriteStore'

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

  // 老师能听懂的三句话：全部来自带出处的公开证据 + 本案真实读数，不说技术黑话。
  const biasStudy = DEFENSE_EVIDENCE.find((item) => item.id === 'stanford-esl-bias')
  const divergenceStudy = DEFENSE_EVIDENCE.find((item) => item.id === 'cnki-paperpass-divergence')
  const plainLines = [
    biasStudy
      ? `检测工具会误伤认真写作的人：${biasStudy.sourceName.split(',')[0]}的研究发现，主流检测器对中国学生的真实作文平均误报率达 ${biasStudy.stat}——用词工整、句式规整反而最容易被冤。`
      : '检测工具会误伤认真写作的人——用词工整、句式规整的真人写作反而最容易被误判。',
    divergenceStudy
      ? `同一个分数根本对不齐：公开调查中同一篇论文在不同平台被判成 ${divergenceStudy.stat}，说明这类百分比没有统一标准，不该当成唯一依据。`
      : '不同检测平台对同一篇论文的判定可以相差很大，这个百分比不该成为唯一依据。',
    rewrite.hasEntries
      ? `这篇我逐句修改过 ${rewrite.entries.length} 处，把空泛的表达改成了具体的论证——这份改写过程可以逐句核对。`
      : `本站对本文的多条独立读数彼此不一致（分歧度 ${disagreement.spread}），我希望能一起看证据，而不是只看一个数字。`,
  ]

  return (
    <section className="defense-onepager" aria-label="给老师的一页纸">
      <h3>给老师看的 3 条证据</h3>
      <p className="onepager-plain-hint">下面三句话可以直接念给老师听，都是能查到出处的事实：</p>
      <ol className="onepager-plain">
        {plainLines.map((line) => <li key={line}>{line}</li>)}
      </ol>
      <div className="onepager-lines">
        <p>{ONE_PAGER_LINES[0]}</p>
        <p>{ONE_PAGER_LINES[1]}</p>
      </div>
      <details className="onepager-tech">
        <summary>展开看技术依据（给懂行的人核对，含出处与复现命令）</summary>
        <ol>
          <li>{evidence1}</li>
          <li>{evidence2}</li>
          <li>{evidence3}</li>
        </ol>
      </details>
    </section>
  )
}

/**
 * 多平台判定拆解面板。
 * 措辞红线：只陈述可核查事实 + 合理质疑 + 透明折扣，绝不做"平台故意判高牟利"的动机断言。
 * 评估对象是判定本身的证据强度，不是学生是否使用 AI。
 */
function FusionPanel({ fusion }: { fusion: FusionResult }) {
  if (fusion.records.length === 0) {
    return (
      <div className="fusion-panel fusion-empty">
        <Scale size={18} />
        <p><strong>判定拆解</strong> · 录入上方平台分数后，这里会把每条判定按可核查事实逐项折减，给出"这些数字合起来有多可信"的结论——不是再给你一个 AI 分数。</p>
      </div>
    )
  }

  return (
    <div className="fusion-panel">
      <div className="fusion-head">
        <Scale size={19} />
        <div>
          <h4>判定拆解 · 把它们的分数拆开看</h4>
          <p>下面的折扣只依据你勾选的、能在平台官网核实的事实。规则全部摊开，你可以自己复核；这只是对"判定可信度"的评估，不是对你是不是用 AI 的判定。</p>
        </div>
      </div>

      <div className={`fusion-strength strength-${fusion.strengthLevel}`}>
        <div className="fusion-strength-score">
          <span>证据强度评估</span>
          <strong>{fusion.weightedEvidence}<small>/100</small></strong>
          <em>{fusion.strengthLabel}</em>
        </div>
        <div className="fusion-strength-meta">
          <div><span>录入判定</span><strong>{fusion.records.length} 条</strong></div>
          <div><span>原始均分</span><strong>{fusion.meanRaw}%</strong></div>
          <div><span>平台极差</span><strong>{fusion.scoreRange} 个百分点</strong></div>
          <div><span>利益冲突标记</span><strong>{fusion.conflictCount} 条</strong></div>
        </div>
      </div>
      <p className="fusion-dim-note">上方 /100 是对"这些判定有多可信"的评估，<strong>不是新的 AI 率</strong>；原始分数原样保留在下方，可自行核对。</p>

      <details className="fusion-rule-disclosure">
        <summary>查看折扣规则（依据的是什么、不代表什么）</summary>
        <div>
          <p><strong>规则</strong>：仅当你勾选了可在平台官网核实的事实，才对那条判定的"结论权重"做下调；原始分数、平台名、日期都不改动。</p>
          <ul>
            <li>同时提供付费改稿 / 降重 / 二次检测服务 → 权重 −25</li>
            <li>未公开中文学术文本误报率 / 校准数据 → 权重 −20</li>
            <li>多平台判定极差 ≥30 个百分点 → 每条权重 −10；≥15 → −5</li>
          </ul>
          <p><strong>不代表</strong>：我们认定任何平台"故意判高"或动机不纯。检测与改稿由同一主体提供，只是<strong>应披露的商业关系</strong>；据此下调权重供你参考，是否采信由你决定。默认全部不勾选，不含任何折扣。</p>
        </div>
      </details>

      <p className="fusion-conclusion">{fusion.conclusion}</p>

      <div className="fusion-records">
        {fusion.records.map((item, index) => (
          <details className="fusion-record" key={`${item.record.platform}-${index}`}>
            <summary>
              <strong>{item.record.platform || '未命名平台'}</strong>
              <span>{item.record.score}% → 权重 {item.evidenceWeight}/100</span>
              <ChevronDown size={15} className="tech-chevron" />
            </summary>
            <div className="fusion-record-body">
              {item.discounts.length === 0 ? (
                <p>{item.note}</p>
              ) : (
                <ul>
                  {item.discounts.map((discount) => (
                    <li key={discount.label}>
                      <strong>−{discount.amount}</strong> {discount.label}
                      <span>{discount.basis}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        ))}
      </div>

      <p className="fusion-caveat"><Info size={14} /> {fusion.caveat}</p>
    </div>
  )
}

export function DefenseKit({ report, retrieval, onToast }: DefenseKitProps) {
  const [records, setRecords] = useState<PlatformRecord[]>(loadRecords)
  const [platform, setPlatform] = useState('')
  const [score, setScore] = useState('')
  const [date, setDate] = useState('')
  const [sellsRewrite, setSellsRewrite] = useState(false)
  const [hasCalibration, setHasCalibration] = useState(false)
  const [timeline, setTimeline] = useState('')
  const [evidenceNotes, setEvidenceNotes] = useState('')
  const [aiUsage, setAiUsage] = useState('')
  // 改写工作台记录的学生真实改写，自动带入申诉证据包板块 5。
  // 只在报告变化时读一次本机草稿，避免每次输入都触发读盘。
  const [rewriteEntries] = useState<RewriteEntry[]>(() => loadRewriteEntries(report))

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  }, [records])

  // 多平台判定的证据拆解：把外部判定按可核查事实折扣，评估其证据强度（非作者身份判定）
  const fusion: FusionResult = useMemo(() => fuseVerdicts(records), [records])

  // 已算好的本报告证据自动带入；学生只需补充平台信息与写作过程自述
  const packet = useMemo(
    () => buildAppealPacket(report, retrieval, {
      platform,
      score,
      platformRecords: records,
      timeline,
      evidenceNotes,
      aiUsage,
      rewriteEntries,
    }),
    [report, retrieval, platform, score, records, timeline, evidenceNotes, aiUsage, rewriteEntries],
  )

  const addRecord = () => {
    const trimmed = platform.trim()
    const value = Number(score)
    if (!trimmed || Number.isNaN(value) || value < 0 || value > 100) {
      onToast('请填写平台名称和 0–100 之间的检测值')
      return
    }
    setRecords((current) => [
      ...current,
      {
        platform: trimmed,
        score: Math.round(value),
        date: date.trim(),
        sellsRewriteService: sellsRewrite,
        publishedCalibration: hasCalibration,
      },
    ])
    setPlatform('')
    setScore('')
    setDate('')
    setSellsRewrite(false)
    setHasCalibration(false)
    onToast('已录入，可继续添加其他平台做对照')
  }

  const fusionText = fusionToAppealText(fusion)
  const generateDocument = () => {
    if (packet.degraded) return
    const markdown = buildAppealLetterMarkdown(packet, fusionText)
    downloadText(markdown, `reauthor-appeal-letter-${new Date().toISOString().slice(0, 10)}.md`)
    onToast('申诉信已下载，请确认写作过程自述如实填写后再提交')
  }

  const copyDocument = async () => {
    if (packet.degraded) return
    const markdown = buildAppealLetterMarkdown(packet, fusionText)
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

      {/* 完成度自检：让学生一眼看到还差什么，避免交出空模板却不知情 */}
      {!packet.degraded && (() => {
        const checks = [
          { label: '被判平台与分数', done: packet.verdict.judgedScore !== null && packet.verdict.judgedPlatform !== '' },
          { label: '写作时间线', done: packet.selfStatement.timeline.trim() !== '' },
          { label: '修改痕迹与过程证据', done: packet.selfStatement.evidenceNotes.trim() !== '' },
          { label: 'AI 工具使用声明', done: packet.selfStatement.aiUsage.trim() !== '' },
        ]
        const doneCount = checks.filter((item) => item.done).length
        return (
          <div className="appeal-checklist" role="note">
            <div className="appeal-checklist-head">
              <strong>导出前自检 · {doneCount}/{checks.length} 项已填</strong>
              <span>{doneCount === checks.length ? '资料齐全，可以导出了。' : '下面是空的或待填项，补齐后说明会更有力；留空也能先导出。'}</span>
            </div>
            <div className="appeal-checklist-items">
              {checks.map((item) => (
                <span key={item.label} className={item.done ? 'check-done' : 'check-todo'}>
                  {item.done ? <Check size={14} /> : <span className="check-dot" aria-hidden="true" />}
                  {item.label}
                  <em>{item.done ? '已填' : '待补'}</em>
                </span>
              ))}
            </div>
          </div>
        )
      })()}

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
        <div className="record-flags">
          <label>
            <input type="checkbox" checked={sellsRewrite} onChange={(event) => setSellsRewrite(event.target.checked)} />
            该平台同时提供付费改稿 / 降重 / 二次检测服务
          </label>
          <label>
            <input type="checkbox" checked={hasCalibration} onChange={(event) => setHasCalibration(event.target.checked)} />
            该平台已公开中文学术文本误报率 / 校准数据
          </label>
          <p>只勾选你能在平台官网核实的事实。留空不预设任何平台有问题；勾选后可随时在下方取消。</p>
        </div>
        {records.length > 0 && (
          <div className="record-table">
            {records.map((record, index) => (
              <div className="record-row" key={`${record.platform}-${index}`}>
                <strong>{record.platform}</strong>
                <em>{record.score}%</em>
                <span>{record.date || '—'}</span>
                {record.sellsRewriteService && <span className="record-flag-tag flag-conflict" title="已标记：同时提供付费改稿服务">利益冲突</span>}
                {record.publishedCalibration === true && <span className="record-flag-tag flag-cal" title="已标记：公开校准数据">已公开校准</span>}
                {record.publishedCalibration !== true && <span className="record-flag-tag flag-uncal" title="未标记公开校准数据">校准未公开</span>}
                <button type="button" onClick={() => setRecords(records.filter((_, i) => i !== index))} aria-label={`删除 ${record.platform} 的记录`}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <FusionPanel fusion={fusion} />
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
        <p className="defense-note">
          {rewriteEntries.length > 0
            ? `你在改写工作台改写的 ${rewriteEntries.length} 句已自动带入上面的对照表，不用在这里重复。下面三段是只有你知道的过程，如实填写会让说明更有力；暂时写不出也能先导出，留空处会保留填写提示，我们绝不替你编造。`
            : '这三段是只有你知道的过程，如实填写会让说明更有力；暂时写不出也能先导出，留空处会保留填写提示，我们绝不替你编造。拒绝代写与虚构。'}
        </p>
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
