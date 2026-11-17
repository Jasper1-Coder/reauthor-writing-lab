/**
 * 红队探针：手写的「当代中文学生文风」段落，在这个模型下会被判多少分？
 *
 * 为什么要有这个脚本：域内 AUC 0.943 说明的只是「HC3 的 ChatGPT 答案 vs 真人答案」可分，
 * 它完全没回答学生真正关心的问题——**我自己写的、带具体细节、有点口语的课程作业，会不会被误判**。
 * 这里放 6 段人工撰写的学生声音文本（会展专业实习、课程论文、社团复盘），
 * 以及 4 段典型的「AI 腔」文本作对照，直接看分数。
 *
 * 注意局限：样本由本项目的 AI 助手撰写，n=10，只能当方向性探针，不能当统计结论。
 *
 * 用法：npx tsx scripts/probe-student-style.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { DEQUANT, LM_MASK, LM_W1, LM_W2, bigramBucket, normalizeLm } from '../src/lib/lmText'

const ROOT = process.cwd()
const BIN = path.join(ROOT, 'public', 'lm-char2.bin')
const META = path.join(ROOT, 'src', 'data', 'lmModel.json')

interface Parsed { index: Map<number, number>; unigram: Float32Array; table: Uint8Array; total: number }

const buf = fs.readFileSync(BIN)
const meta = JSON.parse(fs.readFileSync(META, 'utf-8'))
function parse(offset: number, vocab: number, total: number): { m: Parsed; next: number } {
  const index = new Map<number, number>()
  const unigram = new Float32Array(vocab)
  const codes = new Array<number>(vocab)
  let p = offset
  for (let i = 0; i < vocab; i++) { codes[i] = buf.readUInt32LE(p); p += 4 }
  for (let i = 0; i < vocab; i++) { unigram[i] = buf.readUInt32LE(p); p += 4 }
  const size = 1 << buf.readUInt8(7)
  const table = new Uint8Array(buf.subarray(p, p + size))
  p += size
  codes.forEach((c, i) => index.set(c, i))
  return { m: { index, unigram, table, total }, next: p }
}
const h = parse(24, buf.readUInt32LE(8), meta.models[0].chars)
const a = parse(h.next, buf.readUInt32LE(12), meta.models[1].chars)

function meanLogp(m: Parsed, text: string): number {
  const t = normalizeLm(text)
  if (t.length < 3) return -20
  let sum = 0, n = 0
  let prev = m.index.get(t.codePointAt(0) ?? 0) ?? -1
  for (let i = 1; i < t.length; i++) {
    const idx = m.index.get(t.codePointAt(i) ?? 0) ?? -1
    const u = idx >= 0 ? m.unigram[idx] : 0
    const p1 = u > 0 ? u / m.total : 1e-9
    let p2 = 0
    if (prev >= 0) {
      const cnt = DEQUANT[m.table[bigramBucket(t[i - 1], t[i], LM_MASK)]]
      if (cnt >= 1 && m.unigram[prev] > 0) p2 = cnt / m.unigram[prev]
    }
    sum += Math.log2(Math.max(LM_W2 * p2 + LM_W1 * p1, 1e-9))
    n++
    prev = idx
  }
  return sum / n
}

const cal = meta.calibration
const score = (d: number) => Math.round(100 / (1 + Math.exp(-(cal.a * ((d - cal.mean) / cal.std) + cal.b))))

const student: Array<[string, string]> = [
  ['实习复盘（口语、有具体细节）', '这次在展馆待了四天，最深的感受是"动线"这个词说起来简单，做起来全是钱。我们原定的观众入口在 B 馆东侧，第一天九点开场，人流直接堵在安检口，队尾排到了室外停车场。后来临时把两个 VIP 通道改成普通通道，下午才勉强顺过来。回来复盘的时候我算了一下，光是这一个改动，等于把原本给赞助商的曝光位让出去了。老师说这叫"用资源换流量"，我觉得更准确的说法是：预算不够的时候，动线就是你的预算。'],
  ['课程论文片段（学生措辞）', '本文以 2023 年广交会秋季展为案例，尝试讨论线上展会对线下展会客流的分流效应。之所以选这一届，是因为它的线上平台在展后仍保留了三个月的买家询盘入口，这在往届是没有的。数据方面，我拿到了主办方公开的观众登记人数和新浪微博的话题阅读量，但后者只能反映关注度，不能反映实际到场，所以本文只把它当辅助材料用。'],
  ['社团活动复盘（带情绪）', '说实话这次活动办得挺狼狈的。场地是提前两周才批下来的，物料到货那天已经是前一天晚上十点，我们六个人在活动室贴了三个小时的海报。第二天到场人数比报名少了将近一半，签到表上一百二十个名字，真正坐下来听的有六十多个。但散场之后有七八个学弟留下来问我们下次什么时候办，那一刻我觉得值了。'],
  ['英文人写（非母语学生的真实水平）', 'I think the biggest problem of our booth design is that we put the LED screen too high. When people walk by, they need to look up, and most of them just keep walking. On the third day we moved it down about forty centimeters and put two chairs in front of it, and people started to stop. It was a small change but it worked better than the brochure we printed for two thousand yuan.'],
  ['实验报告式的平实叙述', '我们随机抽取了 60 名到场观众做问卷，回收有效问卷 52 份。其中 31 人表示是通过朋友推荐知道这个展会的，14 人来自公众号推送，剩下 7 人是在地铁站看到广告。这个结果和我们预想的差不多，但样本量太小，只能说明趋势，不能下结论。'],
  ['刻意写得规整的好学生（最危险的情况）', '从展陈设计的角度看，本次展台的问题主要集中在信息层级上。首先，主视觉与产品参数被放在了同一视觉平面上，观众需要花时间分辨哪个是重点；其次，洽谈区与展示区之间缺乏物理分隔，导致两边的声响互相干扰；最后，灯光只做了整体照明，没有针对展品做重点照明，使得核心产品的质感没有体现出来。这三点在展后复盘中都被同事提及，说明并非个人主观判断。'],
]

const aiStyle: Array<[string, string]> = [
  ['典型 AI 腔（排比+总结）', '综上所述，展会动线设计是影响观众体验的关键因素。一方面，合理的动线能够有效引导人流，提升参展效率；另一方面，科学的动线规划也有助于优化资源配置，增强品牌曝光。因此，主办方应当重视动线设计，结合实际情况不断优化，从而实现展会价值的最大化。'],
  ['典型 AI 腔（分点+套话）', '首先，需要明确目标受众。其次，制定详细的执行方案。再次，建立有效的反馈机制。最后，持续优化与迭代。通过以上四个步骤，可以系统性地提升活动效果，为参与者创造更好的体验。'],
  ['典型 AI 腔（平衡句式）', '值得注意的是，线上展会虽然在一定程度上拓展了展会的边界，但同时也带来了注意力分散的问题。如何在数字化与体验感之间取得平衡，是行业未来需要共同面对的课题。'],
  ['典型 AI 腔（礼貌收尾）', '总而言之，这次实习让我对会展行业有了更深入的理解，也让我认识到理论知识与实践操作之间仍存在差距。在未来的学习与工作中，我将继续努力，不断提升自己的专业能力。'],
]

console.log(`模型：${(buf.length / 1e6).toFixed(2)}MB，域内留出集 AUC ${meta.models ? '' : ''}见 lmValidation.json`)
console.log(`判读口径：≥50 在本模型里算「更接近训练语料中的 AI 文风」。\n`)

function report(title: string, rows: Array<[string, string]>) {
  console.log(`=== ${title} ===`)
  for (const [name, text] of rows) {
    const d = meanLogp(a.m, text) - meanLogp(h.m, text)
    const s = score(d)
    const flag = s >= 50 ? '⚠️ 被判高' : '✅ 未判高'
    console.log(`  ${String(s).padStart(3)} 分  ${flag}  ${name}（${normalizeLm(text).length} 字）`)
  }
  console.log('')
}

report('手写「当代学生文风」', student)
report('典型 AI 腔对照', aiStyle)

const studentScores = student.map(([, t]) => score(meanLogp(a.m, t) - meanLogp(h.m, t)))
const aiScores = aiStyle.map(([, t]) => score(meanLogp(a.m, t) - meanLogp(h.m, t)))
const high = studentScores.filter((s) => s >= 50).length
const mean = (arr: number[]) => (arr.reduce((x, y) => x + y, 0) / arr.length).toFixed(1)
console.log(`学生样本：${high}/${studentScores.length} 段被判 ≥50，均分 ${mean(studentScores)}`)
console.log(`AI 样本：均分 ${mean(aiScores)}`)
console.log(`\n⚠️ 这只说明本模型对「我手写的学生文本」的反应，n=${studentScores.length}，不是统计结论。`)
