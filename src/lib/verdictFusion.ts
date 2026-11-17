/**
 * v0.12 多平台判定融合 / 拆解模块。
 *
 * 第一性原理：我们不做"又一个 AI 检测器"。融合的对象是那些判定本身的可信度，
 * 输出的是"这些判定合起来够不够格当证据"，而不是"学生是不是 AI"。
 * 类比法庭质证——不是替被告证明清白，是检验检方证据的证明力。
 *
 * 红线（与 docs/fusion-ethics-guidelines.md 一致）：
 *  - 折扣只依据【可核查的客观事实】，由填写者自行勾选，默认全部为 false / 未标记。
 *  - 绝不写"某平台故意判高以牟利"这类动机断言——那是不可证明的指控。
 *  - 结论永远导向"人工复核 + 过程证据"，且任何证据强度档位都不构成作者身份判定。
 *  - 所有折扣规则对本模块的使用者完全透明，可逐条关闭、不采信。
 */

export interface FusionRecordInput {
  platform: string
  score: number
  date: string
  /** 可核查事实：该平台官网是否同时提供付费改稿 / 降重 / 二次检测服务 */
  sellsRewriteService?: boolean
  /** 可核查事实：该平台是否公开了中文学术文本的误报率 / 校准数据 */
  publishedCalibration?: boolean
}

export interface FusionDiscount {
  label: string
  amount: number
  basis: string
}

export interface FusedVerdict {
  record: FusionRecordInput
  baseWeight: number
  discounts: FusionDiscount[]
  evidenceWeight: number
  note: string
}

export type StrengthLevel = 'strong' | 'moderate' | 'weak' | 'very-weak'

export interface FusionResult {
  records: FusedVerdict[]
  rawScores: number[]
  scoreRange: number
  meanRaw: number
  weightedEvidence: number
  strengthLevel: StrengthLevel
  strengthLabel: string
  conflictCount: number
  uncalibratedCount: number
  consistencyFactor: number
  conclusion: string
  caveat: string
}

const STRENGTH_LABELS: Record<StrengthLevel, string> = {
  strong: '证据强度：较高',
  moderate: '证据强度：中等',
  weak: '证据强度：偏弱',
  'very-weak': '证据强度：很弱',
}

/**
 * 对单条平台判定做透明折扣。折扣依据全部是可核查事实，且逐条给出依据文本。
 * 学生可自行决定是否标记；未标记一律按"无此问题"处理，不预设任何平台有问题。
 */
export function fuseRecord(record: FusionRecordInput, groupRange: number): FusedVerdict {
  const discounts: FusionDiscount[] = []

  if (record.sellsRewriteService === true) {
    discounts.push({
      label: '该平台同时提供付费改稿 / 降重 / 二次检测服务',
      amount: 25,
      basis: '结构性利益冲突（官网可核查）：平台从"高 AI 率"结果中可能获得后续付费需求。这是利益冲突提示，不是对其造假的指控。',
    })
  }
  if (record.publishedCalibration !== true) {
    discounts.push({
      label: '未公开中文学术文本的误报率 / 校准数据',
      amount: 20,
      basis: '没有可核查的误差数据，这个百分比就无法被独立质证——与公开调查中"同文异判 5% vs 70%"的问题同源。',
    })
  }
  if (groupRange >= 30) {
    discounts.push({
      label: '多平台判定极差 ≥30 个百分点',
      amount: 10,
      basis: '公开调查中同一篇论文在不同平台被判成 5% / 50% / 70%，平台间不存在共同基准。',
    })
  } else if (groupRange >= 15) {
    discounts.push({
      label: '多平台判定极差 ≥15 个百分点',
      amount: 5,
      basis: '分歧已超出可忽略的技术误差范围，单一读数的证明力相应下降。',
    })
  }

  const evidenceWeight = Math.max(0, 100 - discounts.reduce((sum, item) => sum + item.amount, 0))
  const note = discounts.length === 0
    ? '未标记任何折扣项：本条判定按完整权重计入（但你仍可自行质疑其方法）。'
    : `按 ${discounts.length} 项可核查事实折减，证据权重 ${evidenceWeight}/100。`

  return { record, baseWeight: 100, discounts, evidenceWeight, note }
}

function levelFor(value: number): StrengthLevel {
  if (value >= 75) return 'strong'
  if (value >= 55) return 'moderate'
  if (value >= 35) return 'weak'
  return 'very-weak'
}

function consistencyFor(range: number): number {
  if (range >= 30) return 0.7
  if (range >= 15) return 0.85
  return 1
}

/**
 * 融合主入口。records 为空时返回降级结果，不生成任何"本案证据"式断言。
 */
export function fuseVerdicts(records: FusionRecordInput[]): FusionResult {
  const valid = records.filter((record) => Number.isFinite(record.score) && record.score >= 0 && record.score <= 100)
  const rawScores = valid.map((record) => Math.round(record.score))
  const scoreRange = rawScores.length >= 2 ? Math.max(...rawScores) - Math.min(...rawScores) : 0
  const meanRaw = rawScores.length ? Math.round(rawScores.reduce((a, b) => a + b, 0) / rawScores.length) : 0

  const fused = valid.map((record) => fuseRecord(record, scoreRange))
  const conflictCount = fused.filter((item) => item.record.sellsRewriteService === true).length
  const uncalibratedCount = fused.filter((item) => item.record.publishedCalibration !== true).length
  const consistencyFactor = rawScores.length >= 2 ? consistencyFor(scoreRange) : 1

  const averageWeight = fused.length
    ? fused.reduce((sum, item) => sum + item.evidenceWeight, 0) / fused.length
    : 0
  const weightedEvidence = Math.round(averageWeight * consistencyFactor)
  const strengthLevel = levelFor(weightedEvidence)

  const conclusion = buildConclusion({
    count: fused.length,
    conflictCount,
    uncalibratedCount,
    scoreRange,
    strengthLabel: STRENGTH_LABELS[strengthLevel],
  })

  return {
    records: fused,
    rawScores,
    scoreRange,
    meanRaw,
    weightedEvidence,
    strengthLevel,
    strengthLabel: STRENGTH_LABELS[strengthLevel],
    conflictCount,
    uncalibratedCount,
    consistencyFactor,
    conclusion,
    caveat:
      '本结论评估的是"这些判定作为证据的可信度"，不是对你是否使用 AI 的判定。' +
      '任何单一百分比、任何证据强度档位都不能作为处分的唯一依据；请据此处以人工复核与过程材料。',
  }
}

function buildConclusion(args: {
  count: number
  conflictCount: number
  uncalibratedCount: number
  scoreRange: number
  strengthLabel: string
}): string {
  if (args.count === 0) {
    return '尚未录入任何平台的检测结果。录入后可对各条判定做透明的证据拆解。'
  }
  const parts: string[] = [`已录入 ${args.count} 条外部判定。`]
  if (args.conflictCount > 0) {
    parts.push(`其中 ${args.conflictCount} 条来自同时提供付费改稿 / 二次检测服务的平台（利益冲突，可核查）。`)
  }
  if (args.uncalibratedCount > 0) {
    parts.push(`${args.uncalibratedCount} 条未公开中文学术文本的误报率 / 校准数据。`)
  }
  if (args.count >= 2) {
    parts.push(`各平台极差 ${args.scoreRange} 个百分点，${args.scoreRange >= 30 ? '彼此矛盾，不存在共同基准' : '存在可见分歧'}。`)
  }
  parts.push(`${args.strengthLabel}。`)
  parts.push(
    '这意味着：即便把这些数字合在一起，也不足以支撑一个"高 AI 率"的定性结论；' +
      '它们只能作为申请人工复核的线索，而不能替代逐句证据与写作过程材料。',
  )
  return parts.join('')
}

/** 供申诉信导出使用的一段式质证结论（纯文本，可直接引用） */
export function fusionToAppealText(result: FusionResult): string {
  if (result.records.length === 0) return ''
  const lines: string[] = [
    '### 对外部检测判定的证据拆解',
    '',
    result.conclusion,
    '',
    '逐条拆解（折扣规则公开、可自行复核）：',
    ...result.records.flatMap((item, index) => [
      `${index + 1}. ${item.record.platform || '未命名平台'}：原始 ${item.record.score}% → 证据权重 ${item.evidenceWeight}/100`,
      ...item.discounts.map((discount) => `   - 折减 ${discount.amount}：${discount.label}。依据：${discount.basis}`),
    ]),
    '',
    result.caveat,
  ]
  return lines.join('\n')
}
