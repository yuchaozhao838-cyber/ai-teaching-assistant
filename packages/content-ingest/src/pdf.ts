import { readFile } from 'node:fs/promises'
import type { Block } from '@tutor/shared'
import { newId, normalizeText } from './utils'

/* eslint-disable @typescript-eslint/no-var-requires */

interface PdfItem {
  str: string
  transform: number[]
  width: number
  height: number
}

interface Line {
  y: number
  size: number
  parts: Array<{ x: number; w: number; str: string }>
}

const SENTENCE_END = /[。．.！!？?；;：:”"』」）)]$/

/**
 * 判断一行"像不像标题"：标题一般是短语，含汉字或单词，不像代码/公式/页码。
 * 避免把 `§4.函数 }`、`x<=1`、`=> C方式编译正确`、`100% - +` 这类行当标题。
 */
export function looksLikeHeadingText(raw: string): boolean {
  const text = raw.trim()
  if (text.length < 2 || text.length > 60) return false
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length
  const words = (text.match(/[A-Za-z]{2,}/g) ?? []).length
  const symbols = (text.match(/[{}<>=;`~^|\\[\]()#$%&*+/]/g) ?? []).length
  if (symbols / text.length > 0.2) return false
  if (/=>|->|<<|>>|==|!=|&&|\|\||;\s*$|[{}]\s*$/.test(text)) return false
  if (/^\s*[0-9%./-]+\s*$/.test(text)) return false
  return cjk >= 2 || words >= 2
}

function joinParts(parts: Array<{ x: number; w: number; str: string }>): string {
  let out = ''
  let prevEnd = Number.NaN
  for (const part of parts) {
    const gap = Number.isFinite(prevEnd) ? part.x - prevEnd : Number.NaN
    const needSpace =
      out.length > 0 &&
      !/\s$/.test(out) &&
      !/^\s/.test(part.str) &&
      Number.isFinite(gap) &&
      gap > 1.2 &&
      !/^[，。；：、！？）》」』,.;:!?)]/.test(part.str)
    out += needSpace ? ` ${part.str}` : part.str
    prevEnd = part.x + part.w
  }
  return out
}

export async function pdfToBlocks(filePath: string): Promise<{ blocks: Block[]; warnings: string[]; pageCount: number }> {
  const pdfjs: any = require('pdfjs-dist/legacy/build/pdf.js')
  const data = new Uint8Array(await readFile(filePath))
  let doc: any
  try {
    const task = pdfjs.getDocument({
      data,
      isEvalSupported: false,
      useSystemFonts: true,
      disableFontFace: true,
      verbosity: 0
    })
    doc = await task.promise
  } catch (error) {
    const message = (error as Error)?.message ?? String(error)
    throw new Error(
      `PDF 解析失败：${message}\n如果是扫描版或加密 PDF（没有文本层），请改用「粘贴文本」导入`
    )
  }
  const blocks: Block[] = []
  const warnings: string[] = []
  const pageCount: number = doc.numPages
  /** 公式符号较多的页（这类页的上下标/分式会被拉平成纯文本） */
  const mathHeavyPages: number[] = []
  /** 没有文字层的页（扫描页 / 纯图片 / 图表） */
  const imageOnlyPages: number[] = []
  /** 标题文字 → 出现在哪些页（用来识别每页重复的页眉/页脚） */
  const headingPages = new Map<string, Set<number>>()

  for (let pageNo = 1; pageNo <= pageCount; pageNo += 1) {
    let page: any
    try {
      page = await doc.getPage(pageNo)
      const content = await page.getTextContent()
      const items = (content.items as PdfItem[]).filter((i) => typeof i.str === 'string' && i.str.trim())
      const lines: Line[] = []

      for (const item of items) {
        const tr = item.transform ?? [1, 0, 0, 1, 0, 0]
        const x = tr[4] ?? 0
        const y = tr[5] ?? 0
        const size = Math.abs(tr[3] ?? 0) || item.height || 10
        let line = lines.find((l) => Math.abs(l.y - y) < Math.max(1.5, size * 0.4))
        if (!line) {
          line = { y, size, parts: [] }
          lines.push(line)
        }
        line.parts.push({ x, w: item.width ?? 0, str: item.str })
        line.size = Math.max(line.size, size)
      }

      // 统计这一页的“公式密度”和是否只有图片
      const pageText = items.map((i) => i.str).join('')
      if (pageText.trim().length < 5) {
        imageOnlyPages.push(pageNo)
      } else {
        const mathSymbols = (pageText.match(/[∫∑∏√±≤≥≠≈∞∂∇αβγδθλμπσωΔΣΩ×÷·^_]/g) ?? []).length
        if (pageText.length > 120 && mathSymbols / pageText.length > 0.03) mathHeavyPages.push(pageNo)
      }

      lines.sort((a, b) => b.y - a.y)
      const sizes = lines.map((l) => l.size).sort((a, b) => a - b)
      const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 10

      let buffer = ''
      let bufferIsHeading = false
      const flush = () => {
        const text = normalizeText(buffer)
        if (text) {
          if (bufferIsHeading) blocks.push({ id: newId('b'), type: 'heading', text, level: 2 })
          else blocks.push({ id: newId('b'), type: 'paragraph', text })
        }
        buffer = ''
        bufferIsHeading = false
      }

      for (const line of lines) {
        const text = normalizeText(joinParts(line.parts))
        if (!text) continue
        // 只靠"字号大"判断标题会把代码行/公式行/页码当成标题（§4.函数、x<=1、100% - +），
        // 这里再加一层"像不像标题文字"的过滤
        const isHeading = line.size > median * 1.18 && looksLikeHeadingText(text)
        if (isHeading) {
          if (!headingPages.has(text)) headingPages.set(text, new Set())
          headingPages.get(text)!.add(pageNo)
          flush()
          buffer = text
          bufferIsHeading = true
          flush()
          continue
        }
        if (!buffer) buffer = text
        else if (SENTENCE_END.test(buffer) && buffer.length > 30) {
          flush()
          buffer = text
        } else {
          buffer += /[\u4e00-\u9fa5]$/.test(buffer) ? text : ` ${text}`
        }
      }
      flush()
      page.cleanup?.()
    } catch (error) {
      warnings.push(`第 ${pageNo} 页解析失败：${(error as Error).message}`)
    }
  }

  try {
    await doc.destroy()
  } catch {
    /* ignore */
  }

  // 每页都重复出现的"标题"其实是页眉/页脚（例如 `§4.函数`），当成知识点会教坏模型
  if (pageCount >= 4) {
    const repeated = new Set(
      [...headingPages.entries()].filter(([, pages]) => pages.size >= 3).map(([text]) => text)
    )
    if (repeated.size) {
      for (let index = blocks.length - 1; index >= 0; index -= 1) {
        const block = blocks[index]
        if (block.type === 'heading' && block.text && repeated.has(block.text)) blocks.splice(index, 1)
      }
      warnings.push(`已忽略重复出现的页眉/页脚文字：${[...repeated].slice(0, 3).join('、')}`)
    }
  }

  const listPages = (pages: number[], max = 12) => {
    const head = pages.slice(0, max).join('、')
    return pages.length > max ? `${head} 等 ${pages.length} 页` : head
  }

  if (imageOnlyPages.length) {
    warnings.push(
      `第 ${listPages(imageOnlyPages)} 页没有文字层（扫描页 / 纯图片 / 图表），这部分内容 AI 看不到。` +
        '建议：把关键页截图后用「粘贴文本」补充，或改用 Word / PPT 版课件。'
    )
  }
  if (mathHeavyPages.length) {
    warnings.push(
      `第 ${listPages(mathHeavyPages)} 页公式较多：PDF 只能取到文字层，公式的上下标、分式、根号会被拉平成一行纯文本。` +
        '建议：这些章节用「粘贴文本」贴入教材原文（可直接写 LaTeX），或在讲解时对照原 PDF 检查公式。'
    )
  }
  if (pageCount > 0 && !imageOnlyPages.length && !mathHeavyPages.length) {
    warnings.push('PDF 以文字层提取，图表里的信息（坐标轴、示意图）无法进入讲解；数值与公式请对照原文件核对。')
  }
  return { blocks, warnings, pageCount }
}
