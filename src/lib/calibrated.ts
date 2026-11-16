import modelData from '../data/calibratedModel.json'
import { FORMULAIC_RULES, GENERIC_RULES } from './patterns'

/**
 * v0.5 校准模型通道：逻辑回归（8 个表层文体特征，系数全公开）。
 * 训练协议与实测成绩见 src/data/calibratedModel.json —— 由
 * scripts/train-model.ts 在 HC3-Chinese 上以分层 5 折交叉验证产生：
 * 留出折 AUC 0.930 ± 0.007（2026-11-16，权威值以 calibratedModel.json 为准）。
 *
 * 三条诚实边界（UI 必须同步展示）：
 *  1. 训练数据是 HC3 问答文本（2023 年 ChatGPT 生成），与学术论文存在领域差异，
 *     论文场景的实际表现可能不同——这正是"训练/应用领域必须披露"的原因。
 *  2. 表层特征模型对刻意改写（洗稿）脆弱，见方法页红队测试。
 *  3. 概率输出是"HC3 式中文问答文本由该代 ChatGPT 生成"的校准读数，
 *     不是普适的"AI 概率"，更不能推断作者身份。
 */

export const CALIBRATED_MODEL_INFO = {
  cvAuc: modelData.performance.crossValidatedAuc,
  aucStd: modelData.performance.aucStd,
  sensitivity: modelData.performance.meanSensitivity,
  specificity: modelData.performance.meanSpecificity,
  sampleCount: Number(/纳入 (\d+) 篇/.exec(modelData.meta.dataset)?.[1] ?? 0),
  protocol: modelData.meta.protocol,
  dataset: modelData.meta.dataset,
  generatedAt: modelData.meta.generatedAt,
}

const ZH_SENTENCE_SPLIT = /[^。！？!?]+[。！？!?]*/g

export interface CalibratedResult {
  /** 0–100，越高越接近训练集中 AI 生成文本的特征分布 */
  score: number
  probability: number
}

export function scoreCalibrated(text: string): CalibratedResult {
  const features = extractModelFeatures(text)
  const zh = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const en = (text.match(/[a-zA-Z]+(?:['’-][a-zA-Z]+)*/g) ?? []).length
  const isZh = zh >= en

  const standardized = (modelData.coefficients.means as Array<{ feature: string; mean: number; std: number }>).map(
    ({ feature, mean, std }) => (features[feature as keyof ModelFeatures] - mean) / std,
  )
  const z = standardized.reduce((sum, value, index) => sum + value * modelData.coefficients.weights[index].weight, modelData.coefficients.bias)
  const probability = 1 / (1 + Math.exp(-z))
  const score = Math.round(probability * 100)
  void isZh
  return { score, probability: Number(probability.toFixed(4)) }
}

interface ModelFeatures {
  lengthCV: number
  meanSentenceLength: number
  ttr: number
  trigramRepeat: number
  punctuationDensity: number
  formulaicDensity: number
  genericDensity: number
  paragraphCount: number
}

function countMatches(text: string, regexes: RegExp[]): number {
  return regexes.reduce((sum, regex) => {
    regex.lastIndex = 0
    return sum + Array.from(text.matchAll(regex)).length
  }, 0)
}

export function extractModelFeatures(text: string): ModelFeatures {
  const zhChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const enWords = (text.match(/[a-zA-Z]+(?:['’-][a-zA-Z]+)*/g) ?? []).length
  const isZh = zhChars >= enWords

  const sentences = (text.match(isZh ? ZH_SENTENCE_SPLIT : /[^.!?]+[.!?]*/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
  const lengths = sentences.map((sentence) => (isZh ? (sentence.match(/[\u4e00-\u9fff]/g) ?? []).length : (sentence.match(/[a-zA-Z]+/g) ?? []).length))
  const mean = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0
  const variance = lengths.length > 1 ? lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lengths.length : 0
  const lengthCV = mean > 0 ? Math.sqrt(variance) / mean : 0

  const tokens = isZh ? Array.from(text.match(/[\u4e00-\u9fff]/g) ?? []) : (text.toLowerCase().match(/[a-z]+/g) ?? [])
  const ttr = tokens.length > 0 ? new Set(tokens).size / tokens.length : 0

  const ngrams = new Map<string, number>()
  for (let i = 0; i <= tokens.length - 3; i += 1) {
    const gram = tokens.slice(i, i + 3).join(isZh ? '' : ' ')
    ngrams.set(gram, (ngrams.get(gram) ?? 0) + 1)
  }
  const repeated = [...ngrams.values()].filter((count) => count > 1).length
  const trigramRepeat = ngrams.size > 0 ? repeated / ngrams.size : 0

  const punctuation = (text.match(/[，,。！？!?；;：:]/g) ?? []).length
  const punctuationDensity = sentences.length > 0 ? punctuation / sentences.length : 0

  const per100 = isZh ? Math.max(zhChars, 1) / 100 : Math.max(enWords, 1) / 100
  const formulaicDensity = countMatches(text, isZh ? FORMULAIC_RULES.zh.map((rule) => rule.regex) : FORMULAIC_RULES.en.map((rule) => rule.regex)) / per100
  const genericDensity = countMatches(text, isZh ? GENERIC_RULES.zh.map((rule) => rule.regex) : GENERIC_RULES.en.map((rule) => rule.regex)) / per100

  return {
    lengthCV,
    meanSentenceLength: mean,
    ttr,
    trigramRepeat,
    punctuationDensity,
    formulaicDensity,
    genericDensity,
    paragraphCount: text.split(/\n+/).filter((part) => part.trim()).length,
  }
}
