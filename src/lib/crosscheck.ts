import type { CrossVerdict } from './types'

/**
 * 分歧评估是全局共享的：analyzer 用它生成基础四通道结论，
 * UI 在神经通道加入后用它重算。常量公开，可被任何人重算。
 */
export const SPREAD_ALIGNED_MAX = 25
export const SPREAD_MIXED_MAX = 45

export function evaluateSpread(scores: number[]): {
  spread: number
  median: number
  verdict: CrossVerdict
  verdictLabel: string
} {
  if (scores.length === 0) return { spread: 0, median: 0, verdict: 'aligned', verdictLabel: '无通道数据' }
  const sorted = [...scores].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
  const spread = Math.round(sorted[sorted.length - 1] - sorted[0])
  if (spread <= SPREAD_ALIGNED_MAX) {
    return { spread, median, verdict: 'aligned', verdictLabel: '各通道基本一致' }
  }
  if (spread <= SPREAD_MIXED_MAX) {
    return { spread, median, verdict: 'mixed', verdictLabel: '通道间存在分歧，结论应谨慎引用' }
  }
  return { spread, median, verdict: 'divergent', verdictLabel: '通道严重分歧：不应引用任何单一数字' }
}
