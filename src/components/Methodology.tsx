import { ArrowUpRight, BookMarked, Github, Scale, ShieldAlert } from 'lucide-react'

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
            <p>Turnitin、ZeroGPT、Pangram 给了交互参照，但我们不复制它们的“判决式叙事”。ReAuthor 当前版本采用公开文体规则，研究实现用于设计参照与未来校准，不在浏览器里冒充运行大模型。</p>
            <a className="text-link" href="https://github.com/Jasper1-Coder/reauthor-writing-lab" target="_blank" rel="noreferrer">查看完整源码与评分常量 <ArrowUpRight size={16} /></a>
          </div>
          <div className="method-principles">
            <article><Scale size={23} /><span>01</span><h3>证据先于结论</h3><p>总分之外，同时展示指标原始值、权重、命中句子和建议。你可以不同意，也可以复核。</p></article>
            <article><ShieldAlert size={23} /><span>02</span><h3>不确定就弃权</h3><p>中文不足 400 字、英文不足 180 词或少于 6 句时，不给风险定性，只展示有限的规则观察。</p></article>
            <article><BookMarked size={23} /><span>03</span><h3>修改而非规避</h3><p>建议指向论证、证据与风格，不提供“骗过检测器”的降率承诺，也不鼓励一键洗稿。</p></article>
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
