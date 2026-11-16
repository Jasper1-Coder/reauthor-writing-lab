import type { PatternHit } from './types'

interface PatternRule {
  regex: RegExp
  label: string
  suggestion: string
}

export const FORMULAIC_RULES: Record<'zh' | 'en', PatternRule[]> = {
  zh: [
    { regex: /在当今社会|在现代社会|在信息时代/g, label: '时代背景套话', suggestion: '删去宏大时代背景，直接从本文研究的具体情境或争议进入。' },
    { regex: /随着[^。！？]{0,24}的(?:不断)?发展|随着科技的不断进步/g, label: '泛化发展句式', suggestion: '说明究竟是哪项变化、发生在何时，以及它与论点的具体关系。' },
    { regex: /值得注意的是/g, label: '提示性套话', suggestion: '直接写出值得注意的事实，让读者从证据中看见重要性。' },
    { regex: /综上所述|总而言之|总的来说/g, label: '模板化总结', suggestion: '总结时回答“论证最终改变了我们对什么的理解”，避免复述前文。' },
    { regex: /首先|其次|再次/g, label: '序列连接词', suggestion: '把序号式衔接改成论点之间的因果、转折或递进关系。' },
    { regex: /不仅[^。！？]{0,40}而且/g, label: '双边赞颂句式', suggestion: '保留最重要的一个判断，并用证据说明它为何成立。' },
    { regex: /本文将|本文旨在/g, label: '元话语开场', suggestion: '若篇幅较短，可直接提出研究问题与中心论点。' },
    { regex: /一方面|另一方面/g, label: '平衡模板', suggestion: '明确两方面谁更重要、在什么条件下成立，而非机械罗列。' },
    { regex: /不可否认/g, label: '泛化让步', suggestion: '指出具体反对意见及其适用范围，再给出你的回应。' },
    { regex: /积极拥抱|创造更加美好的未来|创新与发展/g, label: '口号式收束', suggestion: '把口号换成可执行建议或仍需验证的研究问题。' },
  ],
  en: [
    { regex: /in today's (?:fast-paced |digital )?(?:world|society|age)/gi, label: 'Broad era opener', suggestion: 'Start with the specific context, controversy, or research gap instead of a broad era claim.' },
    { regex: /it is (?:important|worth) noting(?: that)?/gi, label: 'Formulaic signpost', suggestion: 'State the noteworthy fact directly and let the evidence carry its importance.' },
    { regex: /in conclusion|in summary|to sum up/gi, label: 'Template conclusion', suggestion: 'Use the conclusion to explain what the argument changes or what remains unresolved.' },
    { regex: /firstly|secondly|thirdly|furthermore|moreover|additionally/gi, label: 'Sequential connector', suggestion: 'Replace list-like transitions with a causal, concessive, or comparative relationship.' },
    { regex: /not only[^.!?]{0,70}but also/gi, label: 'Balanced praise pattern', suggestion: 'Prioritise the main claim and support it with a concrete detail.' },
    { regex: /this essay will|this paper aims to/gi, label: 'Metadiscourse opener', suggestion: 'For a short assignment, move directly to the research question and argument.' },
    { regex: /on (?:the )?one hand|on (?:the )?other hand/gi, label: 'Mechanical balance', suggestion: 'Explain which side is stronger and under what conditions.' },
    { regex: /it is undeniable/gi, label: 'Generic concession', suggestion: 'Name the actual counterargument and respond to its strongest version.' },
    { regex: /delve into|in the realm of|the landscape of/gi, label: 'Stock AI phrasing', suggestion: 'Use a precise verb that describes your actual analytical action.' },
    { regex: /embrace|a brighter future|ever-evolving/gi, label: 'Slogan-like ending', suggestion: 'End with a concrete implication, limitation, or researchable question.' },
  ],
}

export const GENERIC_RULES: Record<'zh' | 'en', PatternRule[]> = {
  zh: [
    { regex: /重要的(?:研究)?意义|重要作用|深远的影响|积极作用/g, label: '空泛价值判断', suggestion: '把“重要”具体化：影响了谁、改变了什么、程度如何？' },
    { regex: /各种|许多|不同特点|不同需求|丰富的资源|更好的/g, label: '模糊量词或评价', suggestion: '用可观察的对象、数量、案例或评价标准替代模糊词。' },
    { regex: /合理有效的措施|充分发挥|优化|赋能/g, label: '抽象措施', suggestion: '写出措施的执行者、步骤、成本与验证方式。' },
    { regex: /新的机遇和挑战|一定的(?:影响|作用)/g, label: '双面泛论', suggestion: '只保留与中心论点直接相关的机遇或风险，并展开证据。' },
  ],
  en: [
    { regex: /plays? an? (?:crucial|vital|significant|important) role|significant impact|profound impact/gi, label: 'Vague value claim', suggestion: 'Specify who is affected, what changes, and how that change could be observed.' },
    { regex: /various|many|numerous|a wide range of|rich resources|better/gi, label: 'Vague quantifier', suggestion: 'Replace the vague term with a verifiable quantity, example, or criterion.' },
    { regex: /effective measures|reasonable steps|leverage|empower|optimise|optimize/gi, label: 'Abstract recommendation', suggestion: 'Name the actor, action, trade-off, and method of evaluation.' },
    { regex: /opportunities and challenges|benefits and drawbacks/gi, label: 'Generic two-sided claim', suggestion: 'Develop only the benefit or risk that directly advances your argument.' },
  ],
}

export function findPatternHits(text: string, language: 'zh' | 'en', type: 'formulaic' | 'generic'): PatternHit[] {
  const rules = type === 'formulaic' ? FORMULAIC_RULES[language] : GENERIC_RULES[language]
  return rules.flatMap((rule) => {
    rule.regex.lastIndex = 0
    return Array.from(text.matchAll(rule.regex)).map((match) => ({
      phrase: match[0],
      label: rule.label,
      suggestion: rule.suggestion,
    }))
  })
}
