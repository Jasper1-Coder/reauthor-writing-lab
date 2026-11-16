# ReAuthor · 本轮申诉证据包 PRD（PM 执行规格）

> 面向开发/测试的零歧义规格。唯一依据：`docs/ceo-brief.md`。所有方向、范围、数字均不得超出该简报。
> 项目版本：v0.7.1 · 立场：学生视角、可解释、公开误差、帮学生有据可依地对抗不合理的 AI 查重判决。

---

## 1. 范围锚定

**唯一方向（复述 CEO ①）**：把申诉工作台从「通用证据库 + 空模板 + 用户自填多平台分数」升级为**「一案一证」的申诉证据包**——针对本文、由现成诊断数据自动填充、可一键导出的申诉 / 答辩信。这不是新增指标，而是把已算好的本文证据（多通道分歧、跨域阈值塌缩、校准边界、检索匹配、改写对照）接成学生能直接交给老师/教务的材料。

**本轮不做（照搬 CEO ③，逐条不得删减）**：

1. **不加**任何新的检测指标 / AUC / 模型 / 训练流程。
2. **不动** `src/lib/analyzer.ts`、`src/lib/calibrated.ts`、`src/lib/retrieval.ts` 的评分逻辑与常量。
3. **不调 AI、不联网**：所有填充来自本地已有数据 + 用户如实填写，不引入模型或网络请求。
4. **不伪造过程证据**，不宣称本工具能「证明作者身份」或「保证申诉成功」。
5. **不做**后端 / 账号 / 云存储；不破坏「纯静态可发布 gh-pages」的形态。
6. **不重复造轮子**：不新增导出机制、不重写已有报告 / 改写对照的数据源。

---

## 2. 数据契约

### 2.1 新模块 `src/lib/appealPacket.ts`（纯函数，零副作用）

所有类型在本文件 `export`。`RewriteEntry` 与 `PlatformRecord` 从 `./report` / `./defense` **导入复用**，不得重新定义或改写其数据源。

#### 2.1.1 `AppealPacket` 顶层结构

```ts
export interface AppealPacket {
  /** = report.isSampleSufficient，判定是否产出可用申诉信 */
  sufficient: boolean
  /** = !sufficient */
  degraded: boolean
  /** 样本不足时的降级文案（sufficient=true 时为空字符串） */
  degradedNotice: string
  /** 板块 1 */
  verdict: AppealVerdictSection
  /** 板块 2 */
  disagreement: AppealDisagreementSection
  /** 板块 3 */
  crossDomain: AppealCrossDomainSection
  /** 板块 4 */
  retrieval: AppealRetrievalSection
  /** 板块 5 */
  rewrite: AppealRewriteSection
  /** 板块 6 */
  selfStatement: AppealSelfStatementSection
  /** 常驻伦理红线口径，所有对外视图/导出都必须带上 */
  ethicsNotice: string
}
```

#### 2.1.2 六个板块的字段、类型与数据来源

**板块 1 · 判决概况**（对应 CEO 功能点 1 输出结构第 1 条「被判平台、分数、本站读数」）

```ts
export interface AppealVerdictSection {
  judgedPlatform: string            // 来源：userInput.platform（用户填写）
  judgedScore: number | null        // 来源：userInput.score 经 Number() 与 0–100 校验，非法则 null
  platformRecords: PlatformRecord[] // 来源：userInput.platformRecords（用户录入，复用 defense.PlatformRecord）
  siteReading: number               // 来源：report.score（本站写作特征指数）
  siteLevelLabel: string            // 来源：report.levelLabel
  siteCalibratedScore: number       // 来源：report.calibratedScore（校准模型通道读数）
}
```

**板块 2 · 本文多通道分歧实证**（对应第 2 条「各通道分数 + 分歧度数值 + '任何单一百分比不可引用'口径」）

```ts
export interface AppealDisagreementSection {
  channels: Array<{ name: string; score: number }> // 来源：report.crossValidation.detectors.map(d => ({name: d.name, score: d.score}))；
                                                    // 若 retrieval?.status === 'done' 且 score 为 number，追加 { name: '语料检索通道', score: retrieval.score }
  spread: number          // 来源：report.crossValidation.spread（分歧度数值，原样取，不重算）
  verdictLabel: string    // 来源：report.crossValidation.verdictLabel
  caveat: string          // 固定口径常量 SINGLE_PERCENTAGE_CAVEAT（见 2.3）
}
```

**板块 3 · 跨域阈值失效说明**（对应第 3 条「引用 crossDomainValidation.json 的真实数字」）

```ts
export interface AppealCrossDomainSection {
  trainDomain: string          // crossDomainValidation.json → meta.trainDomain
  testDomain: string           // crossDomainValidation.json → meta.testDomain
  calibratedAuc: number        // → calibrated.auc（= 0.859）
  calibratedScoreMin: number   // → min(perDoc[].humanScore, perDoc[].aiScore)（= 0）
  calibratedScoreMax: number   // → max(perDoc[].humanScore, perDoc[].aiScore)（= 18）
  at50Sensitivity: number      // → calibrated.at50.sensitivity（= 0，0–1 浮点，导出时 ×100 显示为百分比）
  at50Specificity: number      // → calibrated.at50.specificity（= 1）
  ruleAuc: number              // → ruleEngine.auc（= 0.223）
  reproduceCommand: string     // 固定：'npx tsx scripts/crossdomain-test.ts'
}
```

> 实现要求：`import crossDomain from '../data/crossDomainValidation.json'`（Vite/TS 已支持 JSON 导入，见 `calibrated.ts` 的 `import modelData ...`），在装配器里从该对象读取真实字段；`calibratedScoreMin/Max` 通过遍历 `perDoc` 计算得出，**禁止硬编码 0 和 18**。

**板块 4 · 检索匹配度 / 最近邻**（对应第 4 条）

```ts
export interface AppealRetrievalSection {
  available: boolean   // = retrieval?.status === 'done'
  score: number | null        // 来源：retrieval.score
  coverage: number | null     // 来源：retrieval.coverage
  corpusSize: number | null   // 来源：retrieval.corpusSize
  nearestNeighbors: Array<{ label: 0 | 1; similarity: number; excerpt: string }>
                          // 来源：retrieval.neighbors?.slice(0, 3)（最多 3 条，逐字段挑出，不携带 docIndex 以外冗余）
  note: string         // 固定口径常量 RETRIEVAL_NOTE（见 2.3）；无数据时返回 UNAVAILABLE_TEXT
}
```

**板块 5 · 改写前后对照**（对应第 5 条「复用 `buildRewriteComparisonMarkdown` 的数据源」）

```ts
export interface AppealRewriteSection {
  entries: RewriteEntry[]   // 来源：userInput.rewriteEntries（复用 report.RewriteEntry 类型，结构与 buildRewriteComparisonMarkdown 的第二参数一致）
  hasEntries: boolean       // = entries.length > 0
  placeholder: string       // 固定占位文案 REWRITE_PLACEHOLDER（见 2.3），hasEntries=false 时使用
}
```

> 说明：「复用数据源」= 复用 `RewriteEntry` 类型与口径，**不得改动 `RewriteWorkbench.tsx` / `report.ts` 中的改写逻辑，也不要求本轮打通组件状态传递**。若 `userInput.rewriteEntries` 缺省，本板块仅提供占位引导（提示学生从改写工作台导出对照表后手动附上）。

**板块 6 · 写作过程自述占位**（对应第 6 条「如实填写，占位符不预填内容」）

```ts
export interface AppealSelfStatementSection {
  timeline: string       // 来源：userInput.timeline（原文照搬；未填则 ''）
  evidenceNotes: string  // 来源：userInput.evidenceNotes
  aiUsage: string        // 来源：userInput.aiUsage
  isPlaceholder: boolean // = timeline/evidenceNotes/aiUsage 三段 trim 后全为空
  placeholder: {         // 固定占位常量（见 2.3），isPlaceholder=true 时导出使用；系统绝不预填虚构内容
    timeline: string
    evidenceNotes: string
    aiUsage: string
  }
}
```

> 关键约束：**占位内容只能是常量占位文本，不能是系统生成/推测的"写作过程"**。学生如实填写后才用其原文替换。

#### 2.1.3 函数签名

```ts
// src/lib/appealPacket.ts
export function buildAppealPacket(
  report: AnalysisReport,
  retrieval?: RetrievalChannelResult,
  userInput?: AppealUserInput,
): AppealPacket

// src/lib/report.ts
export function buildAppealLetterMarkdown(packet: AppealPacket): string
```

`AppealUserInput`（导出类型）：

```ts
export interface AppealUserInput {
  platform?: string
  score?: number | string
  platformRecords?: PlatformRecord[]
  timeline?: string
  evidenceNotes?: string
  aiUsage?: string
  rewriteEntries?: RewriteEntry[]
}
```

**出参约束**：`buildAppealPacket` 为纯函数——不读写 `localStorage`、不发网络请求、不修改入参对象、不涉及 `Date.now()`/随机数；同样的入参必须得到同样的 `AppealPacket`（便于单测断言）。

### 2.2 板块 ↔ CEO 功能点 1 映射表

| CEO 功能点 1 输出条目 | AppealPacket 板块字段 |
| --- | --- |
| 1 判决概况 | `verdict` |
| 2 多通道分歧实证 | `disagreement` |
| 3 跨域阈值失效说明 | `crossDomain` |
| 4 检索匹配度 / 最近邻 | `retrieval` |
| 5 改写前后对照 | `rewrite` |
| 6 写作过程自述占位 | `selfStatement` |

### 2.3 固定文案常量（逐字放进代码，不得改写口径）

```ts
// appealPacket.ts
export const SINGLE_PERCENTAGE_CAVEAT =
  '按本站公开口径，此分歧下任何检测网站给出的单一百分比（包括本站）都不应被引用。'

export const ETHICS_NOTICE =
  '本材料不证明作者身份，不保证申诉成功，请如实填写；虚构过程材料会构成新的学术不端，且极易在面谈中被戳穿。'

export const RETRIEVAL_NOTE =
  '检索通道是本地语料（零模型、零联网）的最近邻比对；覆盖率偏低时读数仅作定性参考，不可当分数引用。'
export const RETRIEVAL_UNAVAILABLE =
  '本次未运行检索通道，检索匹配度证据暂缺（可在结果页重新运行后刷新本证据包）。'

export const REWRITE_PLACEHOLDER =
  '（可选：附上你在"改写工作台"导出的《改写前后对照表》。若无改写记录，请如实说明，不要伪造。）'

export const SELF_PLACEHOLDER: AppealSelfStatementSection['placeholder'] = {
  timeline: '（示例：X 月 X 日完成选题与提纲；X 月 X 日完成初稿第一、二章；X 月 X 日根据导师意见重写第三章；共保存 X 个主要版本，见附件/版本历史截图。）',
  evidenceNotes: '（示例：写作软件/在线文档的版本历史截图；文献阅读笔记；与导师的沟通记录；各阶段草稿的文件修改时间。）',
  aiUsage: '（示例：未使用 AI 生成正文内容；或：仅在 X 环节使用 AI 辅助 X，相关部分已注明。）',
}

export const DEGRADED_NOTICE =
  '样本不足（需中文≥400 字或英文≥180 词，且不少于 6 句）：本次仅提供规则观察，不构成申诉依据，不产出可用的申诉信。'

// 一页纸的两句可念话术（逐字）
export const ONE_PAGER_LINES: [string, string] = [
  '这篇文章我用本站做了多通道复核，六个读数互相矛盾，我希望能一起看证据，而不是只看一个百分比。',
  '我并没有要求凭分数直接判定，而是请求对照本站公开的分歧数据与可复现的跨域测试，做一次人工复核。',
]
```

> 复用的口径：占位文本与 `buildDefenseDocument`（`defense.ts` 第 60/64/68 行）保持一致，保证新旧材料口径统一。`SINGLE_PERCENTAGE_CAVEAT` 参照 CEO 简报步骤二示例话术。

---

## 3. 逐功能点任务清单（F1–F5，按顺序实现）

### F1 · 新增证据装配器 `src/lib/appealPacket.ts`（纯函数）

- [ ] **F1.1** 新建 `src/lib/appealPacket.ts`，从 `./types` 导入 `AnalysisReport` / `RetrievalChannelResult`，从 `./report` 导入 `type RewriteEntry`，从 `./defense` 导入 `type PlatformRecord`，从 `../data/crossDomainValidation.json` 导入 JSON。
- [ ] **F1.2** 按 2.1 定义并导出全部类型与 2.3 全部常量。
- [ ] **F1.3** 实现 `buildAppealPacket(report, retrieval?, userInput?)`：
  - `sufficient = report.isSampleSufficient`；`degraded = !sufficient`；`degradedNotice = degraded ? DEGRADED_NOTICE : ''`。
  - 板块 1：按 2.1.2 逐字段取值；`judgedScore` 用 `Number(userInput.score)`，`Number.isFinite` 且落在 0–100 才保留，否则 `null`。
  - 板块 2：`channels` 取 `report.crossValidation.detectors` 映射；若 `retrieval?.status === 'done' && typeof retrieval.score === 'number'` 追加检索通道；`spread` 直接取 `report.crossValidation.spread`（**不重算**，避免与 analyzer 口径分叉）；`caveat = SINGLE_PERCENTAGE_CAVEAT`。
  - 板块 3：从 JSON 读取字段，`calibratedScoreMin/Max` 由 `perDoc` 计算；`reproduceCommand` 为固定字符串。
  - 板块 4：`available` / 各字段按 2.1.2；`nearestNeighbors` 最多 3 条；`note = available ? RETRIEVAL_NOTE : RETRIEVAL_UNAVAILABLE`。
  - 板块 5：`entries = userInput.rewriteEntries ?? []`；`hasEntries`、`placeholder` 按 2.1.2。
  - 板块 6：按 2.1.2；`isPlaceholder` 用 `trim()` 判定。
  - `ethicsNotice = ETHICS_NOTICE`。
  - 函数体内不得出现 `window` / `fetch` / `Date` / `localStorage` 引用。

### F2 · 改造申诉工作台为「证据装配台」`src/components/DefenseKit.tsx`

- [ ] **F2.1 调整 Props**：新增可选 `retrieval?: RetrievalChannelResult`。修改调用方 `src/components/Results.tsx` 第 438 行：`<DefenseKit report={report} retrieval={retr} onToast={onToast} />`（`retr` 即 Results.tsx 第 82 行的 state）。
- [ ] **F2.2 注入 packet**：`const packet = useMemo(() => buildAppealPacket(report, retrieval, { platform, score: scoreRaw, platformRecords: records, timeline, evidenceNotes, aiUsage }), [report, retrieval, platform, score, records, timeline, evidenceNotes, aiUsage])`。
- [ ] **F2.3 常驻红线横幅**：在面板顶部（步骤之前）新增显著区块，逐字显示 `packet.ethicsNotice`，样式为 `.defense-ethics-banner`（醒目但不吓退）。删除或弱化旧的第 145–146 行「五部分」说明，避免与新结构冲突。
- [ ] **F2.4 顶部「给老师的一页纸」卡片（功能点 4）**：在红线横幅下、步骤之前新增 `<OnePager packet={packet} />` 子组件（可内联）。内容：
  - 标题：`给老师的一页纸 · 本案三条最强证据`
  - **3 条本文证据**（用本文真实数据，动态生成）：
    1. `本站对本文跑出 ${n} 条独立读数（${channels 名称与分数}），通道分歧度为 ${spread}。`（n = channels.length）
    2. `本站校准模型在真实学术摘要跨域测试中，绝对分数仅 ${min}–${max}、阈值 50 灵敏度 ${Math.round(at50Sensitivity*100)}%，可复现：${reproduceCommand}。`
    3. 若 `retrieval.available && typeof retrieval.coverage === 'number'`：`检索通道覆盖率为 ${Math.round(coverage*100)}%，匹配度偏低，读数仅作定性参考。`；否则使用改写证据：`改写前后对照记录 ${rewrite.hasEntries ? rewrite.entries.length + ' 句' : '尚未附上'}。`
  - **2 句回应话术**：逐字渲染 `ONE_PAGER_LINES[0]`、`ONE_PAGER_LINES[1]`。
  - 约束：卡片内不得出现「保证 / 一定 / 证明身份 / 通过」等断言字样。
- [ ] **F2.5 分步骤装配引导**：保留现有 `records` 录入逻辑（平台名 / AI 率 / 日期），但将面板改为 4 步引导，每步展示 `packet` 中自动填充的真实数据（只读展示 + 学生补充）：
  - 步骤一「判决概况」：展示 `packet.verdict.siteReading` / `siteCalibratedScore`；录入被判平台名称与实际分数（复用现有 `record-form`）。文案：`以下为本报告已算好的读数，无需你填写。`
  - 步骤二「多通道分歧」：逐字展示模板串——`本站对本文跑出 ${packet.disagreement.channels.length} 条独立读数：${packet.disagreement.channels.map(c => `${c.name} ${c.score}`).join('、')}，通道分歧度为 ${packet.disagreement.spread}。${packet.disagreement.caveat}`（对应 CEO 步骤二示例话术）。
  - 步骤三「跨域阈值」：逐字展示——`本站校准模型训练于问答语料，在真实学术摘要跨域测试中绝对分数塌缩至 ${min}–${max}、阈值 50 灵敏度为 ${Math.round(sens*100)}%（可复现：\`${reproduceCommand}\`）。`（对应 CEO 步骤三示例话术。）
  - 步骤四「写作过程自述」：保留现有 `process-form` 三个 textarea（时间线 / 修改痕迹 / AI 使用声明），label 追加「必须如实，拒绝代写与虚构」。`packet.selfStatement.isPlaceholder=true` 时以占位文本作为 textarea 的 `placeholder` 属性（**不得写入 value**）。
- [ ] **F2.6 降级联动**：`packet.degraded` 为真时，隐藏/禁用下载与复制按钮，在步骤区顶部展示 `packet.degradedNotice`，并说明「补齐字数与句数后可生成」。不得展示可用申诉信的预览。
- [ ] **F2.7 导出按钮改造**：`generateDocument` / `copyDocument` 内改为调用 `buildAppealLetterMarkdown(packet)` 替换 `buildDefenseDocument(...)`；下载文件名改为 `reauthor-appeal-letter-${new Date().toISOString().slice(0,10)}.md`；沿用 `downloadText` 与 `navigator.clipboard.writeText` 路径，不新增导出机制。
- [ ] **F2.8 保留 `onToast` 交互**：文案维持克制，例：`申诉信已下载，请确认写作过程自述如实填写后再提交`。

### F3 · 一键导出 filled-in 申诉信 `src/lib/report.ts`

- [ ] **F3.1** 在 `report.ts` 顶部 `import type { AppealPacket } from './appealPacket'`。
- [ ] **F3.2** 新增 `buildAppealLetterMarkdown(packet: AppealPacket): string`：
  - **降级分支**：`if (packet.degraded) return ['# 规则观察说明（样本不足）','',packet.degradedNotice,'',packet.ethicsNotice].join('\n')`——明确不含可用申诉信正文、不含「申诉请求」段。
  - **正常分支**返回一份已填充的中文申诉 / 答辩信，依次包含：
    1. 标题与元信息：`# AIGC 检测结果申诉信（本案证据版）` + 生成日期 + 逐字 `packet.ethicsNotice`。
    2. `## 一、判决概况`：被判平台/分数（用户填，未填写「（待填写）」）、本站读数 `packet.verdict.siteReading` 与 `siteCalibratedScore`。
    3. `## 二、本文多通道分歧实证`：列出 `channels` 的名称与分数、分歧度 `spread`、结论标签、逐字 `caveat`。
    4. `## 三、跨域阈值失效说明`：用真实数据成句——`本站校准模型训练于 ${trainDomain}，在 ${testDomain} 跨域测试中绝对分数塌缩至 ${min}–${max}、阈值 50 灵敏度 ${Math.round(sens*100)}%（可复现：\`${reproduceCommand}\`）。`
    5. `## 四、检索匹配度 / 最近邻`：`available` 时列出 score / coverage / 最近邻 excerpt（截断 120 字）；否则写 `RETRIEVAL_UNAVAILABLE`。
    6. `## 五、改写前后对照`：`hasEntries` 时复用 `buildRewriteComparisonMarkdown(report, entries)` 的逐句对照正文（可在函数内以 `report` + `entries` 调用后截取正文；若不便取 report，则按 `RewriteEntry` 字段自行列出原文/改写/理由/分数变化，**口径与该表一致**）；否则写 `REWRITE_PLACEHOLDER`。
    7. `## 六、写作过程自述（请本人如实填写）`：三段——`isPlaceholder` 时用 `placeholder.timeline/evidenceNotes/aiUsage`，否则用用户原文。
    8. `## 七、脚注（本站公开证据 / 可复现管线）`：≥1 条，逐字给出以下引用（至少含其一，建议全列）：
       - `crossDomainValidation.json（本站跨域验证真实数字，生成于 2026-11-16）`
       - `calibratedModel.json（留出折 AUC 0.930±0.007，协议见 meta.protocol）`
       - `scripts/crossdomain-test.ts（运行：npx tsx scripts/crossdomain-test.ts）`
       - `scripts/train-model.ts`（可复现训练管线）
    9. `## 八、申诉请求（按学校流程调整）`：请求人工复核、请求检测方披露校准数据、提交过程材料、质疑单一百分比（措辞沿用 `buildDefenseDocument` 第 109–115 行的四条，保持口径一致）。
    10. 末尾逐字 `packet.ethicsNotice`。
  - 约束：不新增导出机制；`buildMarkdownReport` / `buildRewriteComparisonMarkdown` / `downloadText` 保持不变。

### F4 · 一页纸卡片（实现归入 F2.4，不新增文件）

- [ ] **F4.1** 卡片与步骤同处 `DefenseKit.tsx`；`ONE_PAGER_LINES` 从 `appealPacket.ts` 导入，不在组件内另写话术。
- [ ] **F4.2** 验收时以 DOM 文本断言：`ONE_PAGER_LINES[0]`、`ONE_PAGER_LINES[1]` 均出现；证据 3 条由数据渲染；不含禁用词。

### F5 · 测试 `src/test/appealPacket.test.ts`（新增）

- [ ] **F5.1** 构造一份含多通道分歧的 `report`（复用 `src/test/analyzer.test.ts` 中的 fixture 构造方式，或调用 `analyzeText` 生成真实 report），确保 `isSampleSufficient=true` 且 `crossValidation.detectors` 含多个不同 score。
- [ ] **F5.2** 按第 5 节 5.1–5.10 逐条写断言。
- [ ] **F5.3** 运行 `npm run check`，确认 lint + vitest（总数 ≥ 21）+ tsc + vite build 全绿。

---

## 4. 样本不足降级逻辑

- **判定条件**：直接复用 analyzer 现有字段 `report.isSampleSufficient`（`src/lib/analyzer.ts:332`：`zh>=400 || en>=180` 且 `sentences.length>=6`）。**不得在 appealPacket 里另写一套判定**，也不用 `evidenceSufficiency` 阈值替代。
- **降级触发**：`buildAppealPacket` 中 `sufficient=false` → `degraded=true`、`degradedNotice=DEGRADED_NOTICE`。
- **降级行为（三层都必须生效）**：
  1. `buildAppealLetterMarkdown(packet)` 进入降级分支，只返回「规则观察说明（样本不足）」短文档 + `degradedNotice` + `ethicsNotice`；**不产出可用申诉信**（无「申诉请求」段、无已填充正文）。
  2. `DefenseKit`（F2.6）禁用下载/复制按钮，展示 `degradedNotice`，不展示可用信预览。
  3. 一页纸卡片（F2.4）在降级时改为只显示 `degradedNotice`，不显示 3 证据 + 2 话术（话术是给可申诉场景用的）。
- **文案（逐字）**：`DEGRADED_NOTICE` 见 2.3。不得出现「样本不足但仍可尝试申诉」这类暗示可用的表述。

---

## 5. 验收清单（转写 CEO ④，逐条可勾）

开发/测试按以下编号写测试用例；每条都能独立断言通过/失败。

- [ ] **AC-1（导出信内容完整性）** 给定含多通道分歧的 `report` 构造 `packet`，`buildAppealLetterMarkdown(packet)` 的输出同时满足：① 包含 `disagreement.channels` 中**每一个**通道的分数数值；② 包含 `disagreement.spread` 数值；③ 包含 ≥1 条指向本站公开证据/可复现管线的引用（`crossDomainValidation.json` / `calibratedModel.json` / `scripts/crossdomain-test.ts` / `scripts/train-model.ts` 之一）；④ 包含写作过程自述占位符（`SELF_PLACEHOLDER` 三条或用户输入原文）；⑤ 包含 `SINGLE_PERCENTAGE_CAVEAT`；⑥ 包含 `ETHICS_NOTICE`。
- [ ] **AC-2（工作台默认自动填充）** 渲染 `DefenseKit`（`retrieval` 缺省）：① 默认视图即展示 `packet` 的自动填充证据（多通道分数、分歧度、跨域数字非空且非模板占位）；② 通过录入平台分数（触发 `records` 变化）后点击下载，得到的 Markdown 为已填充、可直接使用（包含平台名/分数与六板块正文，非仅空模板）。
- [ ] **AC-3（样本不足降级）** 构造短文本/不足 6 句使 `report.isSampleSufficient=false`：① `packet.degraded===true`；② `buildAppealLetterMarkdown(packet)` 输出**不含**「## 八、申诉请求」段；③ 输出包含 `DEGRADED_NOTICE` 与 `ETHICS_NOTICE`；④ `DefenseKit` 下载/复制按钮处于禁用态。
- [ ] **AC-4（一页纸卡片）** 渲染一页纸卡片：① 含 3 条本文证据（断言含分歧度数值、跨域 `min–max`、第三证据关键词）；② 含且仅含两条话术 `ONE_PAGER_LINES[0]`、`ONE_PAGER_LINES[1]`；③ 全文不含「保证成功 / 证明身份 / 一定能 / 包过」等断言（大小写与中文均检索）。
- [ ] **AC-5（全量质量门禁）** ① `npm test` 用例总数 ≥ 21 且全部通过；② `npm run check`（eslint + vitest + build）退出码 0；③ `buildAppealPacket` 为纯函数的间接验证：同一入参连续调用两次，深比较结果相等。

---

## 6. 风险与红线

**CEO ⑤ 硬约束（逐条复述）**：

1. **伦理红线**：所有对外文案必须带「不证明作者身份 / 不保证申诉成功 / 如实填写」口径——本 PRD 以 `ETHICS_NOTICE` 常量落到横幅、导出信首尾、一页纸，任何新增文案不得省略。
2. **一致性风险**：不可因强调「检测不可靠」而削弱本站自身可信读数（校准模型域内 AUC 0.930 等）；批评口径必须针对「任何单一百分比判决」而非本站全部能力——本 PRD 的 `SINGLE_PERCENTAGE_CAVEAT` 与脚注中「AUC 0.930±0.007」并列，正是此意。
3. **技术约束**：不破坏现有 21 项测试；保持本地隐私、零 AI 依赖；纯静态可发布 gh-pages；不引入需要后端的形态。
4. **体验风险**：自动填充不得喧宾夺主变成「又一张看不懂的图表」——始终以「学生能直接交给老师」为验收锚点（一页纸 + filled-in 信）。

**实现时最容易踩的坑（重点提醒开发）**：

| # | 坑 | 正确做法 |
| --- | --- | --- |
| 1 | 去改 `analyzer.ts` / `calibrated.ts` / `retrieval.ts` 的评分逻辑或常量 | 这三个文件**只读**；证据包只消费其产出（`report` 字段、`retrieval` 结果），分歧度 `spread` 直接取 `crossValidation.spread` 不重算 |
| 2 | 把批评口径写成「本站检测全是错的 / 本站分数不能用」 | 严格用 `SINGLE_PERCENTAGE_CAVEAT` 的口径：针对「任何单一百分比（包括本站）」，并同时保留域内 AUC 0.930、脚注可复现管线 |
| 3 | 引入联网 / AI / 后端 | 全部数据来自本地 JSON（crossDomainValidation / calibratedModel）+ `report`/`retrieval` + 用户填写；`appealPacket.ts` 不得出现 `fetch`/`window`/`Date`/`localStorage` |
| 4 | 把"写作过程自述"占位符预填成系统编造的内容 | 占位只能用 `SELF_PLACEHOLDER` 常量；学生未填 → `isPlaceholder=true` → 导出占位，不生成"看起来像真的"过程叙述 |
| 5 | 改写对照去改 `RewriteWorkbench.tsx` 或打通它的 state | 「复用数据源」= 复用 `RewriteEntry` 类型与口径；缺省即占位，不动现有组件 |
| 6 | 新增一套导出机制（新 Blob / 新剪贴板封装） | 只调 `buildAppealLetterMarkdown` + 既有 `downloadText` / `navigator.clipboard.writeText` |
| 7 | 降级时仍返回看似可用的申诉信、或按钮仍可点 | 三层降级都要落地（letter 降级分支 + DefenseKit 禁用按钮 + 一页纸降级），确保「不产出可用申诉信」 |
| 8 | `calibratedScoreMin/Max` 硬编码 0/18 | 从 `crossDomainValidation.json` 的 `perDoc` 计算；数字来源必须是真实 JSON，防止简报示例值与数据脱节 |
| 9 | 用 `evidenceSufficiency` 自定义阈值判断样本不足 | 唯一判定是 `report.isSampleSufficient`，避免与 analyzer 口径不一致 |
| 10 | 改 `defense.ts` / `report.ts` 既有函数签名 | 这两个文件只**新增**函数（`buildAppealLetterMarkdown`），旧函数（`buildDefenseDocument` / `buildMarkdownReport` / `buildRewriteComparisonMarkdown` / `downloadText`）保持签名与行为不变 |
