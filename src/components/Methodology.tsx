import { ArrowUpRight, BookMarked, FlaskConical, Github, Scale, ShieldAlert } from 'lucide-react'
import calibrationData from '../data/calibration.json'

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
        <div className="section-index">
          <span>03</span>
          <p>打开引擎盖，拒绝神秘百分比</p>
        </div>
        <div className="method-grid">
          <div className="method-lead">
            <p className="eyebrow">OPEN METHODOLOGY</p>
            <h2 id="method-title">严谨，不是把话说满。<br /><em>是把边界说清。</em></h2>
            <p>Turnitin、ZeroGPT、Pangram 给了交互参照，但我们不复制它们的“判决式叙事”。v0.2 做了三件它们不做的事：多条独立证据链交叉验证并公布分歧；用 HC3 中文公开数据集校准并如实公布误判率；提供可复核的浏览器本地神经通道（实验）。研究实现用于设计参照，不在浏览器里冒充运行 7B 大模型。</p>
            <a className="text-link" href="https://github.com/Jasper1-Coder/reauthor-writing-lab" target="_blank" rel="noreferrer">查看完整源码与评分常量 <ArrowUpRight size={16} /></a>
          </div>
          <div className="method-principles">
            <article><Scale size={23} /><span>01</span><h3>证据先于结论</h3><p>总分之外，同时展示指标原始值、权重、命中句子和建议。你可以不同意，也可以复核。</p></article>
            <article><ShieldAlert size={23} /><span>02</span><h3>不确定就弃权</h3><p>中文不足 400 字、英文不足 180 词或少于 6 句时，不给风险定性，只展示有限的规则观察。</p></article>
            <article><BookMarked size={23} /><span>03</span><h3>修改而非规避</h3><p>建议指向论证、证据与风格，不提供“骗过检测器”的降率承诺，也不鼓励一键洗稿。</p></article>
          </div>
        </div>

        <div className="calibration-section" id="calibration">
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
