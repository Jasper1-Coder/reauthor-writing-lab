/**
 * 文件导入：浏览器本地解析，文件内容不上传任何服务器。
 * 支持 .txt / .md（原生读取）、.pdf（pdfjs-dist）、.docx（mammoth）、.pptx（JSZip 解析幻灯 XML）。
 * 全部按需动态加载，失败给出明确原因，不影响主分析流程。
 */
export interface ImportResult {
  text: string
  name: string
  warning?: string
}

const ACCEPTED_EXTENSIONS = ['.txt', '.md', '.markdown', '.pdf', '.docx', '.pptx']

export function isSupportedFile(file: File): boolean {
  return ACCEPTED_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))
}

function cleanExtracted(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function extractTxt(file: File): Promise<string> {
  return cleanExtracted(await file.text())
}

async function extractPdf(file: File): Promise<{ text: string; warning?: string }> {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(workerUrl, document.baseURI).href

  const data = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data }).promise
  const pageLimit = Math.min(doc.numPages, 60)
  const parts: string[] = []
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await doc.getPage(pageNumber)
    const content = await page.getTextContent()
    let pageText = ''
    for (const item of content.items) {
      if ('str' in item) {
        pageText += item.str
        if (item.hasEOL) pageText += '\n'
      }
    }
    parts.push(pageText.trim())
  }
  const joined = parts.join('\n\n')
  const warning = doc.numPages > pageLimit
    ? `PDF 共 ${doc.numPages} 页，仅提取前 ${pageLimit} 页。`
    : joined.trim().length < 80
      ? '这份 PDF 几乎没有可提取的文字层（可能是扫描件），建议复制原文粘贴。'
      : undefined
  return { text: cleanExtracted(joined), warning }
}

async function extractDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth')
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer })
  return cleanExtracted(result.value)
}

async function extractPptx(file: File): Promise<{ text: string; warning?: string }> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const slideEntries = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => {
      const numberOf = (path: string) => Number(path.match(/slide(\d+)\.xml$/)?.[1] ?? 0)
      return numberOf(a) - numberOf(b)
    })
  if (!slideEntries.length) throw new Error('文件内没有找到幻灯片内容，请确认这是有效的 .pptx')

  const parser = new DOMParser()
  const slides: string[] = []
  for (const [index, path] of slideEntries.entries()) {
    const xml = await zip.files[path].async('string')
    const doc = parser.parseFromString(xml, 'application/xml')
    const paragraphs = [...doc.getElementsByTagName('a:p')]
      .map((paragraph) =>
        [...paragraph.getElementsByTagName('a:t')]
          .map((node) => node.textContent ?? '')
          .join('')
          .trim(),
      )
      .filter(Boolean)
    slides.push(`【第 ${index + 1} 页】\n${paragraphs.join('\n')}`)
  }
  const warning = slideEntries.length > 40 ? `共 ${slideEntries.length} 页幻灯片，已全部提取；文本较碎，建议人工校对段落边界。` : undefined
  return { text: cleanExtracted(slides.join('\n\n')), warning }
}

export async function extractTextFromFile(file: File): Promise<ImportResult> {
  if (!isSupportedFile(file)) {
    throw new Error('暂只支持 .txt / .md / .pdf / .docx / .pptx 五种格式')
  }
  const lower = file.name.toLowerCase()

  if (lower.endsWith('.pdf')) {
    const { text, warning } = await extractPdf(file)
    return { text, name: file.name, warning }
  }
  if (lower.endsWith('.docx')) {
    return { text: await extractDocx(file), name: file.name }
  }
  if (lower.endsWith('.pptx')) {
    const { text, warning } = await extractPptx(file)
    return { text, name: file.name, warning }
  }
  return { text: await extractTxt(file), name: file.name }
}
