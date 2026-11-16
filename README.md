# ReAuthor · 重写权

**学生自己的 AI 写作特征诊断台** — 检测不是终审，解释才是起点。

> 我们需要的不是一张"像不像人"的判决书，而是一次解释自己的机会。

针对 Turnitin、ZeroGPT、Pangram 式"判决式检测"的学生立场回应：不给你一个无法申诉的百分比，而是**逐句指出证据、解释判分依据、给出修改方向**——目标不是骗过检测器，而是让论证真正变成你自己的。

## ✨ 功能

| 能力 | 说明 |
| --- | --- |
| 中英双语分析 | 自动识别语言，支持学术论文 / 课程作业 / 议论文 / 通用文本 |
| **校准模型通道（v0.5）** | 在 HC3-Chinese（3826 篇，6 领域）上以分层 5 折交叉验证训练的逻辑回归，**留出折 AUC 0.930 ± 0.007**，灵敏度/特异度约 85%，8 个特征系数全公开可复现（npx tsx scripts/train-model.ts）；红队改写攻击下 97→82 / 100→82 仍稳在高位，规则引擎则从 52 崩到 31 |
| **申诉工作台（v0.4）** | 被 Other 平台判高 AI 率后：七条可引用的公开证据（斯坦福 61.3% 误报研究、同文异判报道等）+ 多平台分歧记录器 + 一键生成五部分申诉参考材料（含如实填写的写作过程声明模板） |
| **文档导入（v0.3）** | 直接拖入或上传 **PDF / Word(.docx) / PPT(.pptx) / TXT / MD**，浏览器本地解析（扫描版 PDF 无文字层时提示手动粘贴） |
| **六样本对照基座（v0.3）** | 中英混排论文 / 中文模板 / 中文个人论证 / 中文调查报告 / 英文人写 / 英文模板，一键载入对照 |
| 五维可解释指标 | 句长节奏、模板套话、词汇重复、抽象评价、证据稀缺，全部附原始证据 |
| **交叉验证面板（v0.2）** | 四条独立证据链（词表 / 节奏 / 重复 / 证据）并排出分 + **通道分歧度**：分歧大时明确警告"任何单一百分比都不可靠" |
| **实验神经通道（v0.2）** | 浏览器本地运行 Qwen2.5-0.5B（q4 量化）：推理库从 jsdelivr 系 CDN 按序兜底加载，模型从 hf-mirror 下载后浏览器缓存，ORT wasm 自托管；换算公式全公开，标注"实验性未校准" |
| **自我校准报告（v0.2）** | 在 HC3 中文数据集（480 篇真人/AI 问答）上如实公布引擎的真实分辨力（含不体面的结果） |
| 逐句批注 | 每句给出特征值、判分依据、修改方向；保留句的优点也会标出 |
| 透明加权公式 | 总分 = 节奏×20% + 套话×25% + 重复×20% + 抽象×20% + 证据稀缺×15%，常量全公开 |
| 严谨弃权机制 | 中文 <400 字 / 英文 <180 词 / <6 句时**拒绝风险定性**，只展示规则观察 |
| 修改路线 | 按"分数贡献 × 可修改性"输出前三优先级与实际命中词表 |
| 报告导出 | Markdown 下载 / 剪贴板复制 / 打印排版 |
| 本地隐私 | 原稿只在浏览器中分析；神经通道也是本地推理，模型下载走国内镜像 |

## 🧭 设计立场

1. **证据先于结论** — 每个分数都能点开看证据，可以不同意，也可以复核。
2. **不确定就弃权** — 短文本不给定性，这是刻意的保守，不是能力缺陷。
3. **修改而非规避** — 不提供"降 AI 率"的一键洗稿，建议全部指向论证、证据与风格。

## 🔬 方法论边界（重要）

当前版本是**透明规则引擎（rules-v0.2）**，不是分类模型：

- 分数是"模板化特征指数"，**不能解释为 AI 生成概率**；
- **自我校准结果（v0.2，如实公布）**：在 [HC3 中文数据集](https://huggingface.co/datasets/Hello-SimpleAI/HC3)（open_qa / wiki_csai / finance / medicine，240 真人 vs 240 篇 ChatGPT 答案）上，本引擎 ROC AUC ≈ **0.515，接近随机**。这就是本站只做"写作特征反馈"而不宣称"检测"的原因——商业检测网站不会告诉你它们的这个数字；
- 校准管线完全可复现：`npx tsx scripts/calibrate.ts`（数据见 `calibration/`）；
- 非母语写作、规范学术文体、翻译文本可能出现类似特征，**不得用于推定作者身份或学术不端**；
- 结果应服务于作者自我修改与师生对话，不应作为处罚依据。

### 研究底稿（GitHub 调研）

真实可靠的统计检测依赖语言模型推理，这些开源实现是本项目的方法论参照与未来校准路线：

| 项目 | 参照价值 |
| --- | --- |
| [DetectGPT](https://github.com/eric-mitchell/detect-gpt) | 概率曲率；零样本检测的经典起点 |
| [Fast-DetectGPT](https://github.com/baoguangsheng/fast-detect-gpt) | 条件概率曲率；效率与模型依赖 |
| [Binoculars](https://github.com/ahans30/Binoculars) | 双模型比值；官方明确提示非英语局限、不可脱离人工监督 |
| [GLTR](https://github.com/HendrikStrobelt/detecting-fake-text) | 把统计信号变成可检查的视觉证据 |
| [LLM-Detector](https://github.com/JichengTech/LLM-Detector) | 中文 AI 文本检测的指令微调探索 |
| [C-ReD](https://github.com/HeraldofLight/C-ReD) | 中文真实提示、多领域、多生成器评测基准 |

**Roadmap v0.3**：更大规模跨生成器校准（C-ReD 多模型基准）、神经通道阈值校准与置信区间、Fast-DetectGPT 式扰动曲率的可行性评估。

## 🚀 本地运行

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run check      # eslint + vitest + tsc + vite build
```

## 📁 结构

```
src/
├── lib/analyzer.ts      # 五维规则引擎、四通道交叉验证与评分公式（公开常量）
├── lib/patterns.ts      # 中英文模板/抽象表达词表
├── lib/probability.ts   # 实验神经通道：浏览器本地困惑度 + 突发度（transformers.js）
├── lib/crosscheck.ts    # 通道分歧评估（共享常量）
├── lib/report.ts        # 修改路线与 Markdown 报告生成
├── components/          # Analyzer / Results / Methodology
├── data/samples.ts      # 对照样本文本
├── data/calibration.json # HC3 校准结果（由管线生成）
└── test/                # 单元 + 集成测试
scripts/
├── calibrate.ts         # HC3 校准管线（可复现）
├── explore.ts           # 分指标分离信号探查
└── smoke-probability.ts # 神经通道端到端冒烟测试
calibration/raw/         # HC3 中文原始子集（open_qa / wiki_csai / finance / medicine）
```

## 📄 许可

MIT — 欢迎学生社团、写作中心与教师共同迭代。
