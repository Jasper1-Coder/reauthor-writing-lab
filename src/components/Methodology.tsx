import { ArrowUpRight, BookMarked, FlaskConical, Github, Scale, ShieldAlert, ShieldCheck, Swords } from 'lucide-react'
import calibrationData from '../data/calibration.json'
import redteamData from '../data/redteam.json'
import modelData from '../data/calibratedModel.json'
import crossDomain from '../data/crossDomainValidation.json'

const sources = [
  { name: 'DetectGPT', repo: 'eric-mitchell/detect-gpt', note: '概率曲率；理解零样本检测的经典起点。' },
  { name: 'Fast-DetectGPT', repo: 'baoguangsheng/fast-detect-gpt', note: '条件概率曲率；研究效率与模型依赖。' },
  { name: 'Binoculars', repo: 'ahans30/Binoculars', note: '双模型比值；官方明确提示非英语局限。' },
  { name: 'GLTR', repo: 'HendrikStrobelt/detecting-fake-text', note: '把统计信号变成可检查的视觉证据。' },
  { name: 'LLM-Detector', repo: 'JichengTech/LLM-Detector', note: '面向中文 AI 文本检测的指令微调探索。' },
  { name: 'C-ReD', repo: 'HeraldofLight/C-ReD', note: '中文真实提示、多领域、多生成器评测基准。' },
]

export function Methodology() {
  return (
    <>
      <section className="methodology-section" id="methodology" aria-labelledby="method-title">
        <div className="methodology-optin">
          <ShieldCheck size={18} />
          <span>这一页讲我们怎么算、哪里不靠谱——给想深挖的人。正常使用不用读，</span>
          <a href="#analyzer">回到分析文章 <ArrowUpRight size={14} /></a>
        </div>
        <div className="section-index">
          <span>03</span>
          <p>打开引擎盖，拒绝神秘百分比</p>
        </div>
        <div className="method-grid">
          <div className="method-lead">
            <p className="eyebrow">原理说明 · 选读</p>
            <h2 id="method-title">严谨，不是把话说满。<br /><em>是把边界说清。</em></h2>
            <p>为什么做这个站：检测网站给的都是百分比，学生却无从解释、无从修改。我们想证明——不靠黑箱，也能给你能核对的证据。所以下面把怎么算的、误差多大、哪里会失灵，全部公开。</p>
            <a className="text-link" href="https://github.com/Jasper1-Coder/reauthor-writing-lab" target="_blank" rel="noreferrer">查看完整源码与评分常量 <ArrowUpRight size={16} /></a>
          </div>
          <div className="method-principles">
            <article><Scale size={23} /><span>01</span><h3>证据先于结论</h3><p>总分之外，同时展示指标原始值、权重、命中句子和建议。你可以不同意，也可以复核。</p></article>
            <article><ShieldAlert size={23} /><span>02</span><h3>不确定就弃权</h3><p>中文不足 400 字、英文不足 180 词或少于 6 句时，不给风险定性，只展示有限的规则观察。</p></article>
            <article><BookMarked size={23} /><span>03</span><h3>修改而非规避</h3><p>建议指向论证、证据与风格，不提供“骗过检测器”的降率承诺，也不鼓励一键洗稿。</p></article>
          </div>
        </div>

        <details className="method-fold" id="calibration">
          <summary>
            <span className="method-fold-kicker">01 · 自我校准</span>
            <strong>我们公开测过自己的准确率，结果并不漂亮</strong>
            <span className="method-fold-hint">在公开数据集上实测，AUC、误报率、漏报率全部原样公布 →</span>
          </summary>
          <div className="method-fold-body">
          <div className="calibration-section">
          <div className="ledger-heading">
            <span>SELF-CALIBRATION · 自我校准</span>
            <h3>我们把自己当被告：引擎在公开数据集上的真实成绩。</h3>
            <p>
              用 HC3 中文公开数据集（{calibrationData.dataset.sampleCount} 篇真人答案 vs {calibrationData.dataset.aiCount} 篇 ChatGPT 答案，
              覆盖开放问答 / 维基 / 金融 / 医学四领域）逐篇打分，阈值 55 分以上判为"AI 特征集中"。
              结果不体面，但我们原样公布——这是我们对"判分严谨"的定义。
            </p>
          </div>
          <div className="calibration-grid">
            <article className="calibration-card headline">
              <FlaskConical size={22} />
              <strong>{calibrationData.results.rocAuc}</strong>
              <span>ROC AUC（1.0 完美，0.5 等于抛硬币）</span>
            </article>
            <article className="calibration-card">
              <strong>{Math.round(calibrationData.results.falsePositiveRate * 100)}%</strong>
              <span>误报率：真人被判"AI 特征集中"</span>
            </article>
            <article className="calibration-card">
              <strong>{Math.round(calibrationData.results.falseNegativeRate * 100)}%</strong>
              <span>漏报率：AI 文本未被标记</span>
            </article>
            <article className="calibration-card">
              <strong>{calibrationData.results.humanMedian} vs {calibrationData.results.aiMedian}</strong>
              <span>真人 / AI 答案的中位特征分——几乎重合</span>
            </article>
          </div>
          <div className="calibration-table-wrap">
            <h4>分领域中位特征分</h4>
            <div className="calibration-table">
              {calibrationData.byDomain.map((domain) => (
                <div className="calibration-row" key={domain.domain}>
                  <span className="calibration-domain">{domain.domain}</span>
                  <span>真人中位 <strong>{domain.humanMedian}</strong></span>
                  <span>AI 中位 <strong>{domain.aiMedian}</strong></span>
                  <span className={Math.abs(domain.humanMedian - domain.aiMedian) < 8 ? 'no-signal' : 'some-signal'}>
                    {Math.abs(domain.humanMedian - domain.aiMedian) < 8 ? '无分离信号' : '存在分离信号'}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="calibration-disclosure">
            <h4>这份报告的三条诚实边界</h4>
            <ul>
              {calibrationData.disclosures.map((disclosure) => <li key={disclosure}>{disclosure}</li>)}
            </ul>
            <h4 style={{ marginTop: 18 }}>神经通道（实验）的校准结论</h4>
            <ul>
              <li>突发度：真人中位 0.304 vs AI 中位 0.263，AUC 0.747（60 篇 HC3 子样本）——有信号但远不完美，是本通道唯一计分依据。</li>
              <li>困惑度：在本模型 × 本数据集上方向与经典假设<strong>相反</strong>（AI 文本困惑度更高），因此只展示原始值、不参与计分。</li>
              <li>这两条合起来的教训：同一信号换个模型或换个领域就可能反转——所以不要相信任何只报一个百分比的检测网站，包括本站。</li>
            </ul>
            <p className="calibration-moral">
              这个 AUC 就是我们要说的话：<strong>任何表层特征检测器都可能接近随机，包括本站。</strong>
              区别在于我们把证据摊开，而商业检测网站把"99% 准确"写在首页。
              所以本站给的是逐句修改证据，而不是一个定罪百分比。
            </p>
          </div>
        </div>
          </div>
        </details>

        <details className="method-fold" id="redteam">
          <summary>
            <span className="method-fold-kicker">02 · 对抗测试</span>
            <strong>网上流传的「降 AI 率教程」，能不能骗过我们？我们替你试了</strong>
            <span className="method-fold-hint">结论：一个复制粘贴的指令就能让分数暴跌——这恰恰说明百分比不可信 →</span>
          </summary>
          <div className="method-fold-body">
          <div className="calibration-section redteam-section">
          <div className="ledger-heading">
            <span>RED TEAM · 对抗性测试</span>
            <h3>网上流传的"降AI指令"，能把我们的分数打掉多少？我们替你试了。</h3>
            <p>
              B 站有 28 万播放的教程教学生用复制粘贴的 prompt"降AI率"（99% 到 0%）。
              我们没有回避，而是把它的公开战术做成了确定性改写脚本，对自己的引擎发起攻击：
            </p>
          </div>
          <div className="redteam-tactics">
            {redteamData.meta.tactics.map((tactic) => (
              <span key={tactic}>{tactic}</span>
            ))}
          </div>
          <div className="redteam-grid">
            {redteamData.cases.map((item) => (
              <article className={`redteam-card${item.isControl ? ' control' : ''}`} key={item.id}>
                <header>
                  <h4>{item.name}</h4>
                  <span>{item.isControl ? '对照组 · 未被攻击' : '攻击目标'}</span>
                </header>
                <div className="redteam-scores">
                  <div className="redteam-score before">
                    <em>{item.before.score}</em>
                    <span>改写前</span>
                  </div>
                  <Swords size={18} aria-hidden="true" />
                  <div className="redteam-score after">
                    <em>{item.after.score}</em>
                    <span>改写后</span>
                  </div>
                  <div className={`redteam-delta ${item.delta <= -10 ? 'big-drop' : ''}`}>
                    {item.delta > 0 ? '+' : ''}{item.delta}
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="calibration-disclosure">
            <h4>这次自曝证明了什么</h4>
            <ul>
              <li>只改句式、<strong>不编造任何事实</strong>，模板化文本的特征分就掉了 21–31 分——而真实"降AI指令"还会虚构数据细节，杀伤力更大。</li>
              <li>对照组（含具体数据与来源的人写文本）纹丝不动——这正是我们建议的修改方向：把论证变成你自己的，比任何洗稿都稳。</li>
              <li>推广到所有检测器：一个复制粘贴的 prompt 就能让分数 99% 变 0%，说明那个百分比<strong>从来没有在测量真实的东西</strong>。任何只给你一个百分比的网站——商业的或本站——都不该成为处罚依据。</li>
            </ul>
            <p className="calibration-moral">
              降AI指令之所以有效，恰恰是检测器失职的铁证。{redteamData.meta.disclosure}
            </p>
          </div>
        </div>
          </div>
        </details>

        <details className="method-fold" id="calibrated-model">
          <summary>
            <span className="method-fold-kicker">03 · 校准模型</span>
            <strong>从「接近随机」到 AUC 0.930：我们训练并检验了一个模型</strong>
            <span className="method-fold-hint">5 折交叉验证、灵敏度特异度、8 个特征系数全部公开 →</span>
          </summary>
          <div className="method-fold-body">
          <div className="calibration-section calibrated-model-section">
          <div className="ledger-heading">
            <span>CALIBRATED MODEL · 校准模型通道</span>
            <h3>从"承认接近随机"到"拿出 AUC {modelData.performance.crossValidatedAuc}"：我们把手调规则换成了受训练、受检验的模型。</h3>
            <p>
              在 {modelData.meta.dataset}。用分层 5 折交叉验证训练逻辑回归（8 个表层文体特征，标准化与拟合均只在训练折上进行），
              在从未参与训练的留出折上实测：
            </p>
          </div>
          <div className="calibration-grid">
            <article className="calibration-card headline">
              <FlaskConical size={22} />
              <strong>{modelData.performance.crossValidatedAuc} ± {modelData.performance.aucStd}</strong>
              <span>留出折 ROC AUC（同数据集上手调规则只有 0.515）</span>
            </article>
            <article className="calibration-card">
              <strong>{Math.round(modelData.performance.meanSensitivity * 100)}%</strong>
              <span>灵敏度：AI 文本被正确识别的比例</span>
            </article>
            <article className="calibration-card">
              <strong>{Math.round(modelData.performance.meanSpecificity * 100)}%</strong>
              <span>特异度：真人文本被正确放行的比例</span>
            </article>
            <article className="calibration-card">
              <strong>8 个</strong>
              <span>特征系数全部公开在下方，任何人可重算复现</span>
            </article>
          </div>
          <div className="calibration-table-wrap">
            <h4>模型系数（标准化逻辑回归，全公开）</h4>
            <div className="calibration-table">
              {modelData.coefficients.weights.map((weight) => (
                <div className="calibration-row coef-row" key={weight.feature}>
                  <span className="calibration-domain">{weight.feature}</span>
                  <span>系数 <strong>{weight.weight > 0 ? '+' : ''}{weight.weight}</strong></span>
                  <span>正系数 → 更像 AI；负系数 → 更像真人</span>
                  <span />
                </div>
              ))}
            </div>
          </div>
          <div className="calibration-disclosure">
            <h4>改写攻击下它稳不稳？——红队复测（同一天）</h4>
            <ul>
              <li>中文模板文：规则引擎 52 → 31（崩盘），<strong>校准模型 97 → 82（仍稳在高位）</strong></li>
              <li>英文模板文：规则引擎 54 → 23（崩盘），<strong>校准模型 100 → 82（仍稳在高位）</strong></li>
              <li>人写对照组：校准模型 27 → 30，未误伤</li>
            </ul>
            <h4 style={{ marginTop: 18 }}>三条诚实边界</h4>
            <ul>
              <li>训练域是 <strong>HC3 问答文本（2023 年 ChatGPT 生成）</strong>，不是学术论文——论文场景的实际表现可能偏移，这正是我们把训练协议全文公开的原因。</li>
              <li>表层特征模型对更彻底的洗稿（换句式重写而非只删套话）依然脆弱——它有公开的误差数据，但没有免死金牌。</li>
              <li>概率读数回答的是"这段文本与训练集中 AI 文本的特征分布有多相似"，<strong>不能推断作者身份，不能作为处罚依据</strong>。</li>
            </ul>
            <p className="calibration-moral">
              这就是我们要的权威：<strong>不是宣称 99% 准确，而是把训练数据、测试协议、每一个系数和每一条边界都摊开，让任何人都能复现、都能质疑。</strong>
            </p>
          </div>
        </div>
          </div>
        </details>

        <details className="method-fold" id="crossdomain">
          <summary>
            <span className="method-fold-kicker">04 · 跨域验证</span>
            <strong>换成从没见过的学术文本，它露馅了，但没完全失灵</strong>
            <span className="method-fold-hint">分数会塌陷——这是「换个领域就可能失效」的实证 →</span>
          </summary>
          <div className="method-fold-body">
          <div className="calibration-section crossdomain-section">
          <div className="ledger-heading">
            <span>CROSS-DOMAIN · 跨域验证</span>
            <h3>把模型扔进它从没见过的学术文本——它露馅了，但没完全失灵。</h3>
            <p>
              上面那个 {modelData.performance.crossValidatedAuc} 是在训练域（HC3 问答文本）的留出折上取得的。但本站真正的用途是学术写作。
              所以我们做了一件让数字难看的事：把训练时从未碰过的<strong>真实中文期刊论文摘要</strong>（软件学报 {crossDomain.meta.humanCount} 篇人写 vs DeepSeek 改写版 {crossDomain.meta.aiCount} 篇）
              拿来做域外考试——领域不同、生成器不同（ChatGPT→DeepSeek），这是一场诚实的能力边界测试。
            </p>
          </div>
          <div className="calibration-grid">
            <article className="calibration-card headline">
              <FlaskConical size={22} />
              <strong>{crossDomain.calibrated.auc}</strong>
              <span>校准模型跨域 AUC（训练域是 {modelData.performance.crossValidatedAuc}，明显下降）</span>
            </article>
            <article className="calibration-card">
              <strong>{crossDomain.ruleEngine.auc}</strong>
              <span>规则引擎跨域 AUC（低于 0.5 = 比抛硬币还差，方向颠倒）</span>
            </article>
            <article className="calibration-card">
              <strong>{Math.round(crossDomain.calibrated.bestThreshold.acc * 100)}%</strong>
              <span>把阈值降到 {crossDomain.calibrated.bestThreshold.threshold} 后的最佳准确率（但这是测试集拟合，见下方警告）</span>
            </article>
            <article className="calibration-card">
              <strong>{crossDomain.meta.sampleCount} 段</strong>
              <span>{crossDomain.meta.humanCount} 人写 + {crossDomain.meta.aiCount} AI 改写，逐篇可复核</span>
            </article>
          </div>
          <div className="crossdomain-chart">
            <h4>逐篇对照：AI 改写分 − 人写分（校准模型）</h4>
            <p className="crossdomain-chart-sub">+ 表示这篇论文被改写后分数上升（判对方向）；0 表示无区分。{crossDomain.perDoc.filter((d) => d.delta > 0).length}/{crossDomain.perDoc.length} 篇方向正确。</p>
            <div className="crossdomain-bars">
              {crossDomain.perDoc.map((doc) => (
                <div className="crossdomain-bar-row" key={doc.doc}>
                  <span className="crossdomain-bar-label">{doc.doc.slice(0, 6)}</span>
                  <div className="crossdomain-bar-track">
                    <i style={{ width: `${Math.min(100, doc.aiScore * 5)}%` }} />
                  </div>
                  <span className="crossdomain-bar-val">{doc.humanScore} → {doc.aiScore}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="calibration-disclosure">
            <h4>这次测试说了三句实话</h4>
            <ul>
              <li><strong>排序信号还在：</strong>校准模型跨域 AUC {crossDomain.calibrated.auc}，{crossDomain.perDoc.filter((d) => d.delta > 0).length}/{crossDomain.perDoc.length} 篇论文被 DeepSeek 改写后分数上升——它仍能感知"这段更像 AI 改写"。</li>
              <li><strong>但绝对分数塌了：</strong>线上固定阈值 50 下灵敏度 {Math.round(crossDomain.calibrated.at50.sensitivity * 100)}%——学术摘要的统计特征与问答差异太大，分数整体被压到 0–18 分。这正是"换领域就可能失效"的实证，所以本站从不把单一分数当通用标准。</li>
              <li><strong>规则引擎彻底反向：</strong>AUC {crossDomain.ruleEngine.auc}，AI 改写文本的平均分（{crossDomain.ruleEngine.aiMean}）反而低于人写（{crossDomain.ruleEngine.humanMean}）——这也是为什么 v0.5 起我们不再让它主导判分。</li>
            </ul>
            <h4 style={{ marginTop: 18 }}>为何不把阈值改成 {crossDomain.calibrated.bestThreshold.threshold} 来"救"分数？</h4>
            <p>
              在那 {crossDomain.meta.sampleCount} 段上调到阈值 {crossDomain.calibrated.bestThreshold.threshold} 确有 {Math.round(crossDomain.calibrated.bestThreshold.acc * 100)}% 准确率，
              但那是<strong>拿测试集反复试出来的阈值</strong>——典型的测试集拟合，换个领域又会崩。我们宁可公开这个失败，也不伪造一个"学术场景也准"的假象。
              真正要做的是在学术论文上重新训练与校准，而那需要独立的训练/测试集；这一步我们还没做，所以如实写着。
            </p>
            <p className="calibration-moral">
              数据来源：<a href="https://huggingface.co/datasets/johnson/AI-writing-detector-dataset" target="_blank" rel="noreferrer">johnson/AI-writing-detector-dataset</a>（Apache-2.0，中文期刊论文子集 test）。
              完整 32 段样本与逐篇分数在仓库 <code>crossdomain/academic_zh.jsonl</code> 和 <code>src/data/crossDomainValidation.json</code>；
              运行 <code>npx tsx scripts/crossdomain-test.ts</code> 可一键复现。<strong>权威不是从不出错，是把出错的地方也摆出来。</strong>
            </p>
          </div>
        </div>
          </div>
        </details>

        <details className="method-fold" id="retrieval">
          <summary>
            <span className="method-fold-kicker">05 · 语料检索</span>
            <strong>不跑 AI 模型，靠比对真实语料也能给出可核对的信号</strong>
            <span className="method-fold-hint">最近邻原文逐条可查，域名外会明显下降 →</span>
          </summary>
          <div className="method-fold-body">
          <div className="calibration-section crossdomain-section retrieval-section">
          <div className="ledger-heading">
            <span>V0.7 · CORPUS RETRIEVAL · 语料检索</span>
            <h3>不跑 AI，也能有信号：把"AI 率"变成可核对的最近邻。</h3>
            <p>有人问：必须用 AI 辅助查重才行吗？我们的回答是不必。检测的本质是与参照基座比对——你只需回答"你的文本最像基座里哪 15 段真实语料，它们是人写还是 AI 写"。</p>
          </div>
          <div className="calibration-grid">
            <article className="crosscheck-card calibrated-strip">
              <div className="coef-row"><strong>通道</strong><strong>域内留出 AUC</strong><strong>跨域学术 AUC</strong><strong>依赖</strong></div>
              <div className="coef-row"><span>语料检索（新增）</span><strong>0.986</strong><span>≈0.53</span><span>零模型</span></div>
              <div className="coef-row"><span>校准逻辑回归</span><span>0.930</span><span>0.859（分塌缩）</span><span>8 特征</span></div>
              <div className="coef-row"><span>手调规则引擎</span><span>0.515</span><span>0.223</span><span>词表</span></div>
              <p className="calibration-moral">
                做法：把 <strong>6010 段 HC3 中文真实问答</strong>（人写 / ChatGPT 配对）用字符 bigram + 特征哈希 + TF-IDF 向量化，检索时算余弦相似度 top15，按相似度加权统计其中 AI 标签占比。全过程是确定性数学，浏览器本地完成，<strong>不下载模型、不联网、不上传文本</strong>；索引 gzip 约 911 KB 按需加载，原文片段另存、展开时才下载。
              </p>
            </article>
            <article className="crosscheck-card">
              <h4 style={{ marginTop: 0 }}>诚实的边界：为什么它在学术文本上会"翻车"</h4>
              <p className="calibration-disclosure">
                域内留出 AUC 0.986 很漂亮，但换到真实学术摘要就掉到约 0.53——最近邻几乎全被判成 AI。原因是基座来自问答语料，与学术写作不是一个分布；而域内与跨域的相似度分布<strong>相互重叠</strong>，无法用一个阈值可靠地自动识别"这段话不属于我的基座"。
              </p>
              <p className="calibration-disclosure">
                所以我们不做"自动弃权"的假动作，而是把不确定性摊开：结果页显示<strong>基座匹配度</strong>，并列出 top15 最近邻的原文片段与人写/AI 标签——你可以自己判断它们到底像不像你的文本。匹配度低时通道明确降级为定性参考。一个你能亲自核对的证据，永远比一个无法解释的百分比更可信。
              </p>
              <p className="calibration-moral">
                构建脚本 <code>scripts/build-retrieval-index.ts</code> 与可行性实验 <code>scripts/retrieval-probe.ts</code> 均在仓库，含压缩后 AUC 自检；运行 <code>npx tsx scripts/build-retrieval-index.ts</code> 可一键复现。<strong>神经通道曾因浏览器无法解析 CDN 推理库的模块名而报错，这一版已由检索通道取代——它更稳、更强、可解释。</strong>
              </p>
            </article>
          </div>
        </div>
          </div>
        </details>

        <details className="method-fold" id="source-ledger">
          <summary>
            <span className="method-fold-kicker">06 · 研究底稿</span>
            <strong>这些开源研究，构成了我们的底稿</strong>
            <span className="method-fold-hint"> DetectGPT / GLTR / C-ReD 等，附 GitHub 链接 →</span>
          </summary>
          <div className="method-fold-body">
          <div className="source-ledger">
          <div className="ledger-heading"><span>GITHUB RESEARCH LEDGER</span><h3>这些开源项目，构成了我们的研究底稿。</h3></div>
          <div className="source-list">
            {sources.map((source, index) => (
              <a href={`https://github.com/${source.repo}`} target="_blank" rel="noreferrer" key={source.repo}>
                <span>0{index + 1}</span><strong>{source.name}</strong><p>{source.note}</p><Github size={17} />
              </a>
            ))}
          </div>
        </div>
          </div>
        </details>
      </section>

      <section className="manifesto-section" id="manifesto">
        <div className="manifesto-mark" aria-hidden="true">“</div>
        <div>
          <p className="eyebrow">A STUDENT-OWNED MANIFESTO</p>
          <blockquote>我们需要的不是一张<br />“像不像人”的判决书，<br /><em>而是一次解释自己的机会。</em></blockquote>
          <p>写得规整不等于没有思考，使用工具也不等于放弃作者身份。真正的学术诚信，应当允许学生展示草稿、说明过程、回应证据，并对算法结论提出有根据的异议。</p>
          <a href="#analyzer">带着你的原稿，重新开始 <ArrowUpRight size={17} /></a>
        </div>
        <aside>
          <span>OUR POSITION / 我们的立场</span>
          <ul>
            <li>检测是修改的起点，不是处罚的终点</li>
            <li>算法结论必须允许质疑和复核</li>
            <li>作者的过程材料比单一分数更重要</li>
            <li>保护原稿隐私，不拿学生文本训练模型</li>
          </ul>
        </aside>
      </section>
    </>
  )
}
