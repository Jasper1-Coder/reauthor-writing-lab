/**
 * 跨域验证（cross-domain validation）—— 把校准模型拿到它从未见过的领域上考试。
 *
 * 训练集：HC3-Chinese（问答文本，2023 ChatGPT），主分数来自手调规则引擎。
 * 测试集：真实中文期刊论文摘要（软件学报，16 篇），每篇两个版本：
 *   - v0 = 100% 人类撰写（label 0）
 *   - v8 = ~94% DeepSeek 改写句（label 1，AI 文本）
 * 数据来源：johnson/AI-writing-detector-dataset（HuggingFace，Apache-2.0），
 *   按 doc_id 聚合成段落级文本后固化为 crossdomain/academic_zh.jsonl。
 *
 * 这是严格的域外测试：训练/测试数据集完全不同，领域不同（问答→学术摘要），
 * 生成器不同（ChatGPT→DeepSeek）。目的不是再报一个漂亮数字，而是回答那个
 * 我们一直诚实标注的边界问题："这套特征在学术文本上到底还灵不灵？"
 *
 * 运行：npx tsx scripts/crossdomain-test.ts
 * 输出：src/data/crossDomainValidation.json（直接进方法页）
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { scoreCalibrated } from '../src/lib/calibrated'
import { analyzeText } from '../src/lib/analyzer'

interface Sample {
  doc: string
  version: string
  label: 0 | 1
  chars: number
  zhChars: number
  sentences: number
  aiSentenceRatio: number
  text: string
}

const dataPath = resolve(import.meta.dirname ?? '.', '../crossdomain/academic_zh.jsonl')
const samples = readFileSync(dataPath, 'utf-8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Sample)

function auc(scores: number[], labels: number[]): number {
  const paired = scores.map((score, index) => ({ score, label: labels[index] })).sort((a, b) => a.score - b.score)
  let rankSum = 0
  let positives = 0
  paired.forEach((item, index) => {
    if (item.label === 1) { rankSum += index + 1; positives += 1 }
  })
  const negatives = paired.length - positives
  if (!positives || !negatives) return 0.5
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives)
}

function metricsAtThreshold(scores: number[], labels: number[], threshold: number) {
  const hard = scores.map((s) => (s >= threshold ? 1 : 0))
  const tp = hard.filter((v, i) => v === 1 && labels[i] === 1).length
  const tn = hard.filter((v, i) => v === 0 && labels[i] === 0).length
  const fp = hard.filter((v, i) => v === 1 && labels[i] === 0).length
  const fn = hard.filter((v, i) => v === 0 && labels[i] === 1).length
  return {
    sensitivity: tp + fn ? Number((tp / (tp + fn)).toFixed(3)) : 0,
    specificity: tn + fp ? Number((tn / (tn + fp)).toFixed(3)) : 0,
    accuracy: Number(((tp + tn) / labels.length).toFixed(3)),
    confusion: { tp, tn, fp, fn },
  }
}

const labels = samples.map((s) => s.label)
const calibratedScores = samples.map((s) => scoreCalibrated(s.text).score)
const ruleScores = samples.map((s) => analyzeText(s.text, { language: 'zh', documentType: 'academic' }).score)

// 逐篇配对明细（公开可复核：每篇论文的 v0 人写分 vs v8 AI 改写分）
const perDoc = [...new Set(samples.map((s) => s.doc))].sort().map((doc) => {
  const hi = samples.findIndex((s) => s.doc === doc && s.label === 0)
  const ai = samples.findIndex((s) => s.doc === doc && s.label === 1)
  return {
    doc,
    humanScore: calibratedScores[hi],
    aiScore: calibratedScores[ai],
    delta: calibratedScores[ai] - calibratedScores[hi],
    ruleHuman: ruleScores[hi],
    ruleAi: ruleScores[ai],
  }
})

const result = {
  meta: {
    generatedAt: new Date().toISOString().slice(0, 10),
    source: 'johnson/AI-writing-detector-dataset (HuggingFace, Apache-2.0), zh 子集 test',
    sourceDocType: '中文期刊论文摘要（软件学报），真实人类原文 + DeepSeek 句级改写',
    construction: '按 doc_id 将句级样本聚合成段落级文本；v0=100% human，v8≈94% DeepSeek 改写句。16 篇 × 2 版本 = 32 段。',
    sampleCount: samples.length,
    humanCount: labels.filter((l) => l === 0).length,
    aiCount: labels.filter((l) => l === 1).length,
    humanZhRange: [Math.min(...samples.filter((s) => s.label === 0).map((s) => s.zhChars)), Math.max(...samples.filter((s) => s.label === 0).map((s) => s.zhChars))],
    trainDomain: 'HC3-Chinese 问答文本（ChatGPT）',
    testDomain: '中文学术论文摘要（DeepSeek 改写）',
    whyItMatters: '训练域与应用域不同，是本站一直公开标注的边界；此测试用完全未见过的领域与生成器检验特征是否仍有效。',
  },
  calibrated: {
    auc: Number(auc(calibratedScores, labels).toFixed(3)),
    at50: metricsAtThreshold(calibratedScores, labels, 50),
    // 领域偏移下绝对分数普遍下移，故同时公布"相对排序"与"最优阈值"两种读法，
    // 后者仅用于说明信号存在，不作为线上固定阈值（会造成测试集拟合）。
    bestThreshold: (() => {
      let best = { threshold: 50, acc: 0, sens: 0, spec: 0 }
      for (let t = 1; t <= 99; t += 1) {
        const m = metricsAtThreshold(calibratedScores, labels, t)
        if (m.accuracy > best.acc) best = { threshold: t, acc: m.accuracy, sens: m.sensitivity, spec: m.specificity }
      }
      return best
    })(),
    humanMean: Number((calibratedScores.filter((_, i) => labels[i] === 0).reduce((a, b) => a + b, 0) / labels.filter((l) => l === 0).length).toFixed(1)),
    aiMean: Number((calibratedScores.filter((_, i) => labels[i] === 1).reduce((a, b) => a + b, 0) / labels.filter((l) => l === 1).length).toFixed(1)),
    humanMax: Math.max(...calibratedScores.filter((_, i) => labels[i] === 0)),
    aiMin: Math.min(...calibratedScores.filter((_, i) => labels[i] === 1)),
  },
  ruleEngine: {
    auc: Number(auc(ruleScores, labels).toFixed(3)),
    at55: metricsAtThreshold(ruleScores, labels, 55),
    humanMean: Number((ruleScores.filter((_, i) => labels[i] === 0).reduce((a, b) => a + b, 0) / labels.filter((l) => l === 0).length).toFixed(1)),
    aiMean: Number((ruleScores.filter((_, i) => labels[i] === 1).reduce((a, b) => a + b, 0) / labels.filter((l) => l === 1).length).toFixed(1)),
  },
  perDoc,
}

const outPath = resolve(import.meta.dirname ?? '.', '../src/data/crossDomainValidation.json')
writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8')

console.log('=== 跨域验证：HC3 问答训练 → 学术摘要测试 ===')
console.log(`样本 ${result.meta.sampleCount} 段（human ${result.meta.humanCount} / AI ${result.meta.aiCount}）`)
console.log(`校准模型 AUC ${result.calibrated.auc} | sens ${result.calibrated.at50.sensitivity} spec ${result.calibrated.at50.specificity} | 人写均分 ${result.calibrated.humanMean} / AI 均分 ${result.calibrated.aiMean}`)
console.log(`规则引擎 AUC ${result.ruleEngine.auc} | 人写均分 ${result.ruleEngine.humanMean} / AI 均分 ${result.ruleEngine.aiMean}`)
console.log(`written to ${outPath}`)
