import { findPatternHits } from './patterns'
import { evaluateSpread } from './crosscheck'
import { CALIBRATED_MODEL_INFO, scoreCalibrated } from './calibrated'
import type {
  AnalysisOptions,
  AnalysisReport,
  CrossValidation,
  Language,
  Metric,
  PatternHit,
  RiskLevel,
  SentenceAnalysis,
  TextStats,
} from './types'

const VERSION = 'engine-v0.5.0'
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'for', 'with', 'as', 'by',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these', 'those',
  'i', 'we', 'you', 'they', 'he', 'she', 'their', 'our', 'my', 'your', 'from', 'at', 'not', 'can',
  'could', 'should', 'would', 'will', 'do', 'does', 'did', 'have', 'has', 'had', 'than', 'then',
])

const EVIDENCE_REGEX: Record<'zh' | 'en', RegExp> = {
  zh: /\d+(?:\.\d+)?%?|例如|比如|根据|研究(?:显示|表明)|调查|访谈|案例|实验|数据|文献|课堂笔记|图书馆|笔者|我们小组/g,
  en: /\b\d+(?:\.\d+)?%?\b|for example|for instance|according to|study (?:shows|found)|survey|interview|case study|experiment|data|literature|lecture notes|library|my experience|our group/gi,
}

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value))
const round = (value: number) => Math.round(clamp(value))
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) : 0

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0
  const average = mean(values)
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)))
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/\n+/)
    .flatMap((paragraph) => paragraph.match(/[^.!?。！？；;]+(?:[.!?。！？；;]+["'”’）)\]]*|$)/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
    .slice(0, 300)
}

function chineseCharacters(text: string): string[] {
  return text.match(/\p{Script=Han}/gu) ?? []
}

function englishWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]+(?:['’-][a-z]+)*/g) ?? [])
}

export function detectLanguage(text: string): Language {
  const zhCount = chineseCharacters(text).length
  const enCount = englishWords(text).length
  if (zhCount >= 20 && enCount >= 35 && enCount / Math.max(1, zhCount) > 0.35) return 'mixed'
  return zhCount > enCount * 1.5 ? 'zh' : 'en'
}

function measureSentence(sentence: string, language: Language): number {
  const zh = chineseCharacters(sentence).length
  const en = englishWords(sentence).length
  if (language === 'zh') return zh + en * 2
  if (language === 'en') return en + zh / 2
  return zh + en * 2
}

function chineseNgrams(text: string, size: number): string[] {
  const chunks = text.match(/\p{Script=Han}+/gu) ?? []
  return chunks.flatMap((chunk) => {
    if (chunk.length < size) return []
    return Array.from({ length: chunk.length - size + 1 }, (_, index) => chunk.slice(index, index + size))
  })
}

function englishNgrams(text: string, size: number): string[] {
  const words = englishWords(text)
  return Array.from({ length: Math.max(0, words.length - size + 1) }, (_, index) => {
    const gramWords = words.slice(index, index + size)
    return gramWords.every((word) => STOP_WORDS.has(word)) ? '' : gramWords.join(' ')
  }).filter(Boolean)
}

function getNgrams(text: string, language: Language): string[] {
  if (language === 'zh') return chineseNgrams(text, 4)
  if (language === 'en') return englishNgrams(text, 3)
  return [...chineseNgrams(text, 4), ...englishNgrams(text, 3)]
}

function getLexicalUnits(text: string, language: Language): string[] {
  if (language === 'zh') return chineseNgrams(text, 2)
  if (language === 'en') return englishWords(text).filter((word) => !STOP_WORDS.has(word))
  return [...chineseNgrams(text, 2), ...englishWords(text).filter((word) => !STOP_WORDS.has(word))]
}

function repeatedPhraseData(text: string, language: Language) {
  const ngrams = getNgrams(text, language)
  const counts = new Map<string, number>()
  ngrams.forEach((gram) => counts.set(gram, (counts.get(gram) ?? 0) + 1))
  const repeated = new Set([...counts.entries()].filter(([, count]) => count > 1).map(([gram]) => gram))
  const repeatedOccurrences = [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0)
  return { repeated, ratio: ngrams.length ? repeatedOccurrences / ngrams.length : 0 }
}

function sentenceHasRepeatedPhrase(sentence: string, language: Language, repeated: Set<string>): boolean {
  return getNgrams(sentence, language).some((gram) => repeated.has(gram))
}

function allPatternHits(sentences: string[], language: Language, type: 'formulaic' | 'generic'): PatternHit[] {
  const targetLanguages: Array<'zh' | 'en'> = language === 'mixed' ? ['zh', 'en'] : [language]
  return sentences.flatMap((sentence) => targetLanguages.flatMap((lang) => findPatternHits(sentence, lang, type)))
}

function evidenceHits(text: string, language: Language): string[] {
  const targetLanguages: Array<'zh' | 'en'> = language === 'mixed' ? ['zh', 'en'] : [language]
  return targetLanguages.flatMap((lang) => text.match(EVIDENCE_REGEX[lang]) ?? [])
}

function openingKey(sentence: string, language: Language): string {
  if (language === 'en') return englishWords(sentence)[0] ?? ''
  return chineseCharacters(sentence).slice(0, 2).join('') || englishWords(sentence)[0] || ''
}

function getLevel(score: number, sufficient: boolean): { level: RiskLevel; label: string } {
  if (!sufficient) return { level: 'insufficient', label: '样本不足 · 暂不判定' }
  if (score < 30) return { level: 'low', label: '较少模板化特征' }
  if (score < 55) return { level: 'moderate', label: '人机特征可能并存' }
  if (score < 75) return { level: 'elevated', label: '模板化特征较集中' }
  return { level: 'high', label: '高度集中的模板化特征' }
}

function buildSentenceAnalyses(
  sentences: string[],
  language: Language,
  averageLength: number,
  repeated: Set<string>,
): SentenceAnalysis[] {
  const targetLanguages: Array<'zh' | 'en'> = language === 'mixed' ? ['zh', 'en'] : [language]
  return sentences.map((text, index) => {
    const formulaicHits = targetLanguages.flatMap((lang) => findPatternHits(text, lang, 'formulaic'))
    const genericHits = targetLanguages.flatMap((lang) => findPatternHits(text, lang, 'generic'))
    const patternHits = [...formulaicHits, ...genericHits]
    const hasRepetition = sentenceHasRepeatedPhrase(text, language, repeated)
    const evidence = evidenceHits(text, language)
    const length = measureSentence(text, language)
    const closeToAverage = averageLength > 0 && Math.abs(length - averageLength) / averageLength < 0.16
    const score = round(
      8 + formulaicHits.length * 22 + genericHits.length * 17 + (hasRepetition ? 17 : 0) +
      (closeToAverage ? 8 : 0) + (evidence.length === 0 ? 7 : -10),
    )
    const reasons: string[] = []
    const suggestions: string[] = []
    const strengths: string[] = []

    formulaicHits.forEach((hit) => {
      reasons.push(`出现${hit.label}：“${hit.phrase}”`)
      suggestions.push(hit.suggestion)
    })
    genericHits.forEach((hit) => {
      reasons.push(`出现${hit.label}：“${hit.phrase}”`)
      suggestions.push(hit.suggestion)
    })
    if (hasRepetition) {
      reasons.push('含有在全文中重复出现的连续短语')
      suggestions.push('合并重复信息，让本句只承担一个新功能：提出判断、提供证据或解释证据。')
    }
    if (closeToAverage && sentences.length >= 5) reasons.push('句长接近全文均值，连续阅读时节奏可能较均匀')
    if (evidence.length > 0) strengths.push(`包含可核查线索：${[...new Set(evidence)].slice(0, 4).join('、')}`)
    if (/然而|但|不过|however|but|yet|although/i.test(text)) strengths.push('存在明确的转折或限定，论证并非单向罗列')
    if (evidence.length === 0 && score >= 30) {
      suggestions.push('若这是核心论点，补充来源、数据、文本证据或具体案例；若只是过渡句，可考虑删除。')
    }
    if (reasons.length === 0) reasons.push('未命中主要模板规则；这不等于证明由人创作')
    if (strengths.length === 0 && score < 30) strengths.push('没有明显的模板化堆叠，保留当前自然衔接')

    return {
      id: index + 1,
      text,
      score,
      level: score >= 55 ? 'priority' : score >= 30 ? 'review' : 'low',
      reasons: [...new Set(reasons)],
      suggestions: [...new Set(suggestions)],
      strengths: [...new Set(strengths)],
      patternHits,
    }
  })
}

export function analyzeText(text: string, options: AnalysisOptions): AnalysisReport {
  const normalized = text.trim()
  const sentences = splitSentences(normalized)
  const language = options.language === 'auto' ? detectLanguage(normalized) : options.language
  const zhCount = chineseCharacters(normalized).length
  const enCount = englishWords(normalized).length
  const stats: TextStats = {
    characters: normalized.length,
    chineseCharacters: zhCount,
    englishWords: enCount,
    sentences: sentences.length,
    paragraphs: normalized.split(/\n+/).filter((part) => part.trim()).length,
  }

  const lengths = sentences.map((sentence) => measureSentence(sentence, language))
  const averageLength = mean(lengths)
  const coefficientOfVariation = averageLength ? standardDeviation(lengths) / averageLength : 0
  const openings = sentences.map((sentence) => openingKey(sentence, language)).filter(Boolean)
  const openingCounts = new Map<string, number>()
  openings.forEach((opening) => openingCounts.set(opening, (openingCounts.get(opening) ?? 0) + 1))
  const repeatedOpeningRatio = openings.length ? Math.max(0, ...openingCounts.values()) / openings.length : 0
  const rhythmScore = round(clamp(100 - coefficientOfVariation / 0.55 * 100) * 0.78 + repeatedOpeningRatio * 22)

  const formulaicHits = allPatternHits(sentences, language, 'formulaic')
  const formulaicSentenceCount = sentences.filter((sentence) => {
    const targetLanguages: Array<'zh' | 'en'> = language === 'mixed' ? ['zh', 'en'] : [language]
    return targetLanguages.some((lang) => findPatternHits(sentence, lang, 'formulaic').length > 0)
  }).length
  const formulaicScore = round((formulaicSentenceCount / Math.max(1, sentences.length)) * 112 + (formulaicHits.length / Math.max(1, sentences.length)) * 12)

  const lexicalUnits = getLexicalUnits(normalized, language)
  const lexicalDiversity = lexicalUnits.length ? new Set(lexicalUnits).size / lexicalUnits.length : 0
  const repetitionData = repeatedPhraseData(normalized, language)
  const diversityFloor = language === 'en' ? 0.58 : 0.76
  const diversityRange = language === 'en' ? 0.35 : 0.42
  const lowDiversityScore = clamp((diversityFloor - lexicalDiversity) / diversityRange * 100)
  const repetitionScore = round(lowDiversityScore * 0.46 + repetitionData.ratio * 170)

  const genericHits = allPatternHits(sentences, language, 'generic')
  const genericSentenceCount = sentences.filter((sentence) => {
    const targetLanguages: Array<'zh' | 'en'> = language === 'mixed' ? ['zh', 'en'] : [language]
    return targetLanguages.some((lang) => findPatternHits(sentence, lang, 'generic').length > 0)
  }).length
  const abstractionScore = round((genericSentenceCount / Math.max(1, sentences.length)) * 112 + (genericHits.length / Math.max(1, sentences.length)) * 12)

  const concreteHitCount = evidenceHits(normalized, language).length
  const evidenceSentenceCount = sentences.filter((sentence) => evidenceHits(sentence, language).length > 0).length
  const lowSpecificityScore = round(96 - (evidenceSentenceCount / Math.max(1, sentences.length)) * 112 - (concreteHitCount / Math.max(1, sentences.length)) * 5)

  const metrics: Metric[] = [
    {
      id: 'rhythm', label: '句长节奏单一', englishLabel: 'Sentence uniformity', score: rhythmScore, weight: 0.20,
      description: '比较句长变异系数与重复开头。这里测量的是表层节奏，不是语言模型困惑度。',
      evidence: `句长变异系数 ${coefficientOfVariation.toFixed(2)}；最高重复开头占比 ${round(repeatedOpeningRatio * 100)}%。`,
    },
    {
      id: 'formulaic', label: '模板连接与套话', englishLabel: 'Formulaic phrasing', score: formulaicScore, weight: 0.25,
      description: '统计序列连接词、宏大开场、机械平衡与口号式结尾。命中不等于 AI 生成。',
      evidence: `${formulaicSentenceCount}/${sentences.length} 句命中，共 ${formulaicHits.length} 处可定位表达。`,
    },
    {
      id: 'repetition', label: '词汇与短语重复', englishLabel: 'Lexical repetition', score: repetitionScore, weight: 0.20,
      description: language === 'en' ? '结合实词多样性与英文三词短语重复率。' : '结合中文二字元多样性与四字连续片段重复率。',
      evidence: `词汇多样性 ${lexicalDiversity.toFixed(2)}；重复片段增量占比 ${round(repetitionData.ratio * 100)}%。`,
    },
    {
      id: 'abstraction', label: '抽象评价堆叠', englishLabel: 'Generic abstraction', score: abstractionScore, weight: 0.20,
      description: '识别“重要意义”“深远影响”等缺少主体、对象与验证标准的评价。',
      evidence: `${genericSentenceCount}/${sentences.length} 句命中，共 ${genericHits.length} 处抽象表达。`,
    },
    {
      id: 'specificity', label: '具体证据稀缺', englishLabel: 'Low specificity', score: lowSpecificityScore, weight: 0.15,
      description: '查找数字、引文、案例、调查与个人观察。此项只作弱证据，人写文本也可能没有引文。',
      evidence: `${evidenceSentenceCount}/${sentences.length} 句含可核查线索，共 ${concreteHitCount} 处。`,
    },
  ]

  const calibrated = scoreCalibrated(normalized)
  const detectors = [
    {
      id: 'lexicon' as const,
      name: '词表通道',
      englishName: 'Lexicon',
      family: '固定正则词表：模板连接词、套话与抽象评价',
      score: round(formulaicScore * 0.55 + abstractionScore * 0.45),
      detail: `套话命中 ${formulaicHits.length} 处，抽象评价命中 ${genericHits.length} 处。`,
    },
    {
      id: 'rhythm' as const,
      name: '节奏通道',
      englishName: 'Rhythm',
      family: '纯统计量：句长变异系数与重复开头，不读任何词表',
      score: rhythmScore,
      detail: `句长变异系数 ${coefficientOfVariation.toFixed(2)}。`,
    },
    {
      id: 'repetition' as const,
      name: '重复通道',
      englishName: 'Repetition',
      family: '纯统计量：n-gram 重复率与词汇多样性，不含语义',
      score: repetitionScore,
      detail: `词汇多样性 ${lexicalDiversity.toFixed(2)}，重复片段占比 ${round(repetitionData.ratio * 100)}%。`,
    },
    {
      id: 'specificity' as const,
      name: '证据通道',
      englishName: 'Evidence',
      family: '可核查线索密度：数字、来源、案例、个人观察',
      score: lowSpecificityScore,
      detail: `${evidenceSentenceCount}/${sentences.length} 句含可核查线索。`,
    },
    {
      id: 'calibrated' as const,
      name: '校准模型通道',
      englishName: 'Calibrated LR',
      family: `HC3-Chinese 训练的逻辑回归，留出折 AUC ${CALIBRATED_MODEL_INFO.cvAuc}±${CALIBRATED_MODEL_INFO.aucStd}`,
      score: calibrated.score,
      detail: `校准概率 ${(calibrated.probability * 100).toFixed(1)}%（8 特征逻辑回归，系数全公开；训练域为问答文本，论文场景可能偏移）。`,
    },
  ]
  const spreadVerdict = evaluateSpread(detectors.map((detector) => detector.score))
  const crossValidation: CrossValidation = {
    detectors,
    ...spreadVerdict,
    note:
      spreadVerdict.verdict === 'aligned'
        ? '五条通道（四条特征族 + 校准模型）给出相近读数，结论相对稳定。校准模型读数可解释为"与训练集中 AI 文本特征分布的相似概率"，仍不是作者身份判定。'
        : spreadVerdict.verdict === 'mixed'
          ? '各特征族读数不一致。这可能意味着文本风格混合（部分模板化 + 部分个人化），请以逐句批注为准，不要引用单一总分。'
          : '特征族之间严重分歧。此时任何检测网站给出的精确百分比（包括本站与商业检测器）都应被怀疑——请回到逐句证据自行判断。',
  }

  const score = round(metrics.reduce((sum, metric) => sum + metric.score * metric.weight, 0))
  // 充分性按语言分别判定：中英混排文本（如带大量英文术语的中文论文）
  // 只要任一语言达标即视为充分，不再因单一语言的字数被误判。
  const zhOk = zhCount >= 400
  const enOk = enCount >= 180
  const isSampleSufficient = (zhOk || enOk) && sentences.length >= 6
  const evidenceSufficiency = round(
    Math.min(1, Math.max(zhCount / 400, enCount / 180)) * 70 + Math.min(1, sentences.length / 8) * 30,
  )
  const missing: string[] = []
  if (!zhOk && !enOk) {
    missing.push(`中文 ${zhCount}/400 字（或英文 ${enCount}/180 词）`)
  }
  if (sentences.length < 6) missing.push(`句子 ${sentences.length}/6`)
  const sufficiencyHint = missing.length ? `还差：${missing.join('；')}` : ''
  const { level, label } = getLevel(score, isSampleSufficient)
  const evidenceLabel = evidenceSufficiency >= 80 ? '较充分' : evidenceSufficiency >= 50 ? '有限' : '不足'

  return {
    version: VERSION,
    createdAt: new Date().toISOString(),
    language,
    documentType: options.documentType,
    originalText: normalized,
    stats,
    score,
    level,
    levelLabel: label,
    evidenceSufficiency,
    evidenceLabel,
    isSampleSufficient,
    sufficiencyHint,
    metrics,
    calibratedScore: calibrated.score,
    crossValidation,
    sentenceAnalyses: buildSentenceAnalyses(sentences, language, averageLength, repetitionData.repeated),
    limitations: [
      `手调规则部分未经过语料校准（HC3 上 AUC 仅 0.515），校准模型通道在 HC3-Chinese 留出折上 AUC ${CALIBRATED_MODEL_INFO.cvAuc}，但训练域是问答文本而非学术论文，跨领域表现可能偏移。`,
      '非母语写作、规范化学术文体、翻译文本与短文本可能出现类似特征，不得据此推定作者身份或学术不端。',
      '检测结果应服务于作者自我修改与师生对话，不应作为处罚、处分或提交判定的唯一依据。',
    ],
  }
}
