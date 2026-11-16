import type { AnalysisReport, Metric } from './types'

export interface RevisionItem {
  priority: number
  title: string
  detail: string
  action: string
  metric: Metric
}

export function getRevisionPlan(report: AnalysisReport): RevisionItem[] {
  const actions: Record<Metric['id'], { title: string; action: string }> = {
    formulaic: { title: '先拆掉“万能衔接”', action: '逐句删除或改写序列连接词与宏大开场，让句子之间由真实的因果、对比和递进连接。' },
    abstraction: { title: '把评价落到具体对象', action: '为核心判断补上“谁、在什么情境、改变了什么、如何验证”，优先处理结论句和段首句。' },
    specificity: { title: '补上你的证据链', action: '在核心论点后加入来源、数据、文本细读或个人观察，并解释证据如何支持判断。' },
    repetition: { title: '合并重复的信息', action: '圈出重复短语；每段只保留一次定义，其余位置增加新证据、解释或反驳。' },
    rhythm: { title: '让句长服务内容', action: '把连续均匀句改成“短判断句 + 具体证据句 + 解释句”的组合，不为变化而硬换同义词。' },
  }
  return [...report.metrics]
    .sort((a, b) => b.score * b.weight - a.score * a.weight)
    .slice(0, 3)
    .map((metric, index) => ({
      priority: index + 1,
      title: actions[metric.id].title,
      detail: metric.evidence,
      action: actions[metric.id].action,
      metric,
    }))
}

export function buildMarkdownReport(report: AnalysisReport): string {
  const lines = [
    '# ReAuthor · 写作诊断报告',
    '',
    `> 生成时间：${new Date(report.createdAt).toLocaleString('zh-CN')}`,
    `> 引擎：${report.version}｜语言：${report.language}｜文本类型：${report.documentType}`,
    '',
    '## 结论边界',
    '',
    `**AI 写作特征指数：${report.score}/100（${report.levelLabel}）**`,
    '',
    `证据充分度：${report.evidenceSufficiency}/100（${report.evidenceLabel}）。该指数不是 AI 生成概率，不是作者身份判断，也不能作为学术不端处罚依据。`,
    '',
    '## 五项指标',
    '',
    '| 指标 | 得分 | 权重 | 可核查证据 |',
    '| --- | ---: | ---: | --- |',
    ...report.metrics.map((metric) => `| ${metric.label} | ${metric.score} | ${Math.round(metric.weight * 100)}% | ${metric.evidence} |`),
    '',
    '## 交叉验证（独立证据链）',
    '',
    '| 通道 | 特征族 | 得分 | 说明 |',
    '| --- | --- | ---: | --- |',
    ...report.crossValidation.detectors.map((detector) => `| ${detector.name} | ${detector.family} | ${detector.score} | ${detector.detail} |`),
    '',
    `**通道分歧度：${report.crossValidation.spread}（${report.crossValidation.verdictLabel}）**`,
    '',
    `已知校准事实：本引擎在 HC3 中文数据集上的 ROC AUC 约 0.515，接近随机。此报告是写作特征反馈，不是 AI 作者判定。`,
    '',
    '## 优先修改路线',
    '',
    ...getRevisionPlan(report).flatMap((item) => [
      `### ${item.priority}. ${item.title}`,
      '',
      item.action,
      '',
      `依据：${item.detail}`,
      '',
    ]),
    '## 逐句批注',
    '',
    ...report.sentenceAnalyses.flatMap((sentence) => [
      `### 第 ${sentence.id} 句｜特征值 ${sentence.score}`,
      '',
      sentence.text,
      '',
      `**依据**：${sentence.reasons.join('；')}`,
      '',
      sentence.suggestions.length ? `**建议**：${sentence.suggestions.join('；')}` : '**建议**：无需为了降低分数强行改写；优先检查论证与事实。',
      '',
    ]),
    '## 使用限制',
    '',
    ...report.limitations.map((item) => `- ${item}`),
    '',
    '由 ReAuthor · 重写权生成。检测不是终审，解释才是起点。',
  ]
  return lines.join('\n')
}

export function downloadText(markdown: string, filename: string) {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
