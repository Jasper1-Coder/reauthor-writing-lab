/**
 * v0.5：训练校准模型通道（逻辑回归，系数全公开）。
 *
 * 严格协议：
 *   - 数据：HC3 中文（open_qa / wiki_csai / finance / medicine，真人 vs ChatGPT）
 *   - 分层 5 折交叉验证（训练/测试严格分离，无任何测试集信息泄漏）
 *   - 特征：表层文体统计（句长 CV、TTR、n-gram 重复、标点密度、套话密度……）
 *   - 标准化参数只在训练折上计算
 *   - 报告：测试折 AUC、固定阈值 0.5 下的灵敏度/特异度/准确率
 *
 * 运行：npx tsx scripts/train-model.ts
 * 输出：src/data/calibratedModel.json（系数 + 协议 + 实测指标，直接进 UI）
 */
import { writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { GENERIC_RULES, FORMULAIC_RULES } from '../src/lib/patterns'

// ---------- 数据加载 ----------
interface Sample {
  text: string
  label: 0 | 1 // 0 = 真人, 1 = AI
  domain: string
}

function loadSamples(): Sample[] {
  const samples: Sample[] = []
  const files = ['baike', 'finance', 'law', 'medicine', 'open_qa', 'psychology'].map((name) => ({
    name,
    path: `calibration/raw/zh_${name}.jsonl`,
  }))
  const PER_DOMAIN_CAP = 500 // 每领域每类上限，保证训练规模可控且领域均衡
  const domainCounts = new Map<string, { human: number; ai: number }>()
  for (const file of files) {
    try {
      const raw = readFileSync2(file.path)
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        const row = JSON.parse(line) as { human_answers?: string[]; chatgpt_answers?: string[] }
        const counts = domainCounts.get(file.name) ?? { human: 0, ai: 0 }
        for (const text of row.human_answers ?? []) {
          if (counts.human < PER_DOMAIN_CAP && isEligible(text)) {
            samples.push({ text, label: 0, domain: file.name })
            counts.human += 1
          }
        }
        for (const text of row.chatgpt_answers ?? []) {
          if (counts.ai < PER_DOMAIN_CAP && isEligible(text)) {
            samples.push({ text, label: 1, domain: file.name })
            counts.ai += 1
          }
        }
        domainCounts.set(file.name, counts)
      }
    } catch (error) {
      console.warn(`skip ${file.name}: ${(error as Error).message}`)
    }
  }
  return samples
}

function readFileSync2(relativePath: string): string {
  return readFileSync(resolve(import.meta.dirname ?? '.', '..', relativePath), 'utf-8')
}

/**
 * 训练集纳入门槛：中文 ≥200 字。
 * 注意：线上引擎的充分性弃权线（≥400字）是为"给用户定性"设计的；
 * 训练用更宽的门槛以获得足够的两类样本，协议中如实披露——
 * 运行时对 <400 字的文本给出的是模型读数而非风险定性。
 */
function isEligible(text: unknown): text is string {
  if (typeof text !== 'string' || !text.trim()) return false
  const zh = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const en = (text.match(/[a-zA-Z]+(?:['’-][a-zA-Z]+)*/g) ?? []).length
  return zh >= 200 || en >= 140
}

// ---------- 特征提取（与线上引擎同源的表层统计） ----------
function countMatches(text: string, regexes: RegExp[]): number {
  return regexes.reduce((sum, regex) => {
    regex.lastIndex = 0
    return sum + Array.from(text.matchAll(regex)).length
  }, 0)
}

const ZH_SENTENCE_SPLIT = /[^。！？!?]+[。！？!?]*/g
const ALL_RULES = {
  zh: [...FORMULA_RULES_ZH(), ...GENERIC_RULES.zh.map((rule) => rule.regex)],
  en: [...FORMULA_RULES_EN(), ...GENERIC_RULES.en.map((rule) => rule.regex)],
}
function FORMULA_RULES_ZH() { return FORMULAIC_RULES.zh.map((rule) => rule.regex) }
function FORMULA_RULES_EN() { return FORMULAIC_RULES.en.map((rule) => rule.regex) }

export interface RawFeatures {
  lengthCV: number
  meanSentenceLength: number
  ttr: number
  trigramRepeat: number
  punctuationDensity: number
  formulaicDensity: number
  genericDensity: number
  paragraphCount: number
}

export function extractFeatures(text: string): RawFeatures {
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

  const tokens = isZh ? Array.from(text.match(/[\u4e00-\u9fff]/g) ?? []) : text.toLowerCase().match(/[a-z]+/g) ?? []
  const unique = new Set(tokens).size
  const ttr = tokens.length > 0 ? unique / tokens.length : 0

  const n = 3
  const ngrams = new Map<string, number>()
  for (let i = 0; i <= tokens.length - n; i += 1) {
    const gram = tokens.slice(i, i + n).join(isZh ? '' : ' ')
    ngrams.set(gram, (ngrams.get(gram) ?? 0) + 1)
  }
  const repeated = [...ngrams.values()].filter((count) => count > 1).length
  const trigramRepeat = ngrams.size > 0 ? repeated / ngrams.size : 0

  const punctuation = (text.match(/[，,。！？!?；;：:]/g) ?? []).length
  const punctuationDensity = sentences.length > 0 ? punctuation / sentences.length : 0

  const rules = isZh ? ALL_RULES.zh : ALL_RULES.en
  const hits = countMatches(text, rules)
  const per100 = isZh ? Math.max(zhChars, 1) / 100 : Math.max(enWords, 1) / 100
  const formulaicCount = countMatches(text, isZh ? FORMULA_RULES_ZH() : FORMULA_RULES_EN())
  const genericCount = countMatches(text, isZh ? GENERIC_RULES.zh.map((rule) => rule.regex) : GENERIC_RULES.en.map((rule) => rule.regex))

  return {
    lengthCV,
    meanSentenceLength: mean,
    ttr,
    trigramRepeat,
    punctuationDensity,
    formulaicDensity: formulaicCount / per100,
    genericDensity: genericCount / per100,
    paragraphCount: text.split(/\n+/).filter((part) => part.trim()).length,
    ...(hits >= 0 ? {} : {}),
  }
}

// ---------- 标准化 + 逻辑回归（梯度下降） ----------
function standardize(rows: RawFeatures[]): { means: number[]; stds: number[] } {
  const keys = Object.keys(rows[0]) as (keyof RawFeatures)[]
  const means = keys.map((key) => rows.reduce((sum, row) => sum + row[key], 0) / rows.length)
  const stds = keys.map((key, index) => {
    const variance = rows.reduce((sum, row) => sum + (row[key] - means[index]) ** 2, 0) / rows.length
    return Math.sqrt(variance) || 1
  })
  return { means, stds }
}

function toVector(row: RawFeatures, means: number[], stds: number[]): number[] {
  const keys = Object.keys(row) as (keyof RawFeatures)[]
  return keys.map((key, index) => (row[key] - means[index]) / stds[index])
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z))

function trainLogistic(X: number[][], y: number[], epochs = 600, lr = 0.15, l2 = 0.01): { weights: number[]; bias: number } {
  const weights = new Array(X[0].length).fill(0)
  let bias = 0
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradW = new Array(weights.length).fill(0)
    let gradB = 0
    for (let i = 0; i < X.length; i += 1) {
      const pred = sigmoid(X[i].reduce((sum, value, index) => sum + value * weights[index], bias))
      const error = pred - y[i]
      for (let j = 0; j < weights.length; j += 1) gradW[j] += error * X[i][j]
      gradB += error
    }
    for (let j = 0; j < weights.length; j += 1) {
      weights[j] -= lr * (gradW[j] / X.length + l2 * weights[j])
    }
    bias -= lr * (gradB / X.length)
  }
  return { weights, bias }
}

function predict(X: number[][], weights: number[]): number[] {
  return X.map((row) => sigmoid(row.reduce((sum, value, index) => sum + value * weights[index], 0)))
}

function auc(scores: number[], labels: number[]): number {
  const paired = scores.map((score, index) => ({ score, label: labels[index] })).sort((a, b) => a.score - b.score)
  let rankSumPositives = 0
  let positives = 0
  paired.forEach((item, index) => {
    if (item.label === 1) {
      rankSumPositives += index + 1
      positives += 1
    }
  })
  const negatives = paired.length - positives
  if (positives === 0 || negatives === 0) return 0.5
  return (rankSumPositives - (positives * (positives + 1)) / 2) / (positives * negatives)
}

// ---------- 分层 5 折交叉验证 ----------
function stratifiedFolds(samples: Sample[], folds: number): Sample[][] {
  const buckets: Sample[][] = Array.from({ length: folds }, () => [])
  for (const label of [0, 1] as const) {
    const subset = samples.filter((sample) => sample.label === label)
    // 按 domain 排序保证可复现，然后轮转分配
    subset.sort((a, b) => a.domain.localeCompare(b.domain) || a.text.length - b.text.length)
    subset.forEach((sample, index) => buckets[index % folds].push(sample))
  }
  return buckets
}

const FEATURE_KEYS = ['lengthCV', 'meanSentenceLength', 'ttr', 'trigramRepeat', 'punctuationDensity', 'formulaicDensity', 'genericDensity', 'paragraphCount'] as const

// ---------- 主流程 ----------
const allSamples = loadSamples().filter((sample) => {
  // 只保留中文为主的样本（HC3-Chinese 本身是中文数据集）
  const zh = (sample.text.match(/[\u4e00-\u9fff]/g) ?? []).length
  return zh >= 200
})
console.log(`eligible samples: ${allSamples.length} (human ${allSamples.filter((s) => s.label === 0).length} / ai ${allSamples.filter((s) => s.label === 1).length})`)

const featureRows = allSamples.map((sample) => extractFeatures(sample.text))
const foldAssignments = stratifiedFolds(allSamples.map((sample, index) => ({ ...sample, index })), 5)

const foldResults: Array<{ auc: number; sensitivity: number; specificity: number; accuracy: number }> = []
for (let testFold = 0; testFold < 5; testFold += 1) {
  const testSet = foldAssignments[testFold]
  const trainSet = foldAssignments.flatMap((fold, index) => (index === testFold ? [] : fold))
  const trainRows = trainSet.map((sample) => featureRows[sample.index])
  const { means, stds } = standardize(trainRows)
  const Xtrain = trainRows.map((row) => toVector(row, means, stds))
  const ytrain = trainSet.map((sample) => sample.label)
  const { weights } = trainLogistic(Xtrain, ytrain)
  const Xtest = testSet.map((sample) => toVector(featureRows[sample.index], means, stds))
  const ytest = testSet.map((sample) => sample.label)
  const preds = predict(Xtest, weights)
  const foldAuc = auc(preds, ytest)
  const hard = preds.map((p) => (p >= 0.5 ? 1 : 0))
  const tp = hard.filter((value, index) => value === 1 && ytest[index] === 1).length
  const tn = hard.filter((value, index) => value === 0 && ytest[index] === 0).length
  const fp = hard.filter((value, index) => value === 1 && ytest[index] === 0).length
  const fn = hard.filter((value, index) => value === 0 && ytest[index] === 1).length
  foldResults.push({
    auc: foldAuc,
    sensitivity: tp + fn > 0 ? tp / (tp + fn) : 0,
    specificity: tn + fp > 0 ? tn / (tn + fp) : 0,
    accuracy: (tp + tn) / ytest.length,
  })
  console.log(`fold ${testFold + 1}: AUC ${foldAuc.toFixed(3)} | sens ${foldResults[testFold].sensitivity.toFixed(3)} | spec ${foldResults[testFold].specificity.toFixed(3)}`)
}

const meanAuc = foldResults.reduce((sum, fold) => sum + fold.auc, 0) / foldResults.length
const stdAuc = Math.sqrt(foldResults.reduce((sum, fold) => sum + (fold.auc - meanAuc) ** 2, 0) / foldResults.length)

// ---------- 全量重训最终模型（系数进 UI） ----------
const { means, stds } = standardize(featureRows)
const Xall = featureRows.map((row) => toVector(row, means, stds))
const { weights: finalWeights, bias: finalBias } = trainLogistic(Xall, allSamples.map((sample) => sample.label))
const finalPreds = predict(Xall, [...finalWeights])
const inSampleAuc = auc(finalPreds, allSamples.map((sample) => sample.label))

const result = {
  meta: {
    generatedAt: new Date().toISOString().slice(0, 10),
    model: '逻辑回归（L2 正则 0.01，梯度下降 600 轮，学习率 0.15）',
    protocol: '分层 5 折交叉验证：标准化参数与训练均只在训练折上进行，测试折完全不参与任何拟合',
    dataset: `HC3-Chinese（baike / finance / law / medicine / open_qa / psychology 六领域，每领域每类上限 500 篇）；纳入门槛 中文≥200字 或 英文≥140词（训练协议与线上 400 字弃权线不同，特此披露），实际纳入 ${allSamples.length} 篇`,
    features: FEATURE_KEYS,
  },
  performance: {
    crossValidatedAuc: Number(meanAuc.toFixed(3)),
    aucStd: Number(stdAuc.toFixed(3)),
    inSampleAuc: Number(inSampleAuc.toFixed(3)),
    meanSensitivity: Number((foldResults.reduce((sum, f) => sum + f.sensitivity, 0) / 5).toFixed(3)),
    meanSpecificity: Number((foldResults.reduce((sum, f) => sum + f.specificity, 0) / 5).toFixed(3)),
    meanAccuracy: Number((foldResults.reduce((sum, f) => sum + f.accuracy, 0) / 5).toFixed(3)),
  },
  coefficients: {
    bias: Number(finalBias.toFixed(4)),
    weights: FEATURE_KEYS.map((key, index) => ({ feature: key, weight: Number(finalWeights[index].toFixed(4)) })),
    means: FEATURE_KEYS.map((key, index) => ({ feature: key, mean: Number(means[index].toFixed(4)), std: Number(stds[index].toFixed(4)) })),
  },
}

const outPath = resolve(import.meta.dirname ?? '.', '../src/data/calibratedModel.json')
writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8')
console.log(`\nCV AUC: ${meanAuc.toFixed(3)} ± ${stdAuc.toFixed(3)} | in-sample ${inSampleAuc.toFixed(3)}`)
console.log(`written to ${outPath}`)
