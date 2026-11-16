/**
 * 红队对抗测试：模拟市面上"降AI指令"（如 B 站流传的毕业论文降AI率教程）的
 * 改写战术，实测本站规则引擎的分数会被打掉多少。
 *
 * 模拟的战术（公开教程的常见组合）：
 *   T1 套话替换 —— 把模板短语换成朴素表达
 *   T2 枚举拆除 —— 删掉 首先/其次/Finally/Furthermore 类序列连接词
 *   T3 节奏扰动 —— 拆长句、并短句，破坏句长均匀性
 *
 * 刻意不做：真实降AI prompt 还会"编造具体细节"（虚构数据/案例）。
 * 本脚本不伪造事实，因此测出的是我们引擎对**纯句式层改写**的敏感度——
 * 即便如此，如果分数大幅下跌，就足以证明单一表层百分比不可信。
 *
 * 运行：npx tsx scripts/redteam.ts
 * 输出：src/data/redteam.json（由 Methodology 页面展示）
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { analyzeText } from '../src/lib/analyzer'
import { SAMPLE_EN_TEMPLATE, SAMPLE_HUMAN_ZH, SAMPLE_ZH } from '../src/data/samples'
import type { AnalysisOptions, LanguagePreference } from '../src/lib/types'

// ---------- T1 + T2：套话替换与枚举拆除 ----------
const ZH_SWAPS: Array<[RegExp, string]> = [
  [/在当今社会[，,]?\s*|在现代社会[，,]?\s*|在信息时代[，,]?\s*/g, ''],
  [/值得注意的是[，,]?\s*/g, ''],
  [/综上所述[，,]?\s*/g, '把这些放在一起看，'],
  [/总而言之[，,]?\s*|总的来说[，,]?\s*/g, '回头看，'],
  [/首先[，,]?\s*|其次[，,]?\s*|再次[，,]?\s*|最后[，,]?\s*/g, ''],
  [/一方面[，,]?\s*|另一方面[，,]?\s*/g, ''],
  [/不可否认[，,]?\s*/g, ''],
  [/不仅([^。！？]{0,40})而且/g, '$1，同时'],
  [/深远的影响/g, '拖得很长的改变'],
  [/积极的?作用|重要的作用/g, '帮助'],
  [/创造了更加美好的未来|创造更加美好的未来/g, '把下一件事做成了'],
  [/随着([^。！？]{0,24})的不断?发展/g, '$1变了，'],
  [/推动了(?:[^，。！？]{0,12})的(?:快速|迅速)?发展/g, '改变了它'],
  [/提供了丰富的资源/g, '能查到的东西变多了'],
  [/满足(?:了)?不同特点的需求|满足不同需求/g, '照顾到各自的用法'],
  [/合理有效的措施/g, '具体怎么做'],
  [/充分发挥/g, '用足'],
  [/新的机遇和挑战/g, '新的麻烦和机会'],
]

const EN_SWAPS: Array<[RegExp, string]> = [
  [/In today's (?:fast-paced |digital |rapidly evolving )?(?:world|society|age|landscape),?\s*/gi, ''],
  [/It is (?:important|worth) noting that\s*/gi, ''],
  [/In conclusion,?\s*|In summary,?\s*|To sum up,?\s*/gi, 'Stepping back, '],
  [/Firstly,?\s*|Secondly,?\s*|Thirdly,?\s*/gi, ''],
  [/Furthermore,?\s*|Moreover,?\s*|Additionally,?\s*/gi, ''],
  [/On the one hand,?\s*/gi, ''], [/on the other hand,?\s*/gi, 'still, '],
  [/It is undeniable that\s*/gi, ''],
  [/not only ([^.!?]{0,70}?) but also/gi, '$1 and'],
  [/plays? a (?:crucial|vital|significant|important) role in (?:transforming|shaping|reshaping)/gi, 'changes'],
  [/has a profound impact on/gi, 'reshapes'],
  [/delve into/gi, 'examine'],
  [/in the realm of/gi, 'in'],
  [/the (?:ever-)?evolving landscape of/gi, 'how'],
  [/unlock a brighter future/gi, 'make the next step work'],
  [/embrace[sd]?/gi, 'use'],
  [/leverage effective measures/gi, 'pick specific steps'],
  [/empowers?/gi, 'helps'],
  [/offers? significant opportunities and challenges/gi, 'helps in some ways and breaks in others'],
  [/promotes? educational equity/gi, 'narrows some gaps'],
  [/enhances? learning efficiency/gi, 'cuts some busywork'],
  [/caters? to the diverse needs of/gi, 'fits different'],
  [/provide[sd]? rich resources/gi, 'supply more material'],
]

function swapPhrases(text: string, language: 'zh' | 'en'): string {
  const swaps = language === 'zh' ? ZH_SWAPS : EN_SWAPS
  let out = text
  for (const [pattern, replacement] of swaps) {
    pattern.lastIndex = 0
    out = out.replace(pattern, replacement)
  }
  return out
}

// ---------- T3：节奏扰动 —— 拆长句，制造句长差异 ----------
function perturbRhythm(text: string, language: 'zh' | 'en'): string {
  if (language === 'zh') {
    // 中文长句里的中间逗号改句号，把均匀长句拆成参差短句
    return text.replace(/([^。！？\n]{26,}?)，([^，。！？]{8,})/g, (_m, head: string, tail: string) => {
      return head.includes('，')
        ? `${head}，${tail}`
        : `${head}。${tail}`
    })
  }
  // 英文：分号与部分从句逗号改成句号
  return text
    .replace(/;\s+/g, '. ')
    .replace(/, (?:which|that|allowing|creating|leaving) /g, '. This ')
}

export function rewrite(text: string, language: 'zh' | 'en'): string {
  return perturbRhythm(swapPhrases(text, language), language)
}

// ---------- 评测 ----------
interface CaseResult {
  id: string
  name: string
  isControl: boolean
  language: 'zh' | 'en'
  before: { score: number; level: string }
  after: { score: number; level: string }
  delta: number
}

function evaluate(id: string, name: string, text: string, language: LanguagePreference, isControl: boolean): CaseResult {
  const options: AnalysisOptions = { language, documentType: 'academic' }
  const before = analyzeText(text, options)
  const rewritten = rewrite(text, language === 'auto' ? 'zh' : language)
  const after = analyzeText(rewritten, options)
  return {
    id,
    name,
    isControl,
    language: language === 'en' ? 'en' : 'zh',
    before: { score: before.score, level: before.levelLabel },
    after: { score: after.score, level: after.levelLabel },
    delta: after.score - before.score,
  }
}

const cases: CaseResult[] = [
  evaluate('zh-template', '中文 · 模板化示例', SAMPLE_ZH, 'zh', false),
  evaluate('en-template', 'English · Template-heavy sample', SAMPLE_EN_TEMPLATE, 'en', false),
  evaluate('zh-human-control', '中文 · 调查报告（对照组）', SAMPLE_HUMAN_ZH, 'zh', true),
]

const result = {
  meta: {
    generatedAt: new Date().toISOString().slice(0, 10),
    method: '确定性规则改写（可复现，无随机性、无模型参与）',
    tactics: [
      'T1 套话替换：模板短语换成朴素表达',
      'T2 枚举拆除：删去序列连接词与平衡句式',
      'T3 节奏扰动：拆长句以破坏句长均匀性',
    ],
    disclosure: '真实"降AI指令"还会编造具体细节（虚构数据/案例）来骗过证据稀缺维度；本测试刻意不伪造事实，测得的是纯句式层改写的影响。',
    reference: '战术来源：B站公开流传的"毕业论文降AI率"教程类内容（BV1mALH6yEE2，28.5万播放），此处仅取其公开描述的改写思路作为分析对象。',
  },
  cases,
}

const outPath = resolve(import.meta.dirname ?? '.', '../src/data/redteam.json')
writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8')

console.log('RED-TEAM RESULTS')
for (const c of cases) {
  console.log(
    `${c.isControl ? '[对照]' : '[目标]'} ${c.name}: ${c.before.score} (${c.before.level}) → ${c.after.score} (${c.after.level}) | Δ ${c.delta >= 0 ? '+' : ''}${c.delta}`,
  )
}
console.log(`\nwritten to ${outPath}`)
