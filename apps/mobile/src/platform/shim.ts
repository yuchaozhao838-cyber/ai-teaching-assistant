/**
 * 浏览器版 `@tutor/content-ingest` 的替身：
 * 只实现提示词/分块用得到的纯函数，避开 Node 的 fs / path / crypto。
 */
import type { Block, Chunk, DocumentMeta, DocumentRecord, SourceType } from '@tutor/shared'

export function newId(prefix: string): string {
  const random = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
  return `${prefix}_${random.slice(0, 12)}`
}

export function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 20))}\n…（后略）`
}

export function splitSentences(text: string, max: number): string[] {
  if (text.length <= max) return [text]
  const parts: string[] = []
  let rest = text
  while (rest.length > max) {
    const window = rest.slice(0, max)
    let cut = Math.max(
      window.lastIndexOf('。'),
      window.lastIndexOf('！'),
      window.lastIndexOf('？'),
      window.lastIndexOf('\n'),
      window.lastIndexOf('. ')
    )
    if (cut < max * 0.4) cut = max
    parts.push(rest.slice(0, cut + 1).trim())
    rest = rest.slice(cut + 1).trim()
  }
  if (rest) parts.push(rest)
  return parts.filter(Boolean)
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
      default:
        lines.push(block.text ?? '')
    }
  }
  return lines.join('\n\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** 纯文本 / Markdown → Block[] */
export function textToBlocks(input: string): Block[] {
  const lines = input.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  const push = (type: Block['type'], text: string, extra?: Partial<Block>) => {
    if (!text.trim()) return
    blocks.push({ id: newId('b'), type, text: text.trim(), ...extra })
  }

  let inCode = false
  let codeBuf: string[] = []
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (/^\s*```/.test(line)) {
      if (inCode) {
        push('code', codeBuf.join('\n'))
        codeBuf = []
        inCode = false
      } else {
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeBuf.push(raw)
      continue
    }
    if (!line.trim()) continue

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      push('heading', heading[2], { level: heading[1].length })
      continue
    }
    const formula = /^\s*\$\$\s*([\s\S]+?)\s*\$\$\s*$/.exec(line)
    if (formula) {
      push('formula', formula[1], { latex: formula[1] })
      continue
    }
    if (/^\s*[-*+•]\s+/.test(line)) {
      push('list', line.replace(/^\s*[-*+•]\s+/, ''), { ordered: false })
      continue
    }
    if (/^\s*\d+[.)、]\s+/.test(line)) {
      push('list', line.replace(/^\s*\d+[.)、]\s+/, ''), { ordered: true })
      continue
    }
    if (/^\s*\|?.+\|.+\|?\s*$/.test(line) && (line.match(/\|/g)?.length ?? 0) >= 2) {
      push(
        'table',
        line
          .replace(/^\s*\|/, '')
          .replace(/\|\s*$/, '')
          .split('|')
          .map((cell) => cell.trim())
          .join(' | ')
      )
      continue
    }
    push('paragraph', line)
  }
  if (inCode && codeBuf.length) push('code', codeBuf.join('\n'))
  return blocks
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
      blockIds: current.map((block) => block.id)
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

export function excerptForSection(blocks: Block[], title: string, budget = 4000): string {
  const keywords = Array.from(
    new Set(
      title
        .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ')
        .split(/\s+/)
        .filter((word) => word.length >= 2)
    )
  )
  if (!keywords.length) return blocksToPlainText(blocks).slice(0, budget)

  let best = -1
  let bestScore = 0
  blocks.forEach((block, index) => {
    const text = block.text ?? ''
    const score = keywords.reduce((acc, keyword) => acc + (text.includes(keyword) ? keyword.length : 0), 0)
    if (score > bestScore) {
      bestScore = score
      best = index
    }
  })

  if (best < 0 || bestScore === 0) return blocksToPlainText(blocks).slice(0, budget)

  const out: Block[] = []
  let length = 0
  for (let index = Math.max(0, best - 2); index < blocks.length && length < budget; index += 1) {
    const block = blocks[index]
    out.push(block)
    length += (block.text ?? '').length
  }
  return blocksToPlainText(out).slice(0, budget)
}

/** 判断一行"像不像标题"（与 Node 端一致，供 practice 材料取样使用） */
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

export function createDocument(input: {
  title: string
  sourceType: SourceType
  sourceUri?: string
  blocks: Block[]
  ext?: string
  fileName?: string
  pageCount?: number
  warnings?: string[]
}): DocumentRecord {
  const plainText = blocksToPlainText(input.blocks)
  const meta: DocumentMeta = {
    fileName: input.fileName,
    ext: input.ext,
    charCount: plainText.length,
    blockCount: input.blocks.length,
    chunkCount: chunkBlocks(input.blocks).length,
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

export function createEmptyDocument(title: string): DocumentRecord {
  return createDocument({ title, sourceType: 'text', blocks: [], ext: 'txt' })
}
