import { DEFENSE_EVIDENCE, type DisagreementVerdict } from '../data/defenseEvidence'
import type { AnalysisReport } from './types'

export interface PlatformRecord {
  platform: string
  score: number
  date: string
  /** 可核查事实：该平台官网是否同时提供付费改稿 / 降重 / 二次检测服务（v0.12，可选，默认未标记） */
  sellsRewriteService?: boolean
  /** 可核查事实：该平台是否公开了中文学术文本的误报率 / 校准数据（v0.12，可选，默认未标记） */
  publishedCalibration?: boolean
}

/**
 * 生成本站内部交叉验证的分歧摘要（供申诉文档第三节引用）。
 */
function internalCrossSummary(report: AnalysisReport): string {
  const { crossValidation } = report
  if (crossValidation.verdict === 'aligned') {
    return `本站四条独立证据链（词表/节奏/重复/证据）读数接近（极差 ${crossValidation.spread} 分）。但本站已在方法页公开承认：表层规则通道在 HC3 公开数据集上 ROC AUC 仅 0.515（接近随机），因此本站分数同样不能作为处罚依据。`
  }
  if (crossValidation.verdict === 'divergent') {
    return `本站内部四条独立证据链即已出现严重分歧（极差 ${crossValidation.spread} 分）——同一引擎内部尚且如此，跨平台分数更不可靠。`
  }
  return `本站内部四条独立证据链存在分歧（极差 ${crossValidation.spread} 分），${crossValidation.note}`
}

/**
 * 生成可复制/下载/打印的申诉参考文档（Markdown）。
 * 定位：帮学生组织质疑与过程材料，而非代替学生作虚假声明。
 */
export function buildDefenseDocument(
  report: AnalysisReport,
  records: PlatformRecord[],
  verdict: DisagreementVerdict,
  processNotes: { timeline: string; evidenceNotes: string; aiUsage: string },
): string {
  const date = new Date().toLocaleDateString('zh-CN')
  const topFlagged = report.sentenceAnalyses
    .filter((sentence) => sentence.level === 'priority')
    .slice(0, 5)

  const recordRows = records.length
    ? [
        '| 检测平台 | AI 率 | 检测日期 |',
        '| --- | ---: | --- |',
        ...records.map((record) => `| ${record.platform} | ${record.score}% | ${record.date || '—'} |`),
      ]
    : ['（尚未录入其他平台的检测结果。建议在至少两个平台检测并录入，以展示平台间分歧。）']

  return [
    '# AIGC 检测结果申诉参考材料',
    '',
    `> 生成于 ${date} · 由 ReAuthor（开源工具）辅助整理 · 本文档不构成法律意见，请按学校流程使用`,
    '',
    '---',
    '',
    '## 一、写作过程陈述（请本人如实填写后使用）',
    '',
    '> **诚实原则**：以下模板只应填写真实信息。虚构过程材料会构成新的学术不端，且极易被面谈戳穿。如果你的论文确实大量使用了 AI，本材料不适用，请如实说明使用情况。',
    '',
    '**1. 写作时间线**',
    '',
    processNotes.timeline || '（示例：X 月 X 日完成选题与提纲；X 月 X 日完成初稿第一、二章；X 月 X 日根据导师意见重写第三章；共保存 X 个主要版本，见附件/版本历史截图。）',
    '',
    '**2. 修改痕迹与过程证据**',
    '',
    processNotes.evidenceNotes || '（示例：写作软件/在线文档的版本历史截图；文献阅读笔记；与导师的沟通记录；各阶段草稿的文件修改时间。）',
    '',
    '**3. AI 工具使用声明**',
    '',
    processNotes.aiUsage || '（示例：未使用 AI 生成正文内容；或：仅在 X 环节使用 AI 辅助 X，相关部分已注明。参照中国传媒大学等高校的 AI 使用声明制度。）',
    '',
    '## 二、公开可查证的检测器可靠性证据',
    '',
    '以下证据均来自公开报道或同行评审论文，附原始出处：',
    '',
    ...DEFENSE_EVIDENCE.map((item, index) =>
      [
        `**证据 ${index + 1}：${item.title}**（${item.year}）`,
        '',
        `- 关键数据：${item.stat}`,
        `- ${item.summary}`,
        `- 出处：[${item.sourceName}](${item.sourceUrl})`,
        '',
      ].join('\n'),
    ),
    '## 三、多平台检测结果分歧记录',
    '',
    ...recordRows,
    '',
    `**分歧结论：${verdict.label}（极差 ${verdict.spread} 个百分点）**`,
    '',
    verdict.argument,
    '',
    `**本站内部交叉验证**：${internalCrossSummary(report)}`,
    '',
    '## 四、本报告的逐句特征解释（供面谈时说明）',
    '',
    topFlagged.length
      ? [
          '以下句子获得了最高的表层特征分。请注意其判分依据均为**表层文体特征**（句式规整、用词常见、衔接模板等），这些特征同样出现在规范学术写作与非母语写作中——斯坦福研究已证明这类特征会导致系统性误判：',
          '',
          ...topFlagged.flatMap((sentence) => [
            `**句 ${String(sentence.id).padStart(2, '0')}**（特征分 ${sentence.score}）：${sentence.text.slice(0, 80)}${sentence.text.length > 80 ? '……' : ''}`,
            `- 判分依据：${sentence.reasons.join('；')}`,
            `- 作者可说明的方向：这句话在论证中承担什么功能？是否有对应的草稿或提纲？`,
            '',
          ]),
        ].join('\n')
      : '本报告未发现集中触发模板特征的句子。对应的解释是：文本的表层文体特征并不支持"AI 生成"的判断。',
    '',
    '## 五、申诉请求建议（按学校流程调整措辞）',
    '',
    '1. **请求人工复核**：援引海南多所高校"机器初检、人工复核"双保险、广州大学"人工复核 + 委员会研判"等制度先例，请求对 AIGC 检测结果进行人工复核，而非以算法分数直接定性。',
    '2. **请求检测方披露校准数据**：要求说明所用检测系统在中文（或相应语种）学术文本上的误报率、漏报率及校准数据集。参照：OpenAI 因"低准确率"于 2023 年 7 月下线自家检测器；范德堡大学以可靠性为由停用 Turnitin AI 检测。',
    '3. **提交写作过程材料**：随本文档第一部分提交版本历史、草稿、笔记等过程证据。',
    '4. **质疑单一百分比**：援引本文档第二、三部分证据，说明任何单一平台、单一时点的 AI 率均不具备稳定证明力。',
    '',
    '---',
    '',
    '*本材料由开源工具 ReAuthor 生成。本站不判定学术不端，也不承诺"降AI率"；它的目的是把检测从黑盒百分比拉回到可质证、可复核的证据上来。*',
  ].join('\n')
}
