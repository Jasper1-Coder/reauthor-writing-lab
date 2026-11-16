export const SAMPLE_ZH = `在当今社会，人工智能技术正在以前所未有的速度发展，并对教育领域产生深远的影响。值得注意的是，人工智能不仅能够提高学习效率，而且能够促进教育公平，因此具有重要的研究意义。本文将探讨人工智能在教育中的应用及其价值。

首先，人工智能可以实现个性化学习。通过先进的技术，系统能够根据学生的不同特点提供不同的学习内容，从而满足不同学生的不同需求。其次，人工智能可以优化教学管理。教师可以利用人工智能完成许多工作，这不仅能够减轻教师负担，而且能够提高工作效率。再次，人工智能可以丰富教学资源。各种智能平台提供了丰富的资源，使学生能够获得更好的学习体验。

然而，人工智能在教育中的应用也面临一些挑战。一方面，数据安全问题不容忽视；另一方面，技术依赖问题也值得关注。因此，我们既要看到人工智能的优势，也要认识到人工智能的局限性。只有采取合理有效的措施，才能充分发挥人工智能的积极作用。

综上所述，人工智能为教育领域带来了新的机遇和挑战。在未来，随着科技的不断进步，人工智能必将在教育领域发挥更加重要的作用。我们应该积极拥抱这一技术，推动教育的创新与发展，为学生创造更加美好的未来。`

export const SAMPLE_EN = `When our seminar group first tried an AI study assistant, I expected it to make revision easier. Instead, I spent much of the evening checking whether its references actually existed. Two of the five articles it suggested could not be found in the library catalogue, while a third attributed a claim to the wrong author. That experience did not make the tool useless, but it changed the way I used it.

The assistant was most helpful when I already understood the topic. During my statistics revision, for example, it offered three alternative explanations of a confidence interval. Comparing those explanations helped me identify the exact step I had misunderstood. In this situation, the technology supported my thinking rather than replacing it. The difference mattered: I began with a specific question and ended by testing the answer against my lecture notes.

This small observation complicates the usual argument that AI simply improves or damages learning. Its value depends on the task, the student's prior knowledge, and the time available for verification. A first-year student who cannot recognise an invented citation faces a different risk from a postgraduate researcher checking a familiar source. My own experience is too limited to prove a general rule, but it suggests a practical question for further research: can structured source-checking reduce errors without removing the benefits of immediate feedback? A future study could compare two student groups using the same assistant, with only one group receiving verification training.`

export const SAMPLE_HUMAN_ZH = `我们小组第一次尝试用 AI 助手准备研讨会时，我原以为它能直接省下查资料的时间。结果那天晚上，我反而花了近两个小时核对它给出的参考文献：五篇文章里有两篇在学校图书馆目录中找不到，另一篇把作者的观点张冠李戴。这次经历没有让我放弃这个工具，却改变了我使用它的顺序。

它真正帮到我的地方，是在我已经学过相关内容之后。复习统计学时，我对置信区间的某一步推导始终不明白，助手给出了三种不同解释。我对照课堂笔记逐一检查，才发现问题出在样本均值与总体参数的混淆上。这里的关键并不是回答写得流畅，而是我带着具体问题开始，最后又能用课程材料验证答案。

当然，一次个人经历不能证明普遍结论。我的样本只有三门课程，也没有记录每次核查所花的时间。但它至少提出了一个可以在后续研究中验证的问题：如果学生在使用 AI 前接受来源核查训练，错误率是否会下降？相比笼统地讨论“AI 会不会取代思考”，这个问题更接近我真实遇到的学习情境。`

/** v0.3 样本基座：统一结构，供分析器一键载入对照 */
export interface SampleDoc {
  id: string
  name: string
  shortName: string
  language: 'auto' | 'zh' | 'en'
  text: string
}

/** 中英混排 · 人写风格：大量英文术语的中文论文，曾触发旧的充分性误判 */
export const SAMPLE_MIX_ZH = `本文以某高校 2024 年秋季学期的 flipped classroom 实践为观察对象，讨论 LLM 辅助写作在 group project 中的实际使用模式。我们跟踪了四个小组共 21 名学生的 draft history：每组在 peer review 前平均生成 2.3 个 ChatGPT 版本，但最终提交稿中只有 17% 的句子保留了大模型的原始表述。这个数字本身并不惊人，惊人的是保留位置——被保留下来的句子集中在 methodology 的模板段落，而不是 argumentation 部分。

访谈给出了一个可能的解释。一名受访者说："让 GPT 写 introduction 我是不放心的，它不知道我们组前两次 presentation 失败在哪；但 method 部分的固定句式，它写得比我顺。"这与 writing process research 中的 cognitive load 假设一致：当任务的制约条件明确且评价标准客观时，模板化生成是低风险的；当论证需要嵌入具体情境时，学生出现了明显的 selective rejection 行为。

这个观察对 AI writing detection 的启发是直接的：检测工具如果按句均匀打分，会把 students' deliberate template usage 读成高 AI 概率，而把真正成段生成的 argumentation 读成低风险——因为学生改写后者时动过的词，恰好是检测器眼中的"人味"。我们的样本太小，不足以支撑任何推断，但足以说明一个问题：AI usage pattern 的分布是不均匀的，检测工具的评分模型假设它是均匀的。`

/** 英文 · 模板化风格：典型的 AI 味学术套话堆叠 */
export const SAMPLE_EN_TEMPLATE = `In today's rapidly evolving digital landscape, artificial intelligence plays a crucial role in transforming education. It is important to note that AI not only enhances learning efficiency but also promotes educational equity. Furthermore, this essay will explore the profound impact of AI on modern pedagogy.

Firstly, AI enables personalized learning. Through advanced algorithms, educational platforms can deliver customized content that caters to the diverse needs of students. Moreover, AI empowers teachers by automating administrative tasks, allowing them to focus on meaningful instruction. Additionally, intelligent tutoring systems provide rich resources, creating a better learning experience for all.

However, it is undeniable that the integration of AI presents various challenges. On the one hand, data privacy concerns cannot be overlooked. On the other hand, over-reliance on technology may undermine critical thinking. In conclusion, embracing AI in education offers significant opportunities and challenges. We must leverage effective measures to optimize its benefits and unlock a brighter future for learners worldwide.`

/** 中文 · 调查报告风格：人写，含具体数据与来源 */
export const SAMPLE_HUMAN_REPORT_ZH = `为了搞清楚"大学生到底把 AI 用在哪"，我们小组在 10 月 14 日到 11 月 2 日之间做了两轮调查：第一轮是面向全校的问卷（回收 347 份，剔除 19 份无效后 328 份有效），第二轮是 6 场半结构化访谈，每场 25 到 40 分钟。问卷里最意外的数据不是使用率——87% 的同学这学期用过至少一次大模型——而是用途分布：查资料解释占 41%，改简历和邮件占 23%，直接生成作业段落只占 9%。

访谈把这个分布讲得更细。管理学院的张同学（大二）说得很直接："让它写作业我自己也心虚，但它给我讲懂 R 语言的报错信息是真的省时间。"外语学院的两位受访者则提到翻译场景：先让模型出初翻，再人工核对术语，据她们估计这比纯人工快一半以上。这与问卷里"翻译润色"占 18% 的数据相互印证。

当然，我们的方法有明显局限。问卷通过课程群转发，文科和低年级样本偏多；"是否直接生成作业段落"这种自报数据，在考试季的舆论环境下几乎必然偏低。所以这 9% 更应该读作一个下界，而不是真实比例。如果要继续做下去，下一步应该对比不同院的课程类型，并把"用了 AI 但改写"和"完全没改"拆成两个问题来问。`

export const SAMPLE_LIBRARY: SampleDoc[] = [
  { id: 'zh-template', name: '中文 · 模板化示例', shortName: '中文模板', language: 'zh', text: SAMPLE_ZH },
  { id: 'zh-human', name: '中文 · 个人论证示例', shortName: '中文个人', language: 'zh', text: SAMPLE_HUMAN_ZH },
  { id: 'zh-report', name: '中文 · 调查报告示例', shortName: '中文调查', language: 'zh', text: SAMPLE_HUMAN_REPORT_ZH },
  { id: 'zh-mix', name: '中英混排 · 论文示例', shortName: '混排论文', language: 'zh', text: SAMPLE_MIX_ZH },
  { id: 'en-human', name: 'English · Evidence-rich draft', shortName: 'EN 个人', language: 'en', text: SAMPLE_EN },
  { id: 'en-template', name: 'English · Template-heavy sample', shortName: 'EN 模板', language: 'en', text: SAMPLE_EN_TEMPLATE },
]
