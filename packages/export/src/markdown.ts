import { marked } from 'marked'

export interface InlineRun {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
}

export type MdBlock =
  | { type: 'heading'; level: number; runs: InlineRun[] }
  | { type: 'paragraph'; runs: InlineRun[] }
  | { type: 'list'; ordered: boolean; items: InlineRun[][] }
  | { type: 'code'; text: string }
  | { type: 'quote'; runs: InlineRun[] }
  | { type: 'table'; header: InlineRun[][]; rows: InlineRun[][][] }
  | { type: 'hr' }

/* eslint-disable @typescript-eslint/no-explicit-any */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  middot: '·',
  times: '×',
  divide: '÷',
  plusmn: '±'
}

/** marked 会把 ' " < > 等转成 HTML 实体，导出到 Office 前要还原 */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (raw, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      if (!Number.isFinite(code)) return raw
      try {
        return String.fromCodePoint(code)
      } catch {
        return raw
      }
    }
    return ENTITIES[body] ?? raw
  })
}

export function inlineToRuns(tokens: any[]): InlineRun[] {
  const runs: InlineRun[] = []
  const walk = (items: any[], ctx: { bold?: boolean; italic?: boolean } = {}) => {
    for (const token of items ?? []) {
      switch (token.type) {
        case 'text':
        case 'escape':
          runs.push({ text: decodeHtmlEntities(token.text ?? ''), ...ctx })
          break
        case 'strong':
          walk(token.tokens ?? [{ type: 'text', text: token.text }], { ...ctx, bold: true })
          break
        case 'em':
          walk(token.tokens ?? [{ type: 'text', text: token.text }], { ...ctx, italic: true })
          break
        case 'del':
          walk(token.tokens ?? [{ type: 'text', text: token.text }], ctx)
          break
        case 'codespan':
          runs.push({ text: decodeHtmlEntities(token.text ?? ''), code: true, ...ctx })
          break
        case 'br':
          runs.push({ text: '\n', ...ctx })
          break
        case 'link':
          walk(token.tokens ?? [{ type: 'text', text: token.text }], ctx)
          break
        case 'image':
          runs.push({ text: token.text ? `[图片：${token.text}]` : '[图片]', ...ctx })
          break
        default:
          if (typeof token.text === 'string') runs.push({ text: decodeHtmlEntities(token.text), ...ctx })
      }
    }
  }
  walk(tokens)
  return runs.filter((r) => r.text.length > 0)
}

export function runsToPlain(runs: InlineRun[]): string {
  return runs.map((r) => r.text).join('')
}

export function parseMarkdown(markdown: string): MdBlock[] {
  const tokens = marked.lexer(markdown ?? '', { gfm: true, breaks: true }) as any[]
  const blocks: MdBlock[] = []

  const pushList = (token: any) => {
    const items: InlineRun[][] = []
    for (const item of token.items ?? []) {
      const runs: InlineRun[] = []
      for (const child of item.tokens ?? []) {
        if (child.type === 'text' || child.type === 'paragraph') runs.push(...inlineToRuns(child.tokens ?? []))
        else if (child.type === 'list') {
          for (const nested of child.items ?? []) runs.push(...inlineToRuns(nested.tokens?.[0]?.tokens ?? []))
        }
      }
      if (runs.length) items.push(runs)
    }
    if (items.length) blocks.push({ type: 'list', ordered: Boolean(token.ordered), items })
  }

  for (const token of tokens) {
    switch (token.type) {
      case 'heading':
        blocks.push({ type: 'heading', level: token.depth ?? 2, runs: inlineToRuns(token.tokens ?? []) })
        break
      case 'paragraph':
        blocks.push({ type: 'paragraph', runs: inlineToRuns(token.tokens ?? [{ type: 'text', text: token.text }]) })
        break
      case 'list':
        pushList(token)
        break
      case 'code':
        blocks.push({ type: 'code', text: token.text ?? '' })
        break
      case 'blockquote': {
        const inner = (token.tokens ?? []) as any[]
        const runs = inner.flatMap((t) => inlineToRuns(t.tokens ?? [{ type: 'text', text: t.text ?? '' }]))
        if (runs.length) blocks.push({ type: 'quote', runs })
        break
      }
      case 'table': {
        const header = (token.header ?? []).map((cell: any) => inlineToRuns(cell.tokens ?? []))
        const rows = (token.rows ?? []).map((row: any[]) => row.map((cell: any) => inlineToRuns(cell.tokens ?? [])))
        blocks.push({ type: 'table', header, rows })
        break
      }
      case 'hr':
        blocks.push({ type: 'hr' })
        break
      case 'html':
        break
      default:
        if (typeof token.text === 'string' && token.text.trim()) {
          blocks.push({ type: 'paragraph', runs: [{ text: token.text }] })
        }
    }
  }
  return blocks
}

/** 把 $...$ / $$...$$ 替换成占位符，渲染后再还原为 KaTeX 的 MathML（PDF 无需外部字体） */
export function protectMath(markdown: string): { text: string; math: { latex: string; display: boolean }[] } {
  const math: { latex: string; display: boolean }[] = []
  const text = markdown
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, latex: string) => {
      math.push({ latex, display: true })
      return `@@MATH${math.length - 1}@@`
    })
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, latex: string) => {
      math.push({ latex, display: true })
      return `@@MATH${math.length - 1}@@`
    })
    .replace(/(?<!\$)\$(?!\$)([^\n$]{1,400}?)\$(?!\$)/g, (_m, latex: string) => {
      math.push({ latex, display: false })
      return `@@MATH${math.length - 1}@@`
    })
  return { text, math }
}

export function restoreMath(html: string, math: { latex: string; display: boolean }[], render: (latex: string, display: boolean) => string): string {
  return html.replace(/@@MATH(\d+)@@/g, (_m, index: string) => {
    const item = math[Number(index)]
    return item ? render(item.latex, item.display) : ''
  })
}
