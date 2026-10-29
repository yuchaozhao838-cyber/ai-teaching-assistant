/**
 * 浏览器端的材料解析：PDF（pdf.js）、Word（mammoth）、文本 / Markdown / HTML。
 * 与桌面端的解析结果尽量保持一致（同样的 Block 结构），这样提示词不用改。
 */
import type { Block, DocumentRecord } from '@tutor/shared'
import * as pdfjsLib from 'pdfjs-dist/build/pdf.js'
import mammoth from 'mammoth'
import { createDocument, looksLikeHeadingText, newId, normalizeText, textToBlocks } from './shim'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.js', document.baseURI).href

/* ------------------------------- PDF 文本层 ------------------------------- */

interface PdfItem {
  str: string
  transform: number[]
  width?: number
  height?: number
}

const SENTENCE_END = /[。．.！!？?；;：:”"』」）)]$/

function joinLine(parts: Array<{ x: number; str: string }>): string {
  let out = ''
  let lastEnd: number | null = null
  for (const part of parts) {
    if (lastEnd !== null && part.x - lastEnd > 1.5) out += ' '
    out += part.str
    lastEnd = part.x + part.str.length * 4
  }
  return out.replace(/\s+/g, ' ').trim()
}

async function pdfTextBlocks(buffer: ArrayBuffer): Promise<{ blocks: Block[]; warnings: string[]; pageCount: number }> {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise
  const blocks: Block[] = []
  const warnings: string[] = []
  const emptyPages: number[] = []
  const headingPages = new Map<string, Set<number>>()

  for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
    const page = await doc.getPage(pageNo)
    const content = await page.getTextContent()
    const items = (content.items as PdfItem[]).filter((item) => typeof item.str === 'string' && item.str.trim())
    if (!items.length) {
      emptyPages.push(pageNo)
      continue
    }

    interface Line {
      y: number
      size: number
      parts: Array<{ x: number; str: string }>
    }
    const lines: Line[] = []
    for (const item of items) {
      const tr = item.transform ?? [1, 0, 0, 1, 0, 0]
      const x = tr[4] ?? 0
      const y = tr[5] ?? 0
      const size = Math.abs(tr[3] ?? 0) || item.height || 10
      let line = lines.find((candidate) => Math.abs(candidate.y - y) < Math.max(1.5, size * 0.4))
      if (!line) {
        line = { y, size, parts: [] }
        lines.push(line)
      }
      line.parts.push({ x, str: item.str })
      line.size = Math.max(line.size, size)
    }

    lines.sort((a, b) => b.y - a.y)
    const sizes = lines.map((line) => line.size).sort((a, b) => a - b)
    const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 10

    let bufferText = ''
    let bufferIsHeading = false
    const flush = () => {
      const text = normalizeText(bufferText)
      if (text) {
        if (bufferIsHeading) blocks.push({ id: newId('b'), type: 'heading', text, level: 2 })
        else blocks.push({ id: newId('b'), type: 'paragraph', text })
      }
      bufferText = ''
      bufferIsHeading = false
    }

    for (const line of lines) {
      line.parts.sort((a, b) => a.x - b.x)
      const text = normalizeText(joinLine(line.parts))
      if (!text) continue
      if (line.size > median * 1.18 && looksLikeHeadingText(text)) {
        flush()
        blocks.push({ id: newId('b'), type: 'heading', text, level: 2 })
        if (!headingPages.has(text)) headingPages.set(text, new Set())
        headingPages.get(text)!.add(pageNo)
        continue
      }
      if (!bufferText) bufferText = text
      else if (SENTENCE_END.test(bufferText) && bufferText.length > 30) {
        flush()
        bufferText = text
      } else {
        bufferText += /[\u4e00-\u9fa5]$/.test(bufferText) ? text : ` ${text}`
      }
    }
    flush()
    page.cleanup?.()
  }

  // 每页重复出现的"标题"是页眉，丢掉
  if (doc.numPages >= 4) {
    const repeated = new Set([...headingPages.entries()].filter(([, pages]) => pages.size >= 3).map(([text]) => text))
    if (repeated.size) {
      for (let index = blocks.length - 1; index >= 0; index -= 1) {
        const block = blocks[index]
        if (block.type === 'heading' && block.text && repeated.has(block.text)) blocks.splice(index, 1)
      }
    }
  }

  if (emptyPages.length) {
    warnings.push(`第 ${emptyPages.slice(0, 12).join('、')} 页没有文字层（扫描页 / 图片），这部分内容看不到；可用「PDF 识图导入」`)
  }
  const pageCount = doc.numPages
  try {
    await doc.destroy()
  } catch {
    /* ignore */
  }
  return { blocks, warnings, pageCount }
}

/* ------------------------------ HTML → Block ----------------------------- */

function htmlToBlocks(html: string): Block[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script,style,noscript').forEach((node) => node.remove())
  const blocks: Block[] = []
  const push = (type: Block['type'], text: string, extra?: Partial<Block>) => {
    const value = normalizeText(text)
    if (value.length < 2) return
    blocks.push({ id: newId('b'), type, text: value, ...extra })
  }

  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase()
      if (/^h[1-6]$/.test(tag)) push('heading', (child as HTMLElement).innerText, { level: Number(tag[1]) })
      else if (tag === 'p' || tag === 'blockquote') push('paragraph', (child as HTMLElement).innerText)
      else if (tag === 'li') push('list', (child as HTMLElement).innerText)
      else if (tag === 'pre') push('code', (child as HTMLElement).innerText)
      else if (tag === 'table') {
        for (const row of Array.from(child.querySelectorAll('tr'))) {
          const cells = Array.from(row.children).map((cell) => normalizeText((cell as HTMLElement).innerText))
          if (cells.some(Boolean)) push('table', cells.join(' | '))
        }
      } else if (child.children.length) walk(child as Element)
      else {
        const text = (child as HTMLElement).innerText ?? ''
        if (text.trim().length > 20) push('paragraph', text)
      }
    }
  }
  walk(doc.body)
  return blocks
}

/* -------------------------------- 对外接口 -------------------------------- */

export async function ingestBrowserFile(file: File): Promise<DocumentRecord> {
  const name = file.name
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  const title = name.replace(/\.[^.]+$/, '')

  if (ext === 'pdf') {
    const buffer = await file.arrayBuffer()
    const { blocks, warnings, pageCount } = await pdfTextBlocks(buffer)
    if (!blocks.length) throw new Error('PDF 里没有文字层（可能是扫描件）：可以用「PDF 识图导入」')
    return createDocument({
      title,
      sourceType: 'file',
      sourceUri: name,
      blocks,
      ext: 'pdf',
      fileName: name,
      pageCount,
      warnings
    })
  }

  if (ext === 'docx') {
    const buffer = await file.arrayBuffer()
    const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
    const blocks = htmlToBlocks(result.value)
    if (!blocks.length) throw new Error('Word 文件里没提取到文字')
    return createDocument({ title, sourceType: 'file', sourceUri: name, blocks, ext: 'docx', fileName: name })
  }

  if (ext === 'html' || ext === 'htm') {
    const blocks = htmlToBlocks(await file.text())
    if (!blocks.length) throw new Error('HTML 里没提取到文字')
    return createDocument({ title, sourceType: 'file', sourceUri: name, blocks, ext, fileName: name })
  }

  if (['txt', 'md', 'markdown', 'csv', 'json'].includes(ext)) {
    const text = (await file.text()).replace(/^\uFEFF/, '')
    return ingestText(title, text, ext, name)
  }

  throw new Error(`手机版暂不支持 .${ext} 文件（支持 PDF / Word / TXT / Markdown / HTML）`)
}

export function ingestText(title: string, text: string, ext = 'txt', fileName?: string): DocumentRecord {
  const blocks = textToBlocks(text)
  if (!blocks.length) throw new Error('内容是空的')
  return createDocument({ title, sourceType: 'text', blocks, ext, fileName })
}

/** 把 PDF 每页渲染成 JPEG（给视觉模型识别用） */
export async function renderPdfPages(
  buffer: ArrayBuffer,
  options: { maxPages?: number; width?: number } = {}
): Promise<{ pages: string[]; total: number }> {
  const maxPages = options.maxPages ?? 10
  const targetWidth = options.width ?? 1200
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise
  const pages: string[] = []
  const limit = Math.min(doc.numPages, maxPages)

  for (let pageNo = 1; pageNo <= limit; pageNo += 1) {
    const page = await doc.getPage(pageNo)
    const baseViewport = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: targetWidth / baseViewport.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建画布（浏览器不支持 canvas）')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: context, viewport }).promise
    pages.push(canvas.toDataURL('image/jpeg', 0.86))
  }

  const total = doc.numPages
  try {
    await doc.destroy()
  } catch {
    /* ignore */
  }
  return { pages, total }
}

export function pdfPageCount(buffer: ArrayBuffer): Promise<number> {
  return pdfjsLib
    .getDocument({ data: new Uint8Array(buffer), isEvalSupported: false })
    .promise.then((doc: any) => {
      const total = doc.numPages
      void doc.destroy()
      return total
    })
}
