/* eslint-disable @typescript-eslint/no-var-requires */
// 在隐藏窗口里把 PDF 每一页画到 canvas 上，导出 JPEG dataURL（供视觉模型识别）
const pdfjsLib: any = require('pdfjs-dist/legacy/build/pdf.js')

interface RenderOptions {
  maxPages?: number
  width?: number
}

interface RenderResult {
  pages: string[]
  total: number
}

async function renderPdf(base64: string, options: RenderOptions = {}): Promise<RenderResult> {
  const maxPages = options.maxPages ?? 12
  const targetWidth = options.width ?? 1200

  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)

  const doc = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false, verbosity: 0 }).promise
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
    if (!context) throw new Error('无法创建 canvas 2d 上下文')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: context, viewport }).promise
    pages.push(canvas.toDataURL('image/jpeg', 0.86))
  }

  const total = doc.numPages as number
  try {
    await doc.destroy()
  } catch {
    /* ignore */
  }
  return { pages, total }
}

;(window as unknown as { renderPdf: typeof renderPdf }).renderPdf = renderPdf
