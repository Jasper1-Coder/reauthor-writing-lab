/** 红队 vs 校准模型：改写攻击下逻辑回归通道是否也被打穿 */
import { scoreCalibrated } from '../src/lib/calibrated'
import { SAMPLE_EN_TEMPLATE, SAMPLE_HUMAN_REPORT_ZH, SAMPLE_ZH } from '../src/data/samples'
import { rewrite } from './redteam'

const cases: Array<[string, string, 'zh' | 'en']> = [
  ['中文模板（AI特征应高）', SAMPLE_ZH, 'zh'],
  ['英文模板（AI特征应高）', SAMPLE_EN_TEMPLATE, 'en'],
  ['中文调查报告（人写对照）', SAMPLE_HUMAN_REPORT_ZH, 'zh'],
]
for (const [name, text, lang] of cases) {
  const before = scoreCalibrated(text)
  const after = scoreCalibrated(rewrite(text, lang))
  console.log(`${name}: ${before.score} → ${after.score} (Δ${after.score - before.score})`)
}
