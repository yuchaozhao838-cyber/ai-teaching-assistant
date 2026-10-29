import { BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 用隐藏窗口 + Chromium 打印成 PDF（设计文档：Electron printToPDF） */
export async function printHtmlToPdf(html: string): Promise<Buffer> {
  const tmp = path.join(os.tmpdir(), `ai-tutor-print-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`)
  await fs.writeFile(tmp, html, 'utf8')
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true,
      images: true
    }
  })
  try {
    await win.loadFile(tmp)
    await new Promise((resolve) => setTimeout(resolve, 350))
    return await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      pageSize: 'A4'
    })
  } finally {
    win.destroy()
    await fs.unlink(tmp).catch(() => undefined)
  }
}
