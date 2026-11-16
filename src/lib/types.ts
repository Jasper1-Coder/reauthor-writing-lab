export type Language = 'zh' | 'en' | 'mixed'
export type LanguagePreference = 'auto' | 'zh' | 'en'
export type DocumentType = 'coursework' | 'academic' | 'essay' | 'general'
export type RiskLevel = 'low' | 'moderate' | 'elevated' | 'high' | 'insufficient'
export type SentenceLevel = 'low' | 'review' | 'priority'

export interface AnalysisOptions {
  language: LanguagePreference
  documentType: DocumentType
}

export interface PatternHit {
  phrase: string
  label: string
  suggestion: string
}

export interface SentenceAnalysis {
  id: number
  text: string
  score: number
  level: SentenceLevel
  reasons: string[]
  suggestions: string[]
  strengths: string[]
  patternHits: PatternHit[]
}

export interface Metric {
  id: 'rhythm' | 'formulaic' | 'repetition' | 'abstraction' | 'specificity'
  label: string
  englishLabel: string
  score: number
  weight: number
  description: string
  evidence: string
}

export interface TextStats {
  characters: number
  chineseCharacters: number
  englishWords: number
  sentences: number
  paragraphs: number
}

export interface AnalysisReport {
  version: string
  createdAt: string
  language: Language
  documentType: DocumentType
  originalText: string
  stats: TextStats
  score: number
  level: RiskLevel
  levelLabel: string
  evidenceSufficiency: number
  evidenceLabel: string
  isSampleSufficient: boolean
  metrics: Metric[]
  sentenceAnalyses: SentenceAnalysis[]
  limitations: string[]
}
