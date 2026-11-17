import { RETRIEVAL_UNAVAILABLE, REWRITE_PLACEHOLDER, type AppealPacket } from './appealPacket'
import { DEFENSE_EVIDENCE } from '../data/defenseEvidence'
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

/** 一条改写记录：学生本人改写的句子 + 复测结果 */
export interface RewriteEntry {
  sentenceId: number
  original: string
  draft: string
  originalScore: number
  draftScore: number
  reason: string
  hitsCleared: string[]
}

/**
 * 生成"改写前后对照表"——它真正的价值不是分数，而是过程证据：
 * 学生逐句记录自己为什么改、改成什么，向老师证明论证是逐步形成的。
 */
export function buildRewriteComparisonMarkdown(report: AnalysisReport, entries: RewriteEntry[]): string {
  const totalDelta = entries.reduce((sum, entry) => sum + (entry.originalScore - entry.draftScore), 0)
  const improved = entries.filter((entry) => entry.draftScore < entry.originalScore).length
  const lines = [
    '# ReAuthor · 改写前后对照表（过程证据）',
    '',
    `> 生成时间：${new Date().toLocaleString('zh-CN')}`,
    `> 原报告：${report.version}｜原指数 ${report.score}/100（${report.levelLabel}）｜语言 ${report.language}`,
    '',
    '## 这份文件说明什么',
    '',
    '下表逐句记录了本人对高特征句子的手动改写、改写理由，以及用与原报告完全相同的规则复测后的特征值变化。',
    '它用于向教师展示：论证是经过阅读、判断与修订逐步形成的，而不是一次成稿。',
    '**请如实填写改写理由。** 特征值下降只反映表层文体信号，不等于内容质量提高，更不构成作者身份判定。',
    '',
    `本表共 ${entries.length} 句改写，其中 ${improved} 句特征值下降，累计下降 ${totalDelta} 分。`,
    '',
    '## 逐句对照',
    '',
  ]
  entries.forEach((entry) => {
    const delta = entry.draftScore - entry.originalScore
    lines.push(
      `### 第 ${entry.sentenceId} 句 · ${entry.originalScore} → ${entry.draftScore}（${delta > 0 ? '+' : ''}${delta}）`,
      '',
      `**原文**：${entry.original}`,
      '',
      `**我的改写**：${entry.draft}`,
      '',
      `**我为什么这样改**：${entry.reason || '（未填写）'}`,
      '',
      entry.hitsCleared.length ? `**消除的命中表达**：${entry.hitsCleared.join('、')}` : '**消除的命中表达**：无（本句未命中预设词表，改动主要体现在论证或证据上）',
      '',
    )
  })
  lines.push(
    '## 使用边界',
    '',
    '- 本表是写作过程的自述材料，仅供师生沟通参考，不能单独证明作者身份。',
    '- 教师应结合草稿、版本历史、课堂讨论等过程材料综合判断。',
    '- 特征值来自公开的手调规则，不构成 AI 生成概率。',
    '',
    '由 ReAuthor · 重写权生成。检测不是终审，解释才是起点。',
  )
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

/**
 * 把申诉证据包导出为一份已填充的中文申诉 / 答辩信（Markdown）。
 * 复用既有 buildRewriteComparisonMarkdown 的逐句口径与 downloadText / 剪贴板路径，
 * 不新增导出机制；样本不足时只产出降级说明，绝不给出可用申诉信。
 */
export function buildAppealLetterMarkdown(packet: AppealPacket, fusionText?: string): string {
  if (packet.degraded) {
    return ['# 规则观察说明（样本不足）', '', packet.degradedNotice, '', packet.ethicsNotice].join('\n')
  }

  const date = new Date().toLocaleDateString('zh-CN')
  const { verdict, disagreement, crossDomain, retrieval, rewrite, selfStatement } = packet
  const lines: string[] = [
    '# AIGC 检测结果申诉信（本案证据版）',
    '',
    `> 生成日期：${date} · 由 ReAuthor（开源工具）辅助整理`,
    '',
    `> ${packet.ethicsNotice}`,
    '',
    '---',
    '',
    '## 一、判决概况',
    '',
    `- 被判平台：${verdict.judgedPlatform || '（待填写）'}`,
    `- 被判分数：${verdict.judgedScore === null ? '（待填写）' : String(verdict.judgedScore)}`,
    `- 本站写作特征指数：${verdict.siteReading}（${verdict.siteLevelLabel}）`,
    `- 本站校准模型通道读数：${verdict.siteCalibratedScore}`,
    '',
  ]

  if (verdict.platformRecords.length) {
    lines.push(
      '| 检测平台 | AI 率 | 检测日期 |',
      '| --- | ---: | --- |',
      ...verdict.platformRecords.map((record) => `| ${record.platform} | ${record.score}% | ${record.date || '—'} |`),
      '',
    )
  } else {
    lines.push('（尚未录入其他平台的检测结果。）', '')
  }

  // v0.12：外部判定的证据拆解（可选）。只陈述可核查事实与透明折扣，不做动机断言。
  if (fusionText && fusionText.trim()) {
    lines.push('### 对外部检测判定的证据拆解', '', fusionText.trim(), '', '> 该拆解评估的是判定作为证据的可信度，不是对你是否使用 AI 的判定。', '')
  }

  lines.push(
    '## 二、本文多通道分歧实证',
    '',
    ...disagreement.channels.map((channel) => `- ${channel.name}：${channel.score}`),
    '',
    `通道分歧度：${disagreement.spread}（${disagreement.verdictLabel}）`,
    '',
    disagreement.caveat,
    '',
    '## 三、跨域阈值失效说明',
    '',
    `本站校准模型训练于 ${crossDomain.trainDomain}，在 ${crossDomain.testDomain} 跨域测试中绝对分数塌缩至 ${crossDomain.calibratedScoreMin}–${crossDomain.calibratedScoreMax}、阈值 50 灵敏度 ${Math.round(crossDomain.at50Sensitivity * 100)}%（可复现：\`${crossDomain.reproduceCommand}\`）。`,
    '',
    `校准模型留出折 AUC ${crossDomain.calibratedAuc}、跨域特异度 ${crossDomain.at50Specificity}；规则引擎跨域 AUC ${crossDomain.ruleAuc}。`,
    '',
    '## 四、检索匹配度 / 最近邻',
    '',
  )

  if (retrieval.available) {
    lines.push(
      `- 检索匹配度：${retrieval.score ?? '—'}`,
      `- 语料覆盖率：${retrieval.coverage ?? '—'}`,
      `- 语料规模：${retrieval.corpusSize ?? '—'} 段`,
    )
    if (retrieval.nearestNeighbors.length) {
      lines.push('', '最近邻摘录（最多 3 条）：')
      retrieval.nearestNeighbors.forEach((neighbor, index) => {
        lines.push(`${index + 1}. [${neighbor.label === 1 ? 'AI 生成' : '真人撰写'}｜相似度 ${neighbor.similarity}] ${neighbor.excerpt.slice(0, 120)}`)
      })
    }
    lines.push('', retrieval.note, '')
  } else {
    lines.push(RETRIEVAL_UNAVAILABLE, '')
  }

  lines.push('## 五、改写前后对照', '')
  if (rewrite.hasEntries) {
    rewrite.entries.forEach((entry) => {
      const delta = entry.draftScore - entry.originalScore
      lines.push(
        `### 第 ${entry.sentenceId} 句 · ${entry.originalScore} → ${entry.draftScore}（${delta > 0 ? '+' : ''}${delta}）`,
        '',
        `**原文**：${entry.original}`,
        '',
        `**我的改写**：${entry.draft}`,
        '',
        `**我为什么这样改**：${entry.reason || '（未填写）'}`,
        '',
      )
    })
  } else {
    lines.push(REWRITE_PLACEHOLDER, '')
  }

  lines.push(
    '## 六、写作过程自述（请本人如实填写）',
    '',
    '**1. 写作时间线**',
    '',
    selfStatement.isPlaceholder ? selfStatement.placeholder.timeline : selfStatement.timeline,
    '',
    '**2. 修改痕迹与过程证据**',
    '',
    selfStatement.isPlaceholder ? selfStatement.placeholder.evidenceNotes : selfStatement.evidenceNotes,
    '',
    '**3. AI 工具使用声明**',
    '',
    selfStatement.isPlaceholder ? selfStatement.placeholder.aiUsage : selfStatement.aiUsage,
    '',
    '## 七、公开可查证的检测器可靠性证据',
    '',
    '以下每条都来自公开研究或报道，附原始出处可点开核对——它们说明"AI 率"为何不能作为单一判定依据：',
    '',
    ...DEFENSE_EVIDENCE.flatMap((item, index) => [
      `**证据 ${index + 1}：${item.title}（${item.year}）**`,
      '',
      `- 关键数据：${item.stat}`,
      `- 出处：[${item.sourceName}](${item.sourceUrl})`,
      '',
    ]),
    '## 八、脚注（本站公开证据 / 可复现管线）',
    '',
    '- crossDomainValidation.json（本站跨域验证真实数字，生成于 2026-11-16）',
    '- calibratedModel.json（留出折 AUC 0.930±0.007，协议见 meta.protocol）',
    '- scripts/crossdomain-test.ts（运行：npx tsx scripts/crossdomain-test.ts）',
    '- scripts/train-model.ts（可复现训练管线）',
    '',
    '## 九、申诉请求（按学校流程调整）',
    '',
    '1. **请求人工复核**：援引海南多所高校"机器初检、人工复核"双保险、广州大学"人工复核 + 委员会研判"等制度先例，请求对 AIGC 检测结果进行人工复核，而非以算法分数直接定性。',
    '2. **请求检测方披露校准数据**：要求说明所用检测系统在中文（或相应语种）学术文本上的误报率、漏报率及校准数据集。参照：OpenAI 因"低准确率"于 2023 年 7 月下线自家检测器；范德堡大学以可靠性为由停用 Turnitin AI 检测。',
    '3. **提交写作过程材料**：随本文档第一部分提交版本历史、草稿、笔记等过程证据。',
    '4. **质疑单一百分比**：援引本文档第二、三部分证据，说明任何单一平台、单一时点的 AI 率均不具备稳定证明力。',
    '',
    '---',
    '',
    packet.ethicsNotice,
  )

  return lines.join('\n')
}
