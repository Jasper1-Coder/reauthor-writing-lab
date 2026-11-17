import lmMeta from '../data/lmModel.json'
import lmValid from '../data/lmValidation.json'
import lmMetaModern from '../data/lmModelModern.json'
import lmValidModern from '../data/lmValidationModern.json'
import lmEcdf from '../data/lmEcdf.json'
import {
  DEQUANT,
  LM_MASK,
  LM_TABLE_SIZE,
  LM_W1,
  LM_W2,
  bigramBucket,
  normalizeLm,
  splitSentencesLm,
} from './lmText'

/**
 * 语言模型通道 —— 本项目第一个真正「训练出来的模型」。
 *
 * 训练阶段（scripts/train-lm.ts）在 4.3 万篇真实语料上分别训练了两个字符级
 * 2-gram 语言模型：一个只读真人写作，一个只读 AI 写作。对任意文本，计算
 * 它在两个模型下的平均对数概率之差（对数似然比）：
 *
 *   delta = logP(文本 | AI 模型) − logP(文本 | 真人模型)
 *
 * delta 越大，说明这段文字更「可被 AI 文风模型预测」，也就是更像训练语料里的
 * AI 写法。再经过 Platt 标定映射到 0–100。
 *
 * 为什么是 2-gram 而不是神经网络：0.5B 级模型要下载数百 MB 且依赖 WebGPU，
 * 在手机和不稳定网络下不可用（v0.5 试过，生产环境直接崩）。字符 2-gram 消融实测
 * 与 3-gram 的域内 AUC 只差 0.004（scripts/probe-ablate.ts），体积却省一半，
 * 1.1MB、毫秒级、纯 JS。
 *
 * 必须同步展示的边界（数字一律来自 src/data/lmValidation.json，不在此硬编码，
 * 避免又出现「页面写一套、数据另一套」的漂移）：
 *  1. 域内 AUC 高，但跨到学术论文接近随机（0.5 上下）—— 与所有表层统计检测器一样会失效。
 *  2. 阈值 50 时特异度只有约四分之三，即约四分之一真人文本会被判高。
 *  3. 训练语料的 AI 文本是 2023 年初的 ChatGPT，不代表 2026 年的新模型。
 *  4. 个别域（如 open_qa）模型 AUC 甚至低于「只看文本长度」这一表层特征，
 *     说明那部分判别力来自篇幅/排版，不是文风。字段 inDomain.formatBaseline。
 * 因此本通道读数只能作为「文风接近程度」的参考，不能推断作者身份。
 */

export const LM_MODEL_LABEL = '语言模型通道 · 字符 2-gram 双模型（真人 / AI 各一个，本地推理）'

export interface LmSentenceReading {
  text: string
  score: number
  delta: number
}

/**
 * 百分位的参照系：问答体真人分布 / 作文体真人分布。
 * 必须分开——真人作文的 delta 比问答体真人低 1.85 个标准差（p50 −1.23 vs −0.26），
 * 用问答基线去量作文，会把所有文本推到接近 100 百分位。
 */
export type LmBaseline = 'qa' | 'essay'

/**
 * 选参照系。本站的产品定位是给学生的作业与作文用，所以中文长文默认走作文基线；
 * 英文或短文本走问答基线（那是训练语料本来的体裁）。
 * 规则故意保持简单可解释：中文字符占比 ≥ 50% 且长度 ≥ 200 字 → 作文。
 */
export function pickBaseline(text: string): LmBaseline {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const ratio = cjk / Math.max(1, text.length)
  return ratio >= 0.5 && text.length >= 200 ? 'essay' : 'qa'
}

const ECDF_QA = (lmEcdf as { qa: number[] }).qa
const ECDF_ESSAY = (lmEcdf as { essay: number[] }).essay

/**
 * 把原始 delta 换算成「在同类真人文本中的百分位」（0–100）。
 *
 * 为什么不用固定的 Platt 曲线：Platt 参数是在问答体上拟合的，换到作文体裁整条曲线平移，
 * 「50 分」不再对应任何有意义的操作点——实测 12 篇 AI 腔中文作文全部落在 20 分以下，
 * 而同一批文本按百分位排，全部落在 96 百分位以上。分数是相对的，参照系必须同体裁。
 */
export function percentileOf(delta: number, baseline: LmBaseline): number {
  const table = baseline === 'essay' ? ECDF_ESSAY : ECDF_QA
  if (!table?.length) return 0
  let lo = 0
  let hi = table.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (table[mid] < delta) lo = mid + 1
    else hi = mid
  }
  return Math.min(100, Math.round((lo / (table.length - 1)) * 100))
}

const atP = (table: number[], p: number) => table[Math.round(p * (table.length - 1))]

/** 百分位参照系的公开信息（供方法页与结果卡展示） */
export const LM_ECDF_REFERENCE = {
  /** 两条提示线：超过它就意味着「比 95% / 99% 的同类真人文本更像 AI」 */
  qaP95: atP(ECDF_QA, 0.95),
  qaP99: atP(ECDF_QA, 0.99),
  essayP95: atP(ECDF_ESSAY, 0.95),
  essayP99: atP(ECDF_ESSAY, 0.99),
  counts: (lmEcdf as { meta?: { counts?: { qa: number; essay: number } } }).meta?.counts ?? { qa: 0, essay: 0 },
  /** 百分位口径自己的局限（与模型卡 caveats 分开展示，避免互相掩盖） */
  limitations: (lmEcdf as { meta?: { limitations?: string[] } }).meta?.limitations ?? [],
  builtAt: (lmEcdf as { meta?: { builtAt?: string } }).meta?.builtAt ?? '',
}

export interface LmChannelResult {
  available: boolean
  /** 0–100 标定读数，越大越接近训练语料中的 AI 文风 */
  score: number
  /** 对数似然比（AI 模型 − 真人模型），原始值，未标定 */
  delta: number
  humanLogp: number
  aiLogp: number
  /** 句级读数的标准差：AI 文本通常更均匀 */
  burstiness: number
  sentences: LmSentenceReading[]
  tokens: number
  /** 两种 AI 方言各自给出的读数（取较高者作为 score） */
  dialects?: { chatgpt2023: number | null; modern: number | null }
  /** 哪一个方言更接近（用于向学生解释这句为什么被判高） */
  closestDialect?: 'chatgpt2023' | 'modern'
  /**
   * 该文本在「同类真人文本」中的百分位（0–100）：越大越偏离真人写作的常态。
   * 这是跨体裁可靠的那个读数——绝对值随体裁平移，百分位不会。
   */
  percentile?: number
  /** 百分位的参照系 */
  baseline?: LmBaseline
}

export const LM_REFERENCE = {
  cvAuc: lmValid.inDomain.cvAucMean,
  cvAucStd: lmValid.inDomain.cvAucStd,
  holdoutAuc: lmValid.inDomain.holdoutAuc,
  holdoutN: lmValid.inDomain.holdoutN,
  macroAuc: lmValid.inDomain.macroAucOverDomains,
  sensitivity: lmValid.inDomain.atThreshold50.sensitivity,
  specificity: lmValid.inDomain.atThreshold50.specificity,
  crossDomainAuc: lmValid.crossDomain?.auc ?? null,
  crossDomainN: lmValid.crossDomain?.n ?? 0,
  /** 模型跑不过「只看长度」的表层基线时，训练脚本会写入该域（红队审计要求披露） */
  formatBaseline: (lmValid.inDomain as { formatBaseline?: { domain: string; modelAuc: number; lengthAuc: number; gap: number } | null }).formatBaseline ?? null,
  /**
   * 分生成器成绩。学生真正关心的是「能不能认出现在这些模型写的」，
   * 整体 AUC 会把 2023 ChatGPT 与现代模型混成一个数，必须拆开展示。
   */
  byGenerator: (lmValid as {
    byGenerator?: {
      humanVsModern: { n: number; ai: number; human: number; auc: number; recall50: number } | null
      humanVsChatGpt2023: { n: number; ai: number; human: number; auc: number; recall50: number } | null
    }
  }).byGenerator ?? { humanVsModern: null, humanVsChatGpt2023: null },
  trainedDocs: Number(/清洗后 (\d+) 篇/.exec(lmValid.meta.dataset)?.[1] ?? 0),
  sizeMB: Number((lmMeta.sizeBytes / 1e6).toFixed(2)),
  gzKB: Math.round(((lmMeta as { sizeGzBytes?: number }).sizeGzBytes ?? 0) / 1024),
  caveats: lmValid.caveats as string[],
}

/** 现代方言的参考指标（与基座同结构，页面按方言分别展示） */
export const LM_REFERENCE_MODERN = {
  holdoutAuc: lmValidModern.inDomain.holdoutAuc,
  holdoutN: lmValidModern.inDomain.holdoutN,
  cvAucMean: lmValidModern.inDomain.cvAucMean,
  cvAucStd: lmValidModern.inDomain.cvAucStd,
  sensitivity: lmValidModern.inDomain.atThreshold50.sensitivity,
  specificity: lmValidModern.inDomain.atThreshold50.specificity,
  crossDomainAuc: lmValidModern.crossDomain?.auc ?? null,
  crossDomainN: lmValidModern.crossDomain?.n ?? 0,
  trainedDocs: Number(/清洗后 (\d+) 篇/.exec(lmValidModern.meta.dataset)?.[1] ?? 0),
  recall50: (lmValidModern as { byGenerator?: { humanVsModern?: { recall50: number } | null } }).byGenerator?.humanVsModern?.recall50 ?? null,
  sizeMB: Number(((lmMetaModern as { sizeBytes?: number }).sizeBytes ?? 0) / 1e6),
  gzKB: Math.round(((lmMetaModern as { sizeGzBytes?: number }).sizeGzBytes ?? 0) / 1024),
  caveats: lmValidModern.caveats as string[],
}

const LM_FILE = lmMeta.file
const LM_FILE_MODERN = (lmMetaModern as { file?: string }).file ?? 'lm-char2-modern.bin'
const CAL: Cal = lmMeta.calibration
const CAL_MODERN: Cal = (lmMetaModern as { calibration?: Cal }).calibration ?? CAL

interface RuntimeModel {
  /** Unicode 码点 → unigram 下标 */
  index: Map<number, number>
  unigram: Float32Array
  table: Uint8Array
  total: number
}

interface Cal { mean: number; std: number; a: number; b: number }

export interface LmModel {
  human: RuntimeModel
  ai: RuntimeModel
  /** 该产物自己的 Platt 参数（两个方言各有各的标定，缺省回落到基座产物） */
  cal?: Cal
}

function parseModel(buf: ArrayBuffer, offset: number, vocab: number, total: number): { model: RuntimeModel; next: number } {
  const view = new DataView(buf)
  const index = new Map<number, number>()
  const unigramRaw = new Float32Array(vocab)
  let p = offset
  const codes: number[] = []
  for (let i = 0; i < vocab; i++) {
    codes.push(view.getUint32(p, true))
    p += 4
  }
  let sum = 0
  for (let i = 0; i < vocab; i++) {
    const v = view.getUint32(p, true)
    p += 4
    unigramRaw[i] = v
    sum += v
    index.set(codes[i], i)
  }
  const table = new Uint8Array(buf, p, LM_TABLE_SIZE)
  p += LM_TABLE_SIZE
  // 训练时的总字符数以产物为准（含未进 vocab 的稀有字），这里以元数据为准
  const total2 = total || sum
  return { model: { index, unigram: unigramRaw, table, total: total2 }, next: p }
}

let modelPromise: Promise<LmModel | null> | null = null

/**
 * 取模型二进制。
 * 优先拿预压缩版（约 342KB），用 DecompressionStream 在本地解开；
 * 浏览器不支持或解压失败时回落到 1.12MB 的原始文件。
 * 这样既照顾慢网，也不会在旧浏览器上直接崩。
 */
async function fetchModelBuffer(file: string): Promise<ArrayBuffer | null> {
  const plain = new URL(file, document.baseURI).href
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const res = await fetch(`${plain}.gz`)
      if (res.ok && res.body) {
        const stream = res.body.pipeThrough(new DecompressionStream('gzip'))
        const buf = await new Response(stream).arrayBuffer()
        if (buf.byteLength > 1000) return buf
      }
    } catch {
      // 忽略，走下面的回退
    }
  }
  try {
    const res = await fetch(plain)
    return res.ok ? await res.arrayBuffer() : null
  } catch {
    return null
  }
}

function parseBinary(buf: ArrayBuffer, meta: { models: Array<{ chars: number }> }, cal: Cal): LmModel | null {
  try {
    const view = new DataView(buf)
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
    if (magic !== 'RALM') return null
    const vocabH = view.getUint32(8, true)
    const vocabA = view.getUint32(12, true)
    const h = parseModel(buf, 24, vocabH, meta.models[0].chars)
    const a = parseModel(buf, h.next, vocabA, meta.models[1].chars)
    return { human: h.model, ai: a.model, cal }
  } catch {
    return null
  }
}

/**
 * 两种 AI 方言各一个产物：
 *   lm-char2.bin        = 人写 vs 2023 ChatGPT（HC3 原生）
 *   lm-char2-modern.bin = 人写 vs 2025–26 现代模型（同题重生成）
 * 2026 年的「AI 文风」是两种方言，一个模型装不下——实测单模型混合时，
 * 认 2023 好则现代召回只有 62.8%，认现代好则 2023 掉到 45%（顾此失彼）。
 * 所以各训一个、各算一个读数，取更接近的那个。
 */
export function loadLmModel(): Promise<LmModel | null> {
  if (modelPromise) return modelPromise
  modelPromise = (async () => {
    const buf = await fetchModelBuffer(LM_FILE)
    return buf ? parseBinary(buf, lmMeta, CAL) : null
  })()
  return modelPromise
}

let modernPromise: Promise<LmModel | null> | null = null
export function loadLmModernModel(): Promise<LmModel | null> {
  if (modernPromise) return modernPromise
  modernPromise = (async () => {
    const buf = await fetchModelBuffer(LM_FILE_MODERN)
    return buf ? parseBinary(buf, lmMetaModern as { models: Array<{ chars: number }> }, CAL_MODERN) : null
  })()
  return modernPromise
}

/** 平均对数概率（负交叉熵），与 scripts/train-lm.ts 的 meanLogp 严格同口径 */
function meanLogp(model: RuntimeModel, normalized: string): number {
  const n = normalized.length
  if (n < 3) return -20
  let sum = 0
  let count = 0
  let prevIdx = model.index.get(normalized.codePointAt(0) ?? 0) ?? -1
  for (let i = 1; i < n; i++) {
    const cp = normalized.codePointAt(i) ?? 0
    const idx = model.index.get(cp) ?? -1
    const u = idx >= 0 ? model.unigram[idx] : 0
    const p1 = u > 0 ? u / model.total : 1e-9
    let p2 = 0
    if (prevIdx >= 0) {
      const q = model.table[bigramBucket(normalized[i - 1], normalized[i], LM_MASK)]
      const cnt = DEQUANT[q]
      const ctx = model.unigram[prevIdx]
      if (cnt >= 1 && ctx > 0) p2 = cnt / ctx
    }
    const p = LM_W2 * p2 + LM_W1 * p1
    sum += Math.log2(Math.max(p, 1e-9))
    count++
    prevIdx = idx
  }
  return count > 0 ? sum / count : -20
}

function deltaOf(model: LmModel, normalized: string): { delta: number; humanLogp: number; aiLogp: number } {
  const humanLogp = meanLogp(model.human, normalized)
  const aiLogp = meanLogp(model.ai, normalized)
  return { delta: aiLogp - humanLogp, humanLogp, aiLogp }
}

/** 似然比 → 0–100（Platt 标定，参数由训练脚本在 OOF 预测上拟合） */
export function calibrateDelta(delta: number, cal: Cal = CAL): number {
  const z = (delta - cal.mean) / cal.std
  const s = 100 / (1 + Math.exp(-(cal.a * z + cal.b)))
  return Math.round(Math.min(100, Math.max(0, s)))
}

/** 纯函数核心：给定模型与文本，产出通道读数。测试直接喂构造模型。 */
export function scoreLmText(model: LmModel, text: string): LmChannelResult {
  const normalized = normalizeLm(text)
  if (normalized.length < 20) {
    return {
      available: false,
      score: 0,
      delta: 0,
      humanLogp: 0,
      aiLogp: 0,
      burstiness: 0,
      sentences: [],
      tokens: normalized.length,
    }
  }
  const whole = deltaOf(model, normalized)
  const sentences: LmSentenceReading[] = []
  for (const raw of splitSentencesLm(text)) {
    const norm = normalizeLm(raw)
    if (norm.length < 8) continue
    const d = deltaOf(model, norm)
    sentences.push({ text: raw, score: calibrateDelta(d.delta, model.cal ?? CAL), delta: Number(d.delta.toFixed(4)) })
  }
  const deltas = sentences.map((s) => s.delta)
  const mean = deltas.length > 0 ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0
  const variance = deltas.length > 1
    ? deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / deltas.length
    : 0
  return {
    available: true,
    score: calibrateDelta(whole.delta, model.cal ?? CAL),
    delta: Number(whole.delta.toFixed(4)),
    humanLogp: Number(whole.humanLogp.toFixed(4)),
    aiLogp: Number(whole.aiLogp.toFixed(4)),
    burstiness: Number(Math.sqrt(variance).toFixed(4)),
    sentences: sentences.sort((a, b) => b.score - a.score).slice(0, 8),
    tokens: normalized.length,
  }
}

/**
 * 便捷入口：两种方言都加载，各算一个读数，取更高者。
 * 取高而不是取平均，是因为「像 2023 ChatGPT」和「像 2026 现代模型」是两条独立的证据：
 * 只要有一种方言高度吻合，就值得让学生回头看这段文字。平均会把两条证据互相抵消。
 * 任一产物加载失败都不影响另一个（降级为单方言读数，页面会显示可用方言数）。
 */
export async function runLmChannel(text: string): Promise<LmChannelResult | null> {
  const [base, modern] = await Promise.all([loadLmModel(), loadLmModernModel()])
  const results: Array<{ key: 'chatgpt2023' | 'modern'; r: LmChannelResult }> = []
  if (base) {
    const r = scoreLmText(base, text)
    if (r.available) results.push({ key: 'chatgpt2023', r })
  }
  if (modern) {
    const r = scoreLmText(modern, text)
    if (r.available) results.push({ key: 'modern', r })
  }
  if (results.length === 0) return null
  // 按原始 delta 选方言，不按 score 选：score 经过 Math.round 取整，
  // 真人文本大量并列在 0–3 分，按 score 取最大会把排序压平
  // （实测同一批文本：按 score 取最大 AUC 0.888，按 delta 取最大 0.981）。
  const winner = results.reduce((a, b) => (b.r.delta > a.r.delta ? b : a))
  const baseline = pickBaseline(text)
  return {
    ...winner.r,
    percentile: percentileOf(winner.r.delta, baseline),
    baseline,
    dialects: {
      chatgpt2023: results.find((x) => x.key === 'chatgpt2023')?.r.score ?? null,
      modern: results.find((x) => x.key === 'modern')?.r.score ?? null,
    },
    closestDialect: winner.key,
  }
}
