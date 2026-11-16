import { describe, expect, it } from 'vitest'
import { buildQueryVector, prepareIndex, retrieve } from '../lib/retrieval'

// 构造一个极小的内存索引：3 维、4 篇文档（2 人写 2 AI），
// 用与产物完全相同的紧凑结构验证纯函数行为，不依赖网络。
function makeIndex() {
  const idf = [1.2, 1.5, 0.9, 1.1]
  const docs = [
    [0, 100, 1, 80],        // 人写：偏 dim0/1
    [0, 90, 1, 75],         // 人写
    [2, 100, 3, 85],        // AI：偏 dim2/3
    [2, 95, 3, 90],         // AI
  ]
  const labels = [0, 0, 1, 1]
  const excerpts = ['人写片段甲', '人写片段乙', 'AI片段丙', 'AI片段丁']
  return { version: 1, dims: 4, docCount: 4, idf, docs, labels, excerpts,
    meta: { source: 'test', method: 'test', topKDims: 2, builtAt: '2026-01-01' } }
}

describe('语料检索通道（零 AI 模型）', () => {
  it('向量化是确定性的：相同文本得到相同向量', () => {
    const idf = [1, 2, 3, 4]
    const a = buildQueryVector('人工智能改变世界', idf, 4)
    const b = buildQueryVector('人工智能改变世界', idf, 4)
    expect([...a.entries()]).toEqual([...b.entries()])
  })

  it('检索偏向与查询更相似的标签，并返回可解释的最近邻', () => {
    const index = prepareIndex(makeIndex() as never)
    // 构造一个明显偏 dim0/1（人写簇）的查询：直接喂向量
    const humanLike = new Map([[0, 1.5], [1, 1.2]])
    const out = retrieve(humanLike, index, 2)
    expect(out.corpusSize).toBe(4)
    expect(out.neighbors.length).toBe(2)
    expect(out.neighbors[0].label).toBe(0) // 最近邻应是人写
    expect(out.aiRatio).toBeLessThan(0.5)
    expect(out.score).toBeLessThan(50)
    expect(out.neighbors[0].excerpt).toContain('人写')
    expect(out.coverage).toBeGreaterThan(0)
  })

  it('AI 簇查询得到更高的 AI 占比', () => {
    const index = prepareIndex(makeIndex() as never)
    const aiLike = new Map([[2, 1.5], [3, 1.2]])
    const out = retrieve(aiLike, index, 2)
    expect(out.neighbors[0].label).toBe(1)
    expect(out.aiRatio).toBeGreaterThan(0.5)
  })

  it('每篇文档只保留 topK 维度：覆盖率与相似度均在合理区间', () => {
    const index = prepareIndex(makeIndex() as never)
    const out = retrieve(new Map([[0, 1], [1, 1], [2, 1], [3, 1]]), index, 2)
    expect(out.coverage).toBeGreaterThanOrEqual(0)
    expect(out.coverage).toBeLessThanOrEqual(1)
    expect(out.score).toBeGreaterThanOrEqual(0)
    expect(out.score).toBeLessThanOrEqual(100)
  })
})
