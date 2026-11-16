import crossDomain from '../data/crossDomainValidation.json'
import type { PlatformRecord } from './defense'
import type { RewriteEntry } from './report'
import type { AnalysisReport, RetrievalChannelResult } from './types'

/** 板块 1 · 判决概况 */
export interface AppealVerdictSection {
  judgedPlatform: string
  judgedScore: number | null
  platformRecords: PlatformRecord[]
  siteReading: number
  siteLevelLabel: string
  siteCalibratedScore: number
}

/** 板块 2 · 本文多通道分歧实证 */
export interface AppealDisagreementSection {
  channels: Array<{ name: string; score: number }>
  spread: number
  verdictLabel: string
  caveat: string
}

/** 板块 3 · 跨域阈值失效说明 */
export interface AppealCrossDomainSection {
  trainDomain: string
  testDomain: string
  calibratedAuc: number
  calibratedScoreMin: number
  calibratedScoreMax: number
  at50Sensitivity: number
  at50Specificity: number
  ruleAuc: number
  reproduceCommand: string
}

/** 板块 4 · 检索匹配度 / 最近邻 */
export interface AppealRetrievalSection {
  available: boolean
  score: number | null
  coverage: number | null
  corpusSize: number | null
  nearestNeighbors: Array<{ label: 0 | 1; similarity: number; excerpt: string }>
  note: string
}

/** 板块 5 · 改写前后对照 */
export interface AppealRewriteSection {
  entries: RewriteEntry[]
  hasEntries: boolean
  placeholder: string
}

/** 板块 6 · 写作过程自述占位 */
export interface AppealSelfStatementSection {
  timeline: string
  evidenceNotes: string
  aiUsage: string
  isPlaceholder: boolean
  placeholder: {
    timeline: string
    evidenceNotes: string
    aiUsage: string
  }
}

/** 学生本人填写/录入的信息（其余证据全部由 report + retrieval 自动带入） */
export interface AppealUserInput {
  platform?: string
  score?: number | string
  platformRecords?: PlatformRecord[]
  timeline?: string
  evidenceNotes?: string
  aiUsage?: string
  rewriteEntries?: RewriteEntry[]
}

/** 一案一证的申诉证据包（纯数据，零副作用） */
export interface AppealPacket {
  sufficient: boolean
  degraded: boolean
  degradedNotice: string
  verdict: AppealVerdictSection
  disagreement: AppealDisagreementSection
  crossDomain: AppealCrossDomainSection
  retrieval: AppealRetrievalSection
  rewrite: AppealRewriteSection
  selfStatement: AppealSelfStatementSection
  ethicsNotice: string
}

export const SINGLE_PERCENTAGE_CAVEAT =
  '按本站公开口径，此分歧下任何检测网站给出的单一百分比（包括本站）都不应被引用。'

export const ETHICS_NOTICE =
  '本材料不证明作者身份，不保证申诉成功，请如实填写；虚构过程材料会构成新的学术不端，且极易在面谈中被戳穿。'

export const RETRIEVAL_NOTE =
  '检索通道是本地语料（零模型、零联网）的最近邻比对；覆盖率偏低时读数仅作定性参考，不可当分数引用。'
export const RETRIEVAL_UNAVAILABLE =
  '本次未运行检索通道，检索匹配度证据暂缺（可在结果页重新运行后刷新本证据包）。'

export const REWRITE_PLACEHOLDER =
  '（可选：附上你在"改写工作台"导出的《改写前后对照表》。若无改写记录，请如实说明，不要伪造。）'

export const SELF_PLACEHOLDER: AppealSelfStatementSection['placeholder'] = {
  timeline: '（示例：X 月 X 日完成选题与提纲；X 月 X 日完成初稿第一、二章；X 月 X 日根据导师意见重写第三章；共保存 X 个主要版本，见附件/版本历史截图。）',
  evidenceNotes: '（示例：写作软件/在线文档的版本历史截图；文献阅读笔记；与导师的沟通记录；各阶段草稿的文件修改时间。）',
  aiUsage: '（示例：未使用 AI 生成正文内容；或：仅在 X 环节使用 AI 辅助 X，相关部分已注明。）',
}

export const DEGRADED_NOTICE =
  '样本不足（需中文≥400 字或英文≥180 词，且不少于 6 句）：本次仅提供规则观察，不构成申诉依据，不产出可用的申诉信。'

// 一页纸的两句可念话术（逐字）
export const ONE_PAGER_LINES: [string, string] = [
  '这篇文章我用本站做了多通道复核，六个读数互相矛盾，我希望能一起看证据，而不是只看一个百分比。',
  '我并没有要求凭分数直接判定，而是请求对照本站公开的分歧数据与可复现的跨域测试，做一次人工复核。',
]

/** 跨域校准分数（0–100）的取值区间必须来自真实 JSON，禁止硬编码 */
const calibratedSamples = crossDomain.perDoc.flatMap((doc) => [doc.humanScore, doc.aiScore])
const CALIBRATED_SCORE_MIN = Math.min(...calibratedSamples)
const CALIBRATED_SCORE_MAX = Math.max(...calibratedSamples)

/** 0–100 合法分数才保留；空值 / 非数字 / 越界一律为 null（导出时显示“待填写”） */
function normalizeJudgedScore(raw: number | string | undefined): number | null {
  if (raw === undefined || raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
}

/**
 * 把已算好的本报告证据（多通道分歧 / 跨域阈值塌缩 / 检索 / 改写对照）
 * 与学生如实填写的内容，装配成一案一证的申诉证据包。
 *
 * 纯函数：不读写 localStorage、不发网络请求、不修改入参、不含 Date / 随机数。
 */
export function buildAppealPacket(
  report: AnalysisReport,
  retrieval?: RetrievalChannelResult,
  userInput?: AppealUserInput,
): AppealPacket {
  const sufficient = report.isSampleSufficient
  const degraded = !sufficient

  // 板块 2：分歧度直接取 report，不重算，避免与 analyzer 口径分叉
  const channels = report.crossValidation.detectors.map((detector) => ({
    name: detector.name,
    score: detector.score,
  }))
  if (retrieval?.status === 'done' && typeof retrieval.score === 'number') {
    channels.push({ name: '语料检索通道', score: retrieval.score })
  }

  const available = retrieval?.status === 'done'
  const nearestNeighbors = (retrieval?.neighbors ?? []).slice(0, 3).map((neighbor) => ({
    label: neighbor.label,
    similarity: neighbor.similarity,
    excerpt: neighbor.excerpt,
  }))

  const entries = userInput?.rewriteEntries ?? []
  const timeline = userInput?.timeline ?? ''
  const evidenceNotes = userInput?.evidenceNotes ?? ''
  const aiUsage = userInput?.aiUsage ?? ''
  const isPlaceholder = [timeline, evidenceNotes, aiUsage].every((item) => item.trim() === '')

  // 判决概况：优先用用户当场填写的平台/分数。工作台「录入」后输入框会被清空，
  // 此时用最后一条真实录入的平台记录回填，避免「被判分数：（待填写）」与下方
  // 平台记录表格里已有的分数自相矛盾。仅组织用户已如实录入的数据，不虚构。
  const platformRecords = userInput?.platformRecords ?? []
  const lastRecord = platformRecords.length ? platformRecords[platformRecords.length - 1] : undefined
  const judgedPlatform = (userInput?.platform ?? '').trim() || lastRecord?.platform || ''
  const judgedScore = normalizeJudgedScore(userInput?.score) ?? normalizeJudgedScore(lastRecord?.score)

  return {
    sufficient,
    degraded,
    degradedNotice: degraded ? DEGRADED_NOTICE : '',
    verdict: {
      judgedPlatform,
      judgedScore,
      platformRecords,
      siteReading: report.score,
      siteLevelLabel: report.levelLabel,
      siteCalibratedScore: report.calibratedScore,
    },
    disagreement: {
      channels,
      spread: report.crossValidation.spread,
      verdictLabel: report.crossValidation.verdictLabel,
      caveat: SINGLE_PERCENTAGE_CAVEAT,
    },
    crossDomain: {
      trainDomain: crossDomain.meta.trainDomain,
      testDomain: crossDomain.meta.testDomain,
      calibratedAuc: crossDomain.calibrated.auc,
      calibratedScoreMin: CALIBRATED_SCORE_MIN,
      calibratedScoreMax: CALIBRATED_SCORE_MAX,
      at50Sensitivity: crossDomain.calibrated.at50.sensitivity,
      at50Specificity: crossDomain.calibrated.at50.specificity,
      ruleAuc: crossDomain.ruleEngine.auc,
      reproduceCommand: 'npx tsx scripts/crossdomain-test.ts',
    },
    retrieval: {
      available,
      score: retrieval?.score ?? null,
      coverage: retrieval?.coverage ?? null,
      corpusSize: retrieval?.corpusSize ?? null,
      nearestNeighbors,
      note: available ? RETRIEVAL_NOTE : RETRIEVAL_UNAVAILABLE,
    },
    rewrite: {
      entries,
      hasEntries: entries.length > 0,
      placeholder: REWRITE_PLACEHOLDER,
    },
    selfStatement: {
      timeline,
      evidenceNotes,
      aiUsage,
      isPlaceholder,
      placeholder: SELF_PLACEHOLDER,
    },
    ethicsNotice: ETHICS_NOTICE,
  }
}
