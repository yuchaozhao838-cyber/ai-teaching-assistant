import { BrowserWindow } from 'electron'
import path from 'node:path'
import { readFile } from 'node:fs/promises'

export interface RenderPdfResult {
  pages: string[]
  total: number
}

/**
 * 把 PDF 每一页渲染成 JPEG（dataURL），交给视觉模型逐页转写。
 * 渲染发生在隐藏窗口里（pdf.js + canvas），不依赖原生 canvas 模块。
 */
export async function renderPdfPages(
  filePath: string,
  options: { maxPages?: number; width?: number; onPage?: (page: number, total: number) => void } = {}
): Promise<RenderPdfResult> {
  const buffer = await readFile(filePath)
  const base64 = buffer.toString('base64')
  const maxPages = options.maxPages ?? 12
  const width = options.width ?? 1200

  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true }
  })

  try {
    const htmlFile = path.join(__dirname, '../pdf-renderer/index.html')
    await win.loadFile(htmlFile)
    const result = (await win.webContents.executeJavaScript(
      `window.renderPdf(${JSON.stringify(base64)}, ${JSON.stringify({ maxPages, width })})`,
      true
    )) as RenderPdfResult
    if (!result?.pages?.length) throw new Error('PDF 渲染失败（没有生成页面图片）')
    options.onPage?.(result.pages.length, result.total)
    return result
  } finally {
    win.destroy()
  }
}
