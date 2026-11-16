# ReAuthor · 重写权

**学生自己的 AI 写作特征诊断台** — 检测不是终审，解释才是起点。

> 我们需要的不是一张"像不像人"的判决书，而是一次解释自己的机会。

针对 Turnitin、ZeroGPT、Pangram 式"判决式检测"的学生立场回应：不给你一个无法申诉的百分比，而是**逐句指出证据、解释判分依据、给出修改方向**——目标不是骗过检测器，而是让论证真正变成你自己的。

## ✨ 功能

| 能力 | 说明 |
| --- | --- |
| 中英双语分析 | 自动识别语言，支持学术论文 / 课程作业 / 议论文 / 通用文本 |
| 五维可解释指标 | 句长节奏、模板套话、词汇重复、抽象评价、证据稀缺，全部附原始证据 |
| 逐句批注 | 每句给出特征值、判分依据、修改方向；保留句的优点也会标出 |
| 透明加权公式 | 总分 = 节奏×20% + 套话×25% + 重复×20% + 抽象×20% + 证据稀缺×15%，常量全公开 |
| 严谨弃权机制 | 中文 <400 字 / 英文 <180 词 / <6 句时**拒绝风险定性**，只展示规则观察 |
| 修改路线 | 按"分数贡献 × 可修改性"输出前三优先级与实际命中词表 |
| 报告导出 | Markdown 下载 / 剪贴板复制 / 打印排版 |
| 本地隐私 | 原稿只在浏览器中分析，不上传服务器、不存储 |

## 🧭 设计立场

1. **证据先于结论** — 每个分数都能点开看证据，可以不同意，也可以复核。
2. **不确定就弃权** — 短文本不给定性，这是刻意的保守，不是能力缺陷。
3. **修改而非规避** — 不提供"降 AI 率"的一键洗稿，建议全部指向论证、证据与风格。

## 🔬 方法论边界（重要）

当前版本是**透明规则引擎（rules-v0.1）**，不是经过代表性语料校准的分类模型：

- 分数是"模板化特征指数"，**不能解释为 AI 生成概率**；
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

**Roadmap v0.2**：接入本地可运行的开放权重模型（Binoculars / Fast-DetectGPT 类），用 C-ReD 等中文基准校准阈值，并在 UI 中同时报告"分数 + 置信区间 + 误判率"。

## 🚀 本地运行

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run check      # eslint + vitest + tsc + vite build
```

## 📁 结构

```
src/
├── lib/analyzer.ts      # 五维规则引擎与评分公式（公开常量）
├── lib/patterns.ts      # 中英文模板/抽象表达词表
├── lib/report.ts        # 修改路线与 Markdown 报告生成
├── components/          # Analyzer / Results / Methodology
├── data/samples.ts      # 对照样本文本
└── test/                # 9 个单元 + 集成测试
```

## 📄 许可

MIT — 欢迎学生社团、写作中心与教师共同迭代。
