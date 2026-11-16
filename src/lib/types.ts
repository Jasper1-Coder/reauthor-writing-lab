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

export type CrossVerdict = 'aligned' | 'mixed' | 'divergent'
export type DetectorId = 'lexicon' | 'rhythm' | 'repetition' | 'specificity' | 'probability'

export interface DetectorResult {
  id: DetectorId
  name: string
  englishName: string
  family: string
  score: number
  detail: string
}

export interface CrossValidation {
  detectors: DetectorResult[]
  spread: number
  median: number
  verdict: CrossVerdict
  verdictLabel: string
  note: string
}

export type ProbabilityStatus = 'idle' | 'loading' | 'running' | 'done' | 'error'

export interface ProbabilityChannelResult {
  status: ProbabilityStatus
  message: string
  modelName?: string
  tokens?: number
  perplexity?: number
  burstiness?: number
  score?: number
  formula?: string
  error?: string
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
  sufficiencyHint: string
  metrics: Metric[]
  crossValidation: CrossValidation
  sentenceAnalyses: SentenceAnalysis[]
  limitations: string[]
}
