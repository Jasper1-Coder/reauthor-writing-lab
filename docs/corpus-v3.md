# 语料 v3：训练基座盘点、切分与边界

生成脚本：`scripts/corpus_build_v3.py`（构建） / `scripts/corpus_audit_v3.py`（自检）
产物：`calibration/corpus/v3/{docs,train,holdout}.jsonl` + `stats.json`
随机种子 `20261117`，holdout 目标 20%，按 question 分组切分。

## 1. 数据源盘点

原有 10 个子集经复核，与任务描述基本一致（合计 51,245 条回答；实测 human 27,733 / ai 23,512，比描述各多 1 条，差异来自 `human_answers` 中出现 `null` 时的计数方式）。

本次新增 2 个此前缺失的 HC3 子集，**原样下载、未改动任何已有文件**：

| 文件 | 大小 | 来源 | 说明 |
|---|---|---|---|
| `calibration/raw/reddit_eli5.jsonl` | 55,448,695 B（52.9 MiB） | `Hello-SimpleAI/HC3` → `reddit_eli5.jsonl` | 英文 r/explainlikeimfive 口语问答，17,112 个问题 |
| `calibration/raw/zh_nlpcc_dbqa.jsonl` | 2,024,303 B（1.9 MiB） | `Hello-SimpleAI/HC3-Chinese` → `nlpcc_dbqa.jsonl` | 中文 NLPCC 开放域问答，1,709 个问题 |

两个文件下载后字节数与 HF 返回的 `X-Linked-Size` 完全一致，JSON 解析 0 失败行。
许可证：两库同为 **CC BY-SA 4.0**（HF 数据集卡片 `license:cc-by-sa-4.0`），论文 arXiv:2301.07597。
下载未被 150MB 限制阻断；`HC3` 全库 `usedStorage` 1.5GB 主要是 parquet 副本，单文件本身很小。
`HC3-Chinese` 共 7 个子集（baike/finance/law/medicine/nlpcc_dbqa/open_qa/psychology），除 nlpcc_dbqa 外均已存在；不存在 `zh_chatgpt` 子集。
`HC3` 英文共 5 个子集，除 reddit_eli5 外均已存在。**可获取的子集现已全部入库，无剩余缺口。**

## 2. 各来源规模（过滤后，人类 / AI 分列）

`d`=文档数，`c`=字符数，`s`=句数（按 `。！？!?;；` 与句点换行粗切）

| domain | human | ai |
|---|---|---|
| en_finance | 3,926 d / 3,918,617 c / 36,250 s | 4,500 d / 5,468,583 c / 25,768 s |
| en_medicine | 1,246 d / 626,165 c / 6,690 s | 1,334 d / 1,520,524 c / 12,591 s |
| en_open_qa | 1,178 d / 221,542 c / 1,456 s | 3,536 d / 2,555,992 c / 16,093 s |
| en_reddit_eli5 | 51,011 d / 33,977,386 c / 341,428 s | 16,660 d / 16,648,543 c / 131,455 s |
| en_wiki_csai | 842 d / 1,095,985 c / 8,355 s | 842 d / 991,719 c / 6,777 s |
| zh_baike | 4,614 d / 959,056 c / 19,664 s | 4,613 d / 664,111 c / 17,280 s |
| zh_finance | 786 d / 111,271 c / 2,473 s | 1,937 d / 415,762 c / 11,422 s |
| zh_law | 206 d / 15,634 c / 469 s | 500 d / 122,838 c / 3,250 s |
| zh_medicine | 1,061 d / 168,689 c / 3,513 s | 1,074 d / 294,452 c / 8,348 s |
| zh_nlpcc_dbqa | 787 d / 69,735 c / 1,200 s | 3,896 d / 592,785 c / 14,520 s |
| zh_open_qa | 6,552 d / 1,125,264 c / 31,797 s | 3,933 d / 1,033,554 c / 30,018 s |
| zh_psychology | 5,220 d / 1,063,498 c / 31,434 s | 1,088 d / 305,808 c / 8,891 s |

合计 **121,342 篇 / 73,967,513 字符**（human 77,429 篇、ai 43,913 篇，AI 占比 0.362）。

过滤规则：去空白后 < 40 字符丢弃 3,861 条；非字符串字段 27 条；无字母/汉字 0 条。共丢弃 3,888 条（占原始回答 3.1%）。

## 3. 切分

- **分组键** = 归一化 question 的 SHA-1 前 16 位（小写、压缩空白）。同一问题的 human 与 ai 答案必然同组；跨文件重复提问也会被合并进同一组，比「文件名#行号」更严格。
- 每个 domain 内按 `sha256(seed:group)` 排序，顺序累加文档数至该 domain 总量的 20% 划入 holdout。
- 共 **36,300 组**，holdout 组 7,248，平均每组 3.343 篇。组内文档数差异大（reddit 单问题最多几十条评论），故用「按文档数配额」而非「按组数配额」。

| domain | train h/a | holdout h/a | holdout h% / a% |
|---|---|---|---|
| en_finance | 3,146 / 3,594 | 780 / 906 | 0.199 / 0.201 |
| en_medicine | 996 / 1,068 | 250 / 266 | 0.201 / 0.199 |
| en_open_qa | 941 / 2,827 | 237 / 709 | 0.201 / 0.201 |
| en_reddit_eli5 | 40,799 / 13,335 | 10,212 / 3,325 | 0.200 / 0.200 |
| en_wiki_csai | 673 / 673 | 169 / 169 | 0.201 / 0.201 |
| zh_baike | 3,691 / 3,690 | 923 / 923 | 0.200 / 0.200 |
| zh_finance | 614 / 1,564 | 172 / 373 | 0.219 / 0.193 |
| zh_law | 164 / 398 | 42 / 102 | 0.204 / 0.204 |
| zh_medicine | 850 / 857 | 211 / 217 | 0.199 / 0.202 |
| zh_nlpcc_dbqa | 619 / 3,127 | 168 / 769 | 0.213 / 0.197 |
| zh_open_qa | 5,256 / 3,132 | 1,296 / 801 | 0.198 / 0.204 |
| zh_psychology | 4,172 / 872 | 1,048 / 216 | 0.201 / 0.199 |

train 97,058 篇 / holdout 24,284 篇，实际 holdout 占比 **0.2001**。
zh_finance（0.219/0.193）与 zh_nlpcc_dbqa（0.213/0.197）偏离最大，原因是这两个域组内文档数不均（人类答案少、AI 答案多），配额按总文档数而非按标签分配。

**泄漏校验**（`python scripts/corpus_audit_v3.py`，独立重读两个 JSONL 后计算）：

```
groups overlap  : 0  (must be 0)
dup ids across  : 0  (must be 0)
PASS: group-disjoint split, no duplicate ids
```

## 4. 语言分布

判定式：`CJK 字符数 / (CJK + 拉丁字母数) ≥ 0.30 → zh`，分母刻意剔除数字与标点（中文百科与问答里 CIP、snprintf、`SET /A` 这类拉丁片段密集，用「非空白字符」当分母会把明显的中文判成 en）。

| lang | 文档 | 字符 | human / ai |
|---|---|---|---|
| zh | 35,766 | 6,710,476 | 19,134 / 16,632 |
| en | 85,576 | 67,257,037 | 58,295 / 27,281 |

中文只占 **9.1% 的字符**、29.5% 的文档。这是英文子集本身更长（尤其 reddit 长评）所致，不是采样偏差。
与来源声明语言不一致 502 篇（占 0.4%），抽查确认基本是真实英文内容混在中文子集里（中文子集内 ChatGPT 的英文拒答），非判定错误。

## 5. 必须知道的偏差（会影响模型能力边界）

1. **英文与 reddit 严重过重**：`en_reddit_eli5` 单域占 55.8% 文档 / 68.4% 字符。若直接训练，模型会偏向「口语化英文长文 = 人类」。下游训练建议对该域降采样或加权，否则中文与学术类指标会被稀释。
2. **拒绝模板是可被利用的捷径**：43,913 篇 AI 文本中 1,563 篇（3.56%）以「I'm sorry / 作为一个 AI / 抱歉」开头。这类样本会让模型学到句式模板而非文风，建议训练时单列统计，勿据此宣称检测能力。
3. **正负样本不平衡**：human:ai ≈ 1.76:1；且 zh_law 人类侧仅 206 篇，该域结论不可靠。
4. **同题可比性**：human 与 ai 是同一问题的两种回答，句数不可比（reddit 人类侧是多条评论拼接），按文档平均长度做特征时必须按组归一。

## 6. 诚实披露（数据决定了模型边界，请勿越界宣传）

- **AI 侧文本只来自 2023 年初的 ChatGPT（gpt-3.5 一代）**，由 HC3 于 2023-01 采集。它不代表 2024–2026 年的 GPT-4/4o/Claude/Gemini/DeepSeek 等模型；对新一代模型的检测能力**未知，且很可能显著下降**。任何指标都必须标注「对 2023 版 ChatGPT 有效」。
- **HC3 是问答语料**（百科/金融/法律/医学/心理/开放域/Reddit），**不是学术写作**。学生论文、课程报告、实验报告的文体特征不在此分布内。外部测试集 `crossdomain/academic_zh.jsonl` 正是为此设立，**从未进入本语料**（自检已确认 0 篇来自 academic），其结果只能作为跨域外推的下界参考。
- reddit_eli5 与 nlpcc_dbqa 是本次新增的分布外补充，前者口语、后者短问答，可提升泛化，但不改变上述两条边界。

## 7. 复现与产物

```bash
python scripts/corpus_build_v3.py   # 重建 docs/train/holdout + stats.json
python scripts/corpus_audit_v3.py   # 自检，泄漏非 0 则退出码 1
```

| 文件 | 大小 | 行数 |
|---|---|---|
| `docs.jsonl` | 106.6 MB | 121,342 |
| `train.jsonl` | 85.3 MB | 97,058 |
| `holdout.jsonl` | 21.3 MB | 24,284 |

单行结构：`{id, group, domain, lang, label, chars, text}`，train/holdout 另加 `split`。
注意：三个 JSONL 合计约 213 MB，且 `calibration/raw/` 已在 `.gitignore` 中。是否把 v3 语料入库需单独决定（直接提交会让仓库膨胀百 MB），建议入库前改为 gzip 或只保留 stats 与采样。
