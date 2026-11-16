import type { RetrievalChannelResult, RetrievalNeighbor } from './types'

/**
 * 语料基座检索通道（零 AI 模型）
 *
 * 与神经通道的本质区别：不训练、不下载、不推理。它只回答一个可核查的问题——
 *   「在 6010 段真实语料中，你的文本最像哪 15 段？其中多少人写、多少 AI 写？」
 *
 * 全部计算是确定性的字符 bigram 哈希 + TF-IDF 余弦相似度，浏览器本地完成。
 * 向量化常量必须与 scripts/build-retrieval-index.ts 完全一致，否则分数失配。
 */
export const RETRIEVAL_FORMULA =
  '字符 bigram + TF-IDF 余弦相似度，检索 HC3 中文基座 6010 段真实语料的 top15 近邻；分数 = 近邻中 AI 标签的相似度加权占比'
export const RETRIEVAL_CORPUS_LABEL = 'HC3-Chinese 真实问答语料 · 6010 段（人写 vs ChatGPT）· 本地检索，零模型零联网'

interface RetrievalIndex {
  version: number
  dims: number
  docCount: number
  idf: number[]
  labels: number[]
  docs: number[][]
  excerpts: string[]
  meta: { source: string; method: string; topKDims: number; builtAt: string }
}

interface PreparedIndex {
  raw: RetrievalIndex
  postings: Map<number, Array<{ i: number; w: number }>>
  norms: Float64Array
}

function bigrams(text: string): string[] {
  const t = text.replace(/\s+/g, '')
  const out: string[] = []
  for (let i = 0; i < t.length - 1; i += 1) out.push(t.slice(i, i + 2))
  return out
}

function hash(str: string, dims: number): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % dims
}

/** 把文本转成查询向量（加权 TF-IDF），纯函数、可独立测试 */
export function buildQueryVector(text: string, idf: number[], dims: number): Map<number, number> {
  const tf = new Map<number, number>()
  for (const g of bigrams(text)) {
    const d = hash(g, dims)
    tf.set(d, (tf.get(d) ?? 0) + 1)
  }
  const vector = new Map<number, number>()
  for (const [dim, count] of tf) {
    const w = (1 + Math.log(count)) * (idf[dim] ?? 0)
    if (w > 0) vector.set(dim, w)
  }
  return vector
}

/** 预处理索引：建倒排表 + 预算范数（一次，缓存） */
export function prepareIndex(raw: RetrievalIndex): PreparedIndex {
  const postings = new Map<number, Array<{ i: number; w: number }>>()
  const norms = new Float64Array(raw.docCount)
  for (let i = 0; i < raw.docCount; i += 1) {
    const v = raw.docs[i]
    let normSq = 0
    for (let k = 0; k < v.length; k += 2) {
      const dim = v[k]
      const w = (v[k + 1] / 100) * (raw.idf[dim] ?? 0)
      let arr = postings.get(dim)
      if (!arr) { arr = []; postings.set(dim, arr) }
      arr.push({ i, w })
      normSq += w * w
    }
    norms[i] = Math.sqrt(normSq) || 1
  }
  return { raw, postings, norms }
}

export interface RetrievalOutcome {
  score: number
  aiRatio: number
  coverage: number
  neighbors: RetrievalNeighbor[]
  corpusSize: number
}

/** 用已预处理的索引检索，返回分数与可解释的最近邻（纯函数、可独立测试） */
export function retrieve(queryVector: Map<number, number>, index: PreparedIndex, topK = 15): RetrievalOutcome {
  const { raw, postings, norms } = index
  let qNormSq = 0
  for (const w of queryVector.values()) qNormSq += w * w
  const qNorm = Math.sqrt(qNormSq) || 1

  const acc = new Float64Array(raw.docCount)
  for (const [dim, w] of queryVector) {
    const arr = postings.get(dim)
    if (!arr) continue
    for (const { i, w: dw } of arr) acc[i] += w * dw
  }

  const scored: Array<{ i: number; s: number }> = []
  for (let i = 0; i < raw.docCount; i += 1) {
    const s = acc[i] / (qNorm * norms[i])
    if (s > 0) scored.push({ i, s })
  }
  scored.sort((a, b) => b.s - a.s)
  const top = scored.slice(0, topK)
  const denom = top.reduce((a, b) => a + b.s, 0)
  const aiRatio = denom ? top.reduce((a, b) => a + b.s * raw.labels[b.i], 0) / denom : 0.5
  const coverage = top.length ? top.reduce((a, b) => a + b.s, 0) / top.length : 0
  const neighbors: RetrievalNeighbor[] = top.map(({ i, s }) => ({
    label: (raw.labels[i] === 1 ? 1 : 0) as 0 | 1,
    similarity: Number(s.toFixed(3)),
    excerpt: raw.excerpts[i] ?? '',
    docIndex: i,
  }))
  return {
    score: Math.round(aiRatio * 100),
    aiRatio: Number(aiRatio.toFixed(4)),
    coverage: Number(coverage.toFixed(3)),
    neighbors,
    corpusSize: raw.docCount,
  }
}

let preparedPromise: Promise<PreparedIndex> | null = null

/** 索引按需加载（不进首屏），首次下载后由浏览器缓存 */
function loadIndex(): Promise<PreparedIndex> {
  if (!preparedPromise) {
    preparedPromise = fetch(new URL('retrieval-index.json', document.baseURI).href)
      .then((res) => {
        if (!res.ok) throw new Error(`基座索引加载失败（HTTP ${res.status}）`)
        return res.json() as Promise<RetrievalIndex>
      })
      .then((raw) => prepareIndex(raw))
      .catch((err) => { preparedPromise = null; throw err })
  }
  return preparedPromise
}

export async function runRetrievalChannel(
  text: string,
  onProgress: (status: RetrievalChannelResult) => void,
): Promise<RetrievalChannelResult> {
  try {
    onProgress({ status: 'loading', message: '正在加载语料基座（约 2.3 MB，仅首次，之后浏览器缓存）' })
    const index = await loadIndex()
    onProgress({ status: 'running', message: `正在本地检索 ${index.raw.docCount} 段真实语料的最近邻（不联网、不上传）` })
    // 给渲染让出一次事件循环，让进度文案可见
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const vector = buildQueryVector(text, index.raw.idf, index.raw.dims)
    if (vector.size < 8) throw new Error('文本过短，无法形成有效的 n-gram 检索向量')
    const outcome = retrieve(vector, index)
    const aiCount = outcome.neighbors.filter((n) => n.label === 1).length
    const lowCoverage = outcome.coverage < 0.32
    return {
      status: 'done',
      message: lowCoverage
        ? `基座匹配度偏低（${outcome.coverage.toFixed(2)}）——你的文本与问答语料差异较大，下面读数与近邻请仅作定性参考`
        : `top${outcome.neighbors.length} 近邻中 ${aiCount} 段为 AI 生成、${outcome.neighbors.length - aiCount} 段为人写（按相似度加权）`,
      score: outcome.score,
      aiRatio: outcome.aiRatio,
      coverage: outcome.coverage,
      neighbors: outcome.neighbors,
      corpusSize: outcome.corpusSize,
      formula: RETRIEVAL_FORMULA,
    }
  } catch (error) {
    preparedPromise = null
    const detail = error instanceof Error ? error.message : String(error)
    return { status: 'error', message: '语料检索通道未能完成，主报告不受影响。', error: detail }
  }
}
