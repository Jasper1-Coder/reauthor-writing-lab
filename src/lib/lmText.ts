/**
 * 语言模型通道的文本归一化 —— 训练与线上推理**必须共用这一份**，
 * 否则训练/推理口径漂移，AUC 会悄悄掉下来。
 *
 * 规则（消融实验验证过）：
 *   - 保留汉字（含扩展A）、拉丁字母、数字、常见停连标点、空格
 *   - 拉丁字母统一小写（避免大小写制造虚假特征）
 *   - 空白压缩为单个空格
 *   - 其余字符（emoji、markdown 符号、特殊标点）一律丢弃
 *
 * 为什么不删数字：「1. 2. 3.」这类列表编号是 ChatGPT 的排版习惯，
 * 删掉后域内 AUC 只从 0.963 掉到 0.961，说明模型的判别力不依赖它。
 */
const PUNCT = new Set([',', '.', '!', '?', ';', ':', '，', '。', '！', '？', '；', '：', '、', '（', '）', '(', ')', '“', '”', '"', "'", '‘', '’'])

export function normalizeLm(text: string): string {
  let out = ''
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    const isCjk = (c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)
    const isLower = c >= 0x61 && c <= 0x7a
    const isUpper = c >= 0x41 && c <= 0x5a
    const isDigit = c >= 0x30 && c <= 0x39
    if (isCjk || isLower) out += ch
    else if (isUpper) out += ch.toLowerCase()
    else if (isDigit) out += ch
    else if (PUNCT.has(ch)) out += ch
    else if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') out += ' '
  }
  return out.replace(/ +/g, ' ').trim()
}

/** FNV-1a：与训练脚本一致的哈希，bits 决定表大小 */
export function lmHash(ch: string, salt: number): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < ch.length; i++) {
    h ^= ch.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** bigram 桶索引：(当前字, 前一个字) */
export function bigramBucket(prev: string, cur: string, mask: number): number {
  return (lmHash(cur, 7) ^ lmHash(prev, 13)) & mask
}

/** 模型阶数：2 = 只看前一个字（实测与 3 阶只差 0.004 AUC，体积省一半） */
export const LM_ORDER = 2
export const LM_BITS = 19
export const LM_TABLE_SIZE = 1 << LM_BITS
export const LM_MASK = LM_TABLE_SIZE - 1

/** 计数 → uint8 的对数量化：q = round(log2(cnt+1) × 10)，上限 255 */
export function quantizeCount(cnt: number): number {
  if (cnt <= 0) return 0
  const q = Math.round(Math.log2(cnt + 1) * 10)
  return q > 255 ? 255 : q
}

/** 反量化查表：q ∈ [0,255] → 计数（浮点，保留小数以减小误差） */
export const DEQUANT: Float32Array = (() => {
  const t = new Float32Array(256)
  for (let q = 0; q < 256; q++) t[q] = q === 0 ? 0 : Math.pow(2, q / 10) - 1
  return t
})()

/** 插值权重：p = W2·p2 + W1·p1（与训练脚本一致） */
export const LM_W2 = 0.8
export const LM_W1 = 0.2

/** 单条文本的句级切分：按句末标点与换行，过滤过短碎片 */
export function splitSentencesLm(text: string): string[] {
  return text
    .split(/[。！？.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8)
}
