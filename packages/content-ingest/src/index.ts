import path from 'node:path'
import { readFile } from 'node:fs/promises'
import type { Block, Chunk, DocumentMeta, DocumentRecord, SourceType } from '@tutor/shared'
import { textToBlocks } from './text'
import { htmlToBlocks } from './html'
import { docxToBlocks } from './docx'
import { pdfToBlocks } from './pdf'
import { pptxToBlocks } from './pptx'
import { newId, normalizeText, splitSentences } from './utils'

export { htmlToBlocks, parseHtml, decodeEntities } from './html'
export { textToBlocks } from './text'
export { docxToBlocks } from './docx'
export { pdfToBlocks, looksLikeHeadingText } from './pdf'
export { pptxToBlocks } from './pptx'
export { newId, normalizeText, splitSentences, truncate } from './utils'
export { textToBlocks as markdownToBlocks } from './text'

export const SUPPORTED_EXTS = ['txt', 'md', 'markdown', 'docx', 'pdf', 'pptx', 'csv', 'json', 'html', 'htm']

export const FILE_FILTERS = [{ name: '学习材料', extensions: SUPPORTED_EXTS }]

export interface IngestedDocument {
  title: string
  sourceType: SourceType
  sourceUri?: string
  blocks: Block[]
  plainText: string
  meta: DocumentMeta
}

export function blocksToPlainText(blocks: Block[]): string {
  const lines: string[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
        lines.push(`${'#'.repeat(Math.min(6, block.level ?? 2))} ${block.text ?? ''}`)
        break
      case 'formula':
        lines.push(`$$${block.latex ?? block.text ?? ''}$$`)
        break
      case 'list':
        lines.push(`${block.ordered ? '1.' : '-'} ${block.text ?? ''}`)
        break
      case 'code':
        lines.push('```')
        lines.push(block.text ?? '')
        lines.push('```')
        break
      case 'table':
        lines.push(block.text ?? '')
        break
      default:
        lines.push(block.text ?? '')
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function chunkBlocks(blocks: Block[], maxChars = 3600): Chunk[] {
  const chunks: Chunk[] = []
  let current: Block[] = []
  let currentLen = 0

  const flush = () => {
    if (!current.length) return
    const index = chunks.length
    chunks.push({
      id: `c${index + 1}`,
      index,
      text: blocksToPlainText(current),
      blockIds: current.map((b) => b.id)
    })
    current = []
    currentLen = 0
  }

  for (const block of blocks) {
    const text = block.text ?? block.latex ?? ''
    if (text.length > maxChars) {
      flush()
      for (const piece of splitSentences(text, maxChars)) {
        chunks.push({
          id: `c${chunks.length + 1}`,
          index: chunks.length,
          text: piece,
          blockIds: [block.id]
        })
      }
      continue
    }
    if (currentLen + text.length > maxChars && current.length) flush()
    current.push(block)
    currentLen += text.length + 8
  }
  flush()
  return chunks
}

export function createDocument(input: {
  title: string
  sourceType: SourceType
  sourceUri?: string
  blocks: Block[]
  ext?: string
  fileName?: string
  pageCount?: number
  warnings?: string[]
  chunkSize?: number
}): DocumentRecord {
  const plainText = blocksToPlainText(input.blocks)
  const chunkCount = chunkBlocks(input.blocks, input.chunkSize ?? 3600).length
  const meta: DocumentMeta = {
    fileName: input.fileName,
    ext: input.ext,
    charCount: plainText.length,
    blockCount: input.blocks.length,
    chunkCount,
    pageCount: input.pageCount,
    warnings: input.warnings ?? []
  }
  return {
    id: newId('doc'),
    title: normalizeText(input.title) || '未命名材料',
    sourceType: input.sourceType,
    sourceUri: input.sourceUri,
    createdAt: Date.now(),
    blocks: input.blocks,
    plainText,
    meta
  }
}

async function readTextFile(filePath: string): Promise<string> {
  const buffer = await readFile(filePath)
  const head = buffer.subarray(0, Math.min(buffer.length, 4096))
  const nulCount = head.reduce((acc, byte) => (byte === 0 ? acc + 1 : acc), 0)
  if (nulCount > 8) throw new Error('看起来是二进制文件（如旧版 .doc），请先另存为 .docx / .pdf / .txt')
  return buffer.toString('utf8').replace(/^\uFEFF/, '')
}

export async function ingestFromFile(filePath: string): Promise<IngestedDocument> {
  const ext = path.extname(filePath).toLowerCase().replace('.', '')
  const baseTitle = path.basename(filePath, path.extname(filePath))

  if (ext === 'docx') {
    const { blocks, warnings } = await docxToBlocks(filePath)
    if (!blocks.length) throw new Error('DOCX 中未提取到文字内容')
    return finalize({ title: baseTitle, sourceType: 'file', sourceUri: filePath, blocks, ext, fileName: path.basename(filePath), warnings })
  }

  if (ext === 'pdf') {
    const { blocks, warnings, pageCount } = await pdfToBlocks(filePath)
    if (!blocks.length) throw new Error('PDF 中未提取到文本层（可能是扫描件），请改用粘贴文本')
    return finalize({
      title: baseTitle,
      sourceType: 'file',
      sourceUri: filePath,
      blocks,
      ext,
      fileName: path.basename(filePath),
      warnings,
      pageCount
    })
  }

  if (ext === 'pptx') {
    const { blocks, warnings, slideCount } = pptxToBlocks(filePath)
    if (!blocks.length) throw new Error('PPTX 中未提取到文字内容')
    return finalize({
      title: baseTitle,
      sourceType: 'file',
      sourceUri: filePath,
      blocks,
      ext,
      fileName: path.basename(filePath),
      warnings,
      pageCount: slideCount
    })
  }

  const text = await readTextFile(filePath)
  const blocks = ext === 'html' || ext === 'htm' ? htmlToBlocks(text) : textToBlocks(text)
  if (!blocks.length) throw new Error('文件中没有可用的文字内容')
  return finalize({
    title: baseTitle,
    sourceType: 'file',
    sourceUri: filePath,
    blocks,
    ext,
    fileName: path.basename(filePath)
  })
}

export function ingestFromText(text: string, title: string): IngestedDocument {
  const blocks = textToBlocks(text)
  if (!blocks.length) throw new Error('文本内容为空')
  return finalize({ title, sourceType: 'text', blocks, ext: 'txt' })
}

export function ingestFromHtml(html: string, opts: { title: string; url: string }): IngestedDocument {
  const blocks = htmlToBlocks(html)
  if (!blocks.length) throw new Error('网页中没有提取到正文')
  return finalize({ title: opts.title, sourceType: 'web', sourceUri: opts.url, blocks, ext: 'html' })
}

export function ingestFromBlocks(input: {
  title: string
  sourceType: SourceType
  sourceUri?: string
  blocks: Block[]
  ext?: string
  pageCount?: number
  warnings?: string[]
}): IngestedDocument {
  if (!input.blocks.length) throw new Error('没有提取到任何内容')
  return finalize({ ...input, fileName: input.sourceUri ? path.basename(input.sourceUri) : undefined })
}

function finalize(input: {
  title: string
  sourceType: SourceType
  sourceUri?: string
  blocks: Block[]
  ext?: string
  fileName?: string
  pageCount?: number
  warnings?: string[]
}): IngestedDocument {
  const plainText = blocksToPlainText(input.blocks)
  return {
    title: input.title,
    sourceType: input.sourceType,
    sourceUri: input.sourceUri,
    blocks: input.blocks,
    plainText,
    meta: {
      fileName: input.fileName,
      ext: input.ext,
      charCount: plainText.length,
      blockCount: input.blocks.length,
      chunkCount: chunkBlocks(input.blocks, 3600).length,
      pageCount: input.pageCount,
      warnings: input.warnings ?? []
    }
  }
}

/** 供提示词使用：抽取与某一节标题最相关的原文片段 */
export function excerptForSection(blocks: Block[], title: string, budget = 4000): string {
  const keywords = Array.from(
    new Set(
      title
        .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 2)
    )
  )
  if (!keywords.length) return blocksToPlainText(blocks).slice(0, budget)

  let best = -1
  let bestScore = 0
  blocks.forEach((block, index) => {
    const text = block.text ?? ''
    const score = keywords.reduce((acc, kw) => acc + (text.includes(kw) ? kw.length : 0), 0)
    if (score > bestScore) {
      bestScore = score
      best = index
    }
  })

  if (best < 0 || bestScore === 0) return blocksToPlainText(blocks).slice(0, budget)

  const out: Block[] = []
  let length = 0
  for (let i = Math.max(0, best - 2); i < blocks.length && length < budget; i += 1) {
    const block = blocks[i]
    out.push(block)
    length += (block.text ?? '').length
  }
  return blocksToPlainText(out).slice(0, budget)
}
