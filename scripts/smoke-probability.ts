/** 神经通道端到端冒烟测试（Node 环境）：npx tsx scripts/smoke-probability.ts */
import { runProbabilityChannel } from '../src/lib/probability'

const text = `短视频平台的推荐算法正在重塑青少年注意力结构。本研究选取某中学三个年级共 214 名学生进行为期八周的追踪调查，结果显示每日使用超过 90 分钟的学生在持续性注意力测试中平均低 11.3 分。值得注意的是，这一效应在家庭监管较弱的群体中更明显。然而，样本仅来自单一城市，结论的推广性受限；后续研究需要引入跨地区对照，并区分算法内容类型的影响。`

console.log('starting probability channel smoke test…')
const result = await runProbabilityChannel(text, (update) => {
  console.log(`[progress] ${update.status}: ${update.message}`)
})
console.log('RESULT:', JSON.stringify(result, null, 2))
if (result.status !== 'done') process.exit(1)
