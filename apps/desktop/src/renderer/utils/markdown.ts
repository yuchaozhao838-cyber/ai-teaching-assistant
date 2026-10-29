import { marked } from 'marked'
import DOMPurify from 'dompurify'
import katex from 'katex'

marked.setOptions({ gfm: true, breaks: true })

interface MathItem {
  latex: string
  display: boolean
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function protectMath(source: string): { text: string; math: MathItem[] } {
  const math: MathItem[] = []
  const text = source
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

export function renderMarkdown(source: string): string {
  if (!source) return ''
  const { text, math } = protectMath(source)
  let html = marked.parse(text, { async: false }) as string
  html = html.replace(/@@MATH(\d+)@@/g, (_m, index: string) => {
    const item = math[Number(index)]
    if (!item) return ''
    try {
      return katex.renderToString(item.latex, {
        displayMode: item.display,
        throwOnError: false,
        strict: false,
        trust: false
      })
    } catch {
      return `<code>${escapeHtml(item.latex)}</code>`
    }
  })
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form']
  })
}

export function plainPreview(source: string, max = 120): string {
  const flat = String(source ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/**
 * 行内渲染：重点条目这类短文本里常带 $...$ 公式，需要走 KaTeX，
 * 但不能带出 <p> 包裹（否则卡片排版会被撑开）。
 */
export function renderInline(source: string): string {
  if (!source) return ''
  return renderMarkdown(source)
    .replace(/^\s*<p>/, '')
    .replace(/<\/p>\s*$/, '')
    .trim()
}
