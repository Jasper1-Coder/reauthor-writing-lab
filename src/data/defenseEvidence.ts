/**
 * 申诉工作台的可引用证据库。
 * 每一条都经过核实（2026-11-16 核查），附原始出处，可直接写进申诉材料。
 * 维护准则：新增条目必须有可访问的公开出处；数字必须与原文一致。
 */
export interface DefenseEvidence {
  id: string
  title: string
  stat: string
  summary: string
  quote: string
  sourceName: string
  sourceUrl: string
  year: string
  useFor: string
}

export const DEFENSE_EVIDENCE: DefenseEvidence[] = [
  {
    id: 'stanford-esl-bias',
    title: '斯坦福大学：主流检测器对非母语写作者存在系统性误判',
    stat: '61.3% 平均误报率',
    summary:
      '7 款主流 GPT 检测器测试 91 篇中国学生真实托福作文，平均 61.3% 被误判为 AI 生成；19.8% 被全部 7 款一致误判；97.8% 至少被一款误判。同批美国八年级学生作文误报率仅约 3.2%。原因是检测器依赖困惑度等表层指标，天然惩罚用词保守、句式工整的写作。',
    quote: '检测器对非母语写作者"内在地存在歧视"——用词保守、句式规整的真人写作最容易被误判（Liang et al., Patterns, 2023）',
    sourceName: 'Liang, Yuksekgonul, Mao, Wu & Zou, "GPT detectors are biased against non-native English writers", Patterns (Cell Press)',
    sourceUrl: 'https://www.cell.com/patterns/fulltext/S2666-3899(23)00130-7',
    year: '2023',
    useFor: '质疑"写得规整/像模板 = AI 生成"的判定逻辑，尤其是英语非母语或规范化学术文体。',
  },
  {
    id: 'cnki-paperpass-divergence',
    title: '同一篇论文，不同平台 AI 率天差地别',
    stat: '5% vs 50% vs 70%',
    summary:
      '媒体报道：记者将同一篇毕业论文送检，PaperYY 判 50%、PaperPass 判 70%，而知网仅判 5%。各平台评判标准不同、检测方式存在偏差，且知网、维普结果普遍低于 PaperYY、PaperPass 等平台。',
    quote: '现有的 AI 率检测平台评判标准不同、检测方式存在偏差（新华社系媒体调查报道，2025-07）',
    sourceName: '《自己写的毕业论文 被判定长着一张AI的脸——论文AI率检测"误伤"乱象调查》',
    sourceUrl: 'https://qzcredit.qz.gov.cn/art/2025/7/7/art_1229660035_37159.html',
    year: '2025',
    useFor: '质疑任何一个平台给出的"唯一权威百分比"——平台之间连基准都没有对齐。',
  },
  {
    id: 'yangmi-time-divergence',
    title: '同一平台、同一篇论文，检测结果随时间剧烈漂移',
    stat: '0% → 77.8%',
    summary:
      '一篇已公开发表的 3700 字论文：2024 年 6 月知网检测 AI 率为 0%；2025 年 5 月知网复测变为 77.8%，维普 44.5%，PaperPass 91.48%。同一文本仅因检测时间和平台不同，结果出现巨大落差，暴露判定标准不统一、技术成熟度存疑。',
    quote: '同一篇论文，仅因检测时间和所用平台的不同，AI 率结果便出现巨大落差（中华网报道，2025-06）',
    sourceName: '《论文检测标准不一让毕业生"破防" AI率波动引争议》',
    sourceUrl: 'https://3g.china.com/act/news/10000169/20250605/48423458.html',
    year: '2025',
    useFor: '质疑检测结果的稳定性：如果算法版本会漂移，以某一次检测定罪就是拿快照当真值。',
  },
  {
    id: 'paraphrase-bypass',
    title: '简单改写即可让检出率从 70% 跌到不足 5%',
    stat: '70% → <5%',
    summary:
      '有实验表明，将 AI 生成文本送入改写模型转述后，主流检测器检出率从七成跌至不足 5%。斯坦福研究同样发现，仅让 ChatGPT"用更具文学性的语言改写"，检出率就"骤降至接近零"。这说明：检测率指标可以被一句话术打穿，它从未稳定测量过任何真实属性。',
    quote: '检测模型大多是通过文本的规整度、措辞流畅度来判断……"越规整越可疑"成了无法绕过的悖论（中国教育新闻网，2026-09）',
    sourceName: '《理性看待AI检测的局限与边界》中国教育新闻网（转自中国教育报）',
    sourceUrl: 'http://m.jyb.cn/rmtzgjyb/202609/t20260909_2111518820_wap.html',
    year: '2026',
    useFor: '论证：如果 AI 文可以轻易降到 0%，那么高分数既不能证明"是 AI 写的"，也不能证明"不是"——它什么都证明不了。',
  },
  {
    id: 'human-flagged-cases',
    title: '大量学生自写内容被大段标红的公开案例',
    stat: '自写被标红 · 付费自证',
    summary:
      '公开报道的案例：有学生"熬夜查资料、逐字推敲写出来的段落被标成疑似AI生成"，为把 AI 率从 45% 降到学校要求的 25%，被迫把流畅表达"掰开揉碎"重写并自费 80 元检测；有研究生发现"上下两段语言风格和逻辑完全相同，只有其中一段被标红"；2025 年 12 月知网检测升级后不少论文 AI 率暴增。',
    quote: 'AI 率检测和复制率检测本质上都是语言检测……存在误判风险，使"李逵"蒙冤（兰州大学高等教育研究院副教授罗杨洋）',
    sourceName: '《论文查AI率引误伤之痛》江西政法网',
    sourceUrl: 'https://www.jxzfw.gov.cn/2026/0602/2026060271174.html',
    year: '2026',
    useFor: '证明误判不是个案而是系统性现象，申请人工复核有公开舆论与案例支持。',
  },
  {
    id: 'university-manual-review',
    title: '多所高校已承认检测不可靠，建立"机器初检 + 人工复核"制度',
    stat: '制度先例',
    summary:
      '海南多所高校推行"机器初检、人工复核"双保险机制；中国传媒大学要求学生声明 AI 工具使用情况；广州大学建立"人工复核 + 委员会研判"机制；同济大学法学院学者指出直接用现有工具判定学术诚信"误判风险不容小觑"。这些都可作为申诉时援引的制度先例。',
    quote: '把检测工具作为线索而非最终判定依据，结合学生的写作过程、课程表现、知识掌握程度做综合判断（中国教育报）',
    sourceName: '《论文检测标准不一让毕业生"破防"》等（海南高校双保险、广州大学、中国传媒大学机制）',
    sourceUrl: 'https://3g.china.com/act/news/10000169/20250605/48423458.html',
    year: '2025-2026',
    useFor: '申诉时的核心诉求模板：请求"人工复核 + 过程材料说明"，而非接受单一算法分数。',
  },
  {
    id: 'vendor-self-admission',
    title: '行业头部自己承认不可靠',
    stat: '官方停用 / 下线',
    summary:
      'OpenAI 于 2023 年 7 月因"低准确率"主动下线自家 AI 文本分类器；美国范德堡大学（Vanderbilt）同年 8 月以可靠性为由停用 Turnitin 的 AI 检测功能。检测技术的头部玩家自己都不把它当真值使用。',
    quote: 'OpenAI：由于"低准确率"（low rate of accuracy）下线 AI 分类器；Vanderbilt：停用 Turnitin AI 检测（公开报道）',
    sourceName: 'OpenAI 官方公告（2023-07）；Vanderbilt 官网公告（2023-08）',
    sourceUrl: 'https://www.vanderbilt.edu/brightspace/2023/08/16/gpt-detectors-and-other-automated-writing-analysis-is-unreliable/',
    year: '2023',
    useFor: '反驳"权威平台 = 权威结果"：连技术提供方自己都因可靠性不足而收场。',
  },
]

export interface DisagreementVerdict {
  spread: number
  level: 'consistent' | 'divergent' | 'severely-divergent' | 'single'
  label: string
  argument: string
}

export function evaluateDisagreement(scores: number[]): DisagreementVerdict {
  if (scores.length === 0) {
    return { spread: 0, level: 'single', label: '未录入', argument: '录入其他平台的检测结果后，将自动生成分歧论证。' }
  }
  if (scores.length === 1) {
    return {
      spread: 0,
      level: 'single',
      label: '单一来源',
      argument: '目前只有一个平台的结论。公开调查显示不同平台对同一论文的判定可相差数十个百分点（同一篇论文曾出现知网 5%、PaperPass 70% 的落差），建议再录入至少一个平台的检测值作对照。',
    }
  }
  const spread = Math.max(...scores) - Math.min(...scores)
  if (spread >= 30) {
    return {
      spread,
      level: 'severely-divergent',
      label: '严重分歧',
      argument: `各平台判定相差 ${spread} 个百分点，结论互相矛盾。这与公开报道的"同一篇论文在知网、维普、PaperPass 上得分 5%/70%/50%"的乱象一致：平台之间不存在共同基准，任何一个数字都不具备作为处罚依据的证明力。`,
    }
  }
  if (spread >= 15) {
    return {
      spread,
      level: 'divergent',
      label: '明显分歧',
      argument: `各平台判定相差 ${spread} 个百分点，已超出可忽略的技术误差范围。检测行业没有统一的判定标准与校准义务，建议以逐句证据与写作过程材料为准。`,
    }
  }
  return {
    spread,
    level: 'consistent',
    label: '基本一致',
    argument: `各平台判定相差仅 ${spread} 个百分点。但请注意：一致性不等于正确性——斯坦福研究表明同类检测器会对 61.3% 的真人非母语作文集体误判（"集体错误"正是它们共享相似原理的证据）；另有改写实验显示检出率可从 70% 被压到 5% 以下。`,
  }
}
