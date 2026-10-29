import type { Block, BlockType } from '@tutor/shared'
import { newId, normalizeText } from './utils'

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
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
  plusmn: '±',
  deg: '°',
  laquo: '«',
  raquo: '»',
  bull: '•',
  dagger: '†',
  permil: '‰',
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  lambda: 'λ',
  mu: 'μ',
  pi: 'π',
  sigma: 'σ',
  theta: 'θ',
  omega: 'ω',
  Delta: 'Δ',
  Sigma: 'Σ',
  Omega: 'Ω',
  rarr: '→',
  larr: '←',
  harr: '↔',
  rArr: '⇒',
  lArr: '⇐',
  le: '≤',
  ge: '≥',
  ne: '≠',
  infin: '∞',
  sum: '∑',
  prod: '∏',
  int: '∫',
  radic: '√',
  part: '∂',
  nbsp2: ' '
}

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (raw, body: string) => {
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
    return ENTITIES[body] ?? ENTITIES[body.toLowerCase()] ?? raw
  })
}

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
])

export interface HtmlNode {
  tag: string
  attrs: string
  children: Array<HtmlNode | string>
}

const TOKEN_RE =
  /<!--[\s\S]*?-->|<\/\s*([a-zA-Z0-9:-]+)\s*>|<\s*([a-zA-Z0-9:-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g

/** 轻量 HTML → 节点树（无外部依赖，够用：标题/段落/列表/表格/代码/加粗斜体） */
export function parseHtml(html: string): HtmlNode {
  const root: HtmlNode = { tag: '#root', attrs: '', children: [] }
  const stack: HtmlNode[] = [root]
  TOKEN_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TOKEN_RE.exec(html))) {
    const [, closeName, openName, attrs, selfClose, text] = match
    if (closeName) {
      const name = closeName.toLowerCase()
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tag === name) {
          stack.length = i
          break
        }
      }
    } else if (openName) {
      const name = openName.toLowerCase()
      const node: HtmlNode = { tag: name, attrs: attrs ?? '', children: [] }
      stack[stack.length - 1].children.push(node)
      if (!VOID_TAGS.has(name) && !selfClose) stack.push(node)
    } else if (text) {
      stack[stack.length - 1].children.push(decodeEntities(text))
    }
  }
  return root
}

function inlineText(node: HtmlNode | string): string {
  if (typeof node === 'string') return node
  if (node.tag === 'br') return '\n'
  const inner = node.children.map(inlineText).join('')
  if (node.tag === 'strong' || node.tag === 'b') return inner.trim() ? `**${inner.trim()}**` : inner
  if (node.tag === 'em' || node.tag === 'i') return inner.trim() ? `*${inner.trim()}*` : inner
  return inner
}

function directChildren(node: HtmlNode, tags: string[]): HtmlNode[] {
  return node.children.filter((c): c is HtmlNode => typeof c !== 'string' && tags.includes(c.tag))
}

function descendants(node: HtmlNode, tags: string[], out: HtmlNode[] = []): HtmlNode[] {
  for (const child of node.children) {
    if (typeof child === 'string') continue
    if (tags.includes(child.tag)) out.push(child)
    else descendants(child, tags, out)
  }
  return out
}

const SKIP_TAGS = new Set(['script', 'style', 'head', 'noscript', 'iframe', 'svg', 'metadata'])

export function htmlToBlocks(html: string): Block[] {
  const root = parseHtml(html)
  const blocks: Block[] = []

  const push = (type: BlockType, raw: string, extra?: Partial<Block>) => {
    const text = type === 'code' ? raw.replace(/\r/g, '').replace(/\s+$/, '') : normalizeText(raw)
    if (!text.trim()) return
    if (type === 'paragraph' && blocks.length) {
      const prev = blocks[blocks.length - 1]
      // 连续的行内片段合并成一个段落，避免碎成大量短块
      if (prev.type === 'paragraph' && (prev.text?.length ?? 0) < 120) {
        prev.text = `${prev.text}\n${text}`
        return
      }
    }
    blocks.push({ id: newId('b'), type, text, ...extra })
  }

  const visit = (node: HtmlNode, listOrdered = false) => {
    for (const child of node.children) {
      if (typeof child === 'string') {
        if (child.trim()) push('paragraph', child)
        continue
      }
      const tag = child.tag
      if (SKIP_TAGS.has(tag)) continue
      if (/^h[1-6]$/.test(tag)) {
        push('heading', inlineText(child), { level: Number(tag[1]) })
        continue
      }
      if (tag === 'p' || tag === 'blockquote' || tag === 'dt' || tag === 'dd' || tag === 'figcaption') {
        push('paragraph', inlineText(child))
        continue
      }
      if (tag === 'li') {
        push('list', inlineText(child), { ordered: listOrdered })
        continue
      }
      if (tag === 'pre') {
        push('code', inlineText(child))
        continue
      }
      if (tag === 'table') {
        for (const tr of descendants(child, ['tr'])) {
          const cells = directChildren(tr, ['td', 'th'])
          const row = cells
            .map((c) => normalizeText(inlineText(c)))
            .filter(Boolean)
            .join(' | ')
          if (row) push('table', row)
        }
        continue
      }
      if (tag === 'img') continue
      if (tag === 'ul') {
        visit(child, false)
        continue
      }
      if (tag === 'ol') {
        visit(child, true)
        continue
      }
      visit(child, listOrdered)
    }
  }

  visit(root)
  return blocks
}
