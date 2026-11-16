import { useMemo, useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  Check,
  FileLock2,
  FileText,
  Languages,
  LoaderCircle,
  ScanText,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { SAMPLE_EN, SAMPLE_HUMAN_ZH, SAMPLE_ZH } from '../data/samples'
import { analyzeText, splitSentences } from '../lib/analyzer'
import type { AnalysisReport, DocumentType, LanguagePreference } from '../lib/types'

interface AnalyzerProps {
  onAnalyzed: (report: AnalysisReport) => void
  onToast: (message: string) => void
}

const stages = ['识别语言与切分句子', '计算五项文体特征', '定位证据与生成建议', '整理可导出诊断报告']

export function Analyzer({ onAnalyzed, onToast }: AnalyzerProps) {
  const [text, setText] = useState('')
  const [language, setLanguage] = useState<LanguagePreference>('auto')
  const [documentType, setDocumentType] = useState<DocumentType>('academic')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [stage, setStage] = useState(0)
  const [sampleName, setSampleName] = useState('')

  const stats = useMemo(() => ({
    characters: text.length,
    sentences: splitSentences(text).length,
  }), [text])

  const loadSample = (kind: 'zh' | 'human' | 'en') => {
    const samples = {
      zh: { text: SAMPLE_ZH, name: '中文 · 模板化示例', language: 'zh' as LanguagePreference },
      human: { text: SAMPLE_HUMAN_ZH, name: '中文 · 个人论证示例', language: 'zh' as LanguagePreference },
      en: { text: SAMPLE_EN, name: 'English · Evidence-rich draft', language: 'en' as LanguagePreference },
    }
    setText(samples[kind].text)
    setLanguage(samples[kind].language)
    setSampleName(samples[kind].name)
    onToast(`已载入${samples[kind].name}，可直接开始分析`)
  }

  const runAnalysis = async () => {
    if (text.trim().length < 40 || isAnalyzing) return
    setIsAnalyzing(true)
    setStage(0)
    for (let index = 0; index < stages.length; index += 1) {
      setStage(index)
      await new Promise((resolve) => window.setTimeout(resolve, index === 0 ? 260 : 190))
    }
    const report = analyzeText(text, { language, documentType })
    onAnalyzed(report)
    setIsAnalyzing(false)
    onToast('分析完成：每个分数都已附上证据与修改方向')
  }

  const clearText = () => {
    setText('')
    setSampleName('')
  }

  return (
    <section className="analyzer-shell" id="analyzer" aria-labelledby="analyzer-title">
      <div className="section-index">
        <span>01</span>
        <p>把原稿放上工作台面</p>
      </div>
      <div className="analyzer-heading">
        <div>
          <p className="eyebrow">YOUR DRAFT, YOUR EVIDENCE</p>
          <h2 id="analyzer-title">先读文本，再谈分数。</h2>
        </div>
        <p>支持中文与英文课程作业、论文和学术文本。分析在浏览器中完成，原稿不会被上传或保存。</p>
      </div>

      <div className="editor-frame">
        <div className="editor-toolbar">
          <div className="document-title">
            <FileText size={18} aria-hidden="true" />
            <span>{sampleName || '未命名原稿'}</span>
            <span className="draft-badge">DRAFT</span>
          </div>
          <div className="editor-controls">
            <label>
              <span className="sr-only">文本类型</span>
              <select value={documentType} onChange={(event) => setDocumentType(event.target.value as DocumentType)}>
                <option value="academic">学术论文</option>
                <option value="coursework">课程作业</option>
                <option value="essay">议论文 / 文书</option>
                <option value="general">通用文本</option>
              </select>
            </label>
            <label>
              <span className="sr-only">文本语言</span>
              <select value={language} onChange={(event) => setLanguage(event.target.value as LanguagePreference)}>
                <option value="auto">自动识别语言</option>
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <button className="icon-button" type="button" onClick={clearText} disabled={!text} aria-label="清空原稿" title="清空原稿">
              <Trash2 size={17} />
            </button>
          </div>
        </div>

        <div className="textarea-wrap">
          <textarea
            value={text}
            onChange={(event) => { setText(event.target.value); setSampleName('') }}
            placeholder="在这里粘贴你的中文或英文原稿……&#10;&#10;建议中文不少于 400 字、英文不少于 180 词，并包含至少 6 个完整句子。短文本仍可分析，但系统会拒绝给出风险定性。"
            maxLength={50000}
            aria-label="待分析原稿"
            spellCheck="false"
          />
          {!text && (
            <div className="editor-margin-note" aria-hidden="true">
              <span>LOCAL ONLY</span>
              <p>你的原稿<br />只属于你。</p>
            </div>
          )}
        </div>

        <div className="editor-footer">
          <div className="live-stats" aria-live="polite">
            <span><strong>{stats.characters.toLocaleString()}</strong> 字符</span>
            <span><strong>{stats.sentences}</strong> 句子</span>
            <span className="local-label"><FileLock2 size={14} /> 本地分析</span>
          </div>
          <button
            className="primary-button analyze-button"
            type="button"
            disabled={text.trim().length < 40 || isAnalyzing}
            onClick={runAnalysis}
          >
            {isAnalyzing ? <LoaderCircle className="spin" size={18} /> : <ScanText size={18} />}
            {isAnalyzing ? '正在读取证据' : '开始可解释分析'}
            {!isAnalyzing && <ArrowRight size={18} />}
          </button>
        </div>

        {text.trim().length > 0 && text.trim().length < 40 && (
          <p className="input-hint">至少输入 40 个字符；为了严谨，我们不分析一句话的“作者身份”。</p>
        )}

        {isAnalyzing && (
          <div className="analysis-progress" role="status" aria-live="polite">
            {stages.map((label, index) => (
              <div key={label} className={`progress-step ${index < stage ? 'done' : index === stage ? 'active' : ''}`}>
                {index < stage ? <Check size={15} /> : index === stage ? <LoaderCircle className="spin" size={15} /> : <span className="step-dot" />}
                <span>{label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="sample-row">
        <span>没有原稿在手边？用三份对照文本试试：</span>
        <div>
          <button type="button" onClick={() => loadSample('zh')}><Sparkles size={14} /> 中文 · 模板化</button>
          <button type="button" onClick={() => loadSample('human')}><BookOpen size={14} /> 中文 · 个人论证</button>
          <button type="button" onClick={() => loadSample('en')}><Languages size={14} /> English draft</button>
        </div>
      </div>
    </section>
  )
}
