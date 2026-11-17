import { makeScoringContext, scoreSentenceDraft } from './analyzer'
import type { RewriteEntry } from './report'
import type { AnalysisReport } from './types'

/** 一条改写草稿：学生本人写下的改写与理由 */
export interface Draft {
  text: string
  reason: string
}

const STORAGE_PREFIX = 'reauthor-rewrites-v1:'

export function rewriteStorageKey(report: AnalysisReport): string {
  return `${STORAGE_PREFIX}${report.createdAt}`
}

/** 从本机读出该报告的改写草稿；隐私模式 / 解析失败时静默降级为空 */
export function loadDrafts(report: AnalysisReport): Record<number, Draft> {
  try {
    const raw = window.localStorage.getItem(rewriteStorageKey(report))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<number, Draft>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * 挑出最值得动手的句子：按原句特征值降序，最多 6 句。若全都很低也至少给 3 句作为练习。
 * 改写台与「改写 → 申诉」证据回流共用同一口径。
 */
export function pickTargets(report: AnalysisReport) {
  const ranked = [...report.sentenceAnalyses].sort((a, b) => b.score - a.score)
  const needy = ranked.filter((s) => s.level !== 'low')
  return (needy.length >= 3 ? needy : ranked).slice(0, 6)
}

/**
 * 从本机草稿读出该报告的 RewriteEntry[]，供申诉工作台自动带入证据包板块 5。
 * 纯读取 + 与改写台完全相同的评分口径；无草稿时返回空数组，绝不虚构过程材料。
 */
export function loadRewriteEntries(report: AnalysisReport): RewriteEntry[] {
  const drafts = loadDrafts(report)
  const context = makeScoringContext(report.originalText, report.language)
  return pickTargets(report)
    .filter((sentence) => drafts[sentence.id]?.text?.trim())
    .map((sentence) => {
      const draft = drafts[sentence.id]
      const scored = scoreSentenceDraft(draft.text, context)
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
}
