import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  Check,
  FileLock2,
  FileText,
  Languages,
  LoaderCircle,
  ScanText,
  Upload,
  Trash2,
} from 'lucide-react'
import { SAMPLE_LIBRARY } from '../data/samples'
import { analyzeText, splitSentences } from '../lib/analyzer'
import { extractTextFromFile, isSupportedFile } from '../lib/fileImport'
import type { AnalysisReport, DocumentType, LanguagePreference } from '../lib/types'

interface AnalyzerProps {
  onAnalyzed: (report: AnalysisReport) => void
  onToast: (message: string) => void
  /** 由改写工作台回填的"改后全文"；nonce 变化即视为一次新的回填 */
  incomingText?: { text: string; nonce: number }
}

const stages = ['识别语言与切分句子', '计算五项文体特征', '定位证据与生成建议', '整理可导出诊断报告']

export function Analyzer({ onAnalyzed, onToast, incomingText }: AnalyzerProps) {
  const [text, setText] = useState('')
  const [language, setLanguage] = useState<LanguagePreference>('auto')
  const [documentType, setDocumentType] = useState<DocumentType>('academic')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [stage, setStage] = useState(0)
  const [sampleName, setSampleName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const stats = useMemo(() => ({
    characters: text.length,
    sentences: splitSentences(text).length,
  }), [text])

  useEffect(() => {
    if (!incomingText?.text) return
    setText(incomingText.text)
    setSampleName('改后全文（来自改写工作台）')
    onToast('改后全文已填入，可重新分析对比修订效果')
  // 仅当 nonce 变化时响应，避免其他 state 更新导致重复回填
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingText?.nonce])

  const loadSample = (id: string) => {
    const sample = SAMPLE_LIBRARY.find((doc) => doc.id === id)
    if (!sample) return
    setText(sample.text)
    setLanguage(sample.language)
    setSampleName(sample.name)
    onToast(`已载入${sample.name}，可直接开始分析`)
  }

  const handleFile = async (file: File | undefined | null) => {
    if (!file || isImporting) return
    if (file.size > 30 * 1024 * 1024) {
      onToast('文件超过 30MB，请先精简后再上传')
      return
    }
    if (!isSupportedFile(file)) {
      onToast('暂只支持 .txt / .md / .pdf / .docx / .pptx，.doc 请先另存为 .docx')
      return
    }
    setIsImporting(true)
    try {
      const result = await extractTextFromFile(file)
      if (!result.text || result.text.length < 40) {
        onToast('没有从文件中提取到足够文字：扫描版 PDF 或图片型文档请手动复制粘贴')
        return
      }
      setText(result.text.slice(0, 50000))
      setSampleName(result.name)
      if (result.warning) onToast(result.warning)
      else onToast(`已提取「${result.name}」的文字（${result.text.length.toLocaleString()} 字符），全程本地解析`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      onToast(`文件解析失败：${detail}`)
    } finally {
      setIsImporting(false)
    }
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
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.markdown,.pdf,.docx,.pptx"
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(event) => {
                void handleFile(event.target.files?.[0])
                event.target.value = ''
              }}
            />
            <button
              className="icon-button"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              aria-label="导入文档文件"
              title="导入 PDF / Word / PPT / TXT（本地解析）"
            >
              {isImporting ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}
            </button>
            <button className="icon-button" type="button" onClick={clearText} disabled={!text} aria-label="清空原稿" title="清空原稿">
              <Trash2 size={17} />
            </button>
          </div>
        </div>

        <div
          className={`textarea-wrap ${isDragging ? 'dragging' : ''}`}
          onDragOver={(event) => { event.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setIsDragging(false)
            void handleFile(event.dataTransfer.files?.[0])
          }}
        >
          <textarea
            value={text}
            onChange={(event) => { setText(event.target.value); setSampleName('') }}
            placeholder="在这里粘贴你的中文或英文原稿，或把 PDF / Word / PPT 文件直接拖进来……&#10;&#10;判定充分性只需满足其一：中文 ≥400 字，或英文 ≥180 词，另需 ≥6 个完整句子。中英混排的论文按各自语言分别计算。"
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
          {isDragging && (
            <div className="drop-overlay" aria-hidden="true"><Upload size={28} /><p>松开手，文件在本地解析</p></div>
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
        <span>没有原稿在手边？六份对照样本覆盖不同语言与风格：</span>
        <div>
          {SAMPLE_LIBRARY.map((sample) => (
            <button key={sample.id} type="button" onClick={() => loadSample(sample.id)}>
              {sample.id.startsWith('zh') ? <BookOpen size={14} /> : <Languages size={14} />} {sample.shortName}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
