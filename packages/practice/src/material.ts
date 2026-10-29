import type { Block, DocumentRecord } from '@tutor/shared'
import { looksLikeHeadingText } from '@tutor/content-ingest'

export interface MaterialContext {
  /** 给模型看的节选（按小节取样，不是简单截前 N 字） */
  text: string
  /** 可考查的知识点（来自标题） */
  sections: string[]
  chars: number
  /** 真正像正文的字符数，用来判断这份材料到底能不能出题 */
  usableChars: number
  warnings: string[]
}

const MAX_CHARS = 9000
const SECTION_BUDGET = 700
const MIN_USABLE_CHARS = 400

function textOf(block: Block): string {
  return typeof block.text === 'string' ? block.text.trim() : ''
}

function isProse(text: string): boolean {
  if (text.length < 12) return false
  if (/^(https?:|www\.)/i.test(text)) return false
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) ?? []).length
  const words = (text.match(/[A-Za-z]{2,}/g) ?? []).length
  const codeSymbols = (text.match(/[{}<>;`~^|\\]/g) ?? []).length
  const symbolRatio = codeSymbols / text.length
  if (cjk / text.length > 0.12) return symbolRatio < 0.14
  return words >= 3 && symbolRatio < 0.06
}

/** 标题去重：去掉符号后取前 10 个字做 key，避免「§4.函数」「§4.函数 }」重复占位 */
function sectionKey(title: string): string {
  return title
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .slice(0, 10)
    .toLowerCase()
}

/** 标题够不够格当"知识点"：至少 3 个汉字、不像公式碎片 */
function isUsableSection(title: string): boolean {
  if (!looksLikeHeadingText(title)) return false
  if (/\)\(|\(\)|[A-Za-z]\)/.test(title)) return false
  const normalized = title.replace(/[\s\p{P}\p{S}]/gu, '')
  const cjk = (normalized.match(/[\u4e00-\u9fa5]/g) ?? []).length
  return cjk >= 3
}

/**
 * 老材料里可能存着「§4.函数」这种每页重复的页眉（导入时才过滤，历史数据没有）。
 * 这里按前缀统计：同一个短前缀出现 3 次以上，认为它是页眉，整组丢掉。
 */
function dropRepeatedPrefixes(titles: string[]): string[] {
  const prefixCount = new Map<string, number>()
  for (const title of titles) {
    const key = sectionKey(title).slice(0, 4)
    prefixCount.set(key, (prefixCount.get(key) ?? 0) + 1)
  }
  return titles.filter((title) => (prefixCount.get(sectionKey(title).slice(0, 4)) ?? 0) < 3)
}

export function buildMaterialContext(doc: DocumentRecord): MaterialContext {
  const warnings: string[] = []
  const blocks: Block[] = Array.isArray(doc.blocks) ? doc.blocks : []

  const proseBlocks = blocks.filter((block) => block.type !== 'heading' && isProse(textOf(block)))
  const usableChars = proseBlocks.reduce((sum, block) => sum + textOf(block).length, 0)

  // 只保留"像标题"的标题，并按前缀去重
  const seen = new Set<string>()
  const candidates: string[] = []
  for (const block of blocks) {
    if (block.type !== 'heading') continue
    const title = textOf(block)
    if (!isUsableSection(title)) continue
    const key = sectionKey(title)
    if (!key || seen.has(key)) continue
    seen.add(key)
    candidates.push(title)
    if (candidates.length >= 60) break
  }
  const sections = dropRepeatedPrefixes(candidates).slice(0, 40)

  const parts: string[] = []
  let used = 0
  const push = (chunk: string) => {
    if (used >= MAX_CHARS) return
    const room = MAX_CHARS - used
    const text = chunk.length > room ? chunk.slice(0, room) : chunk
    parts.push(text)
    used += text.length
  }

  const useSections = sections.length >= 2

  if (useSections) {
    push(`【文档】${doc.title}\n`)
    push(`【知识点清单】\n${sections.map((title, index) => `${index + 1}. ${title}`).join('\n')}\n\n`)
    let currentSection = ''
    const perSection = new Map<string, number>()
    for (const block of blocks) {
      if (block.type === 'heading') {
        const title = textOf(block)
        if (isUsableSection(title)) currentSection = title
        continue
      }
      const text = textOf(block)
      if (!isProse(text)) continue
      const key = currentSection || '（未归入小节）'
      const spent = perSection.get(key) ?? 0
      if (spent >= SECTION_BUDGET) continue
      const take = text.slice(0, SECTION_BUDGET - spent)
      push(`\n[${key}] ${take}\n`)
      perSection.set(key, spent + take.length)
      if (used >= MAX_CHARS) break
    }
  } else {
    // 没有可靠标题：均匀抽样，避免只用文档开头（开头常常是封面 / 目录 / 代码）
    const step = Math.max(1, Math.ceil(proseBlocks.length / 24))
    const sampled: string[] = []
    for (let index = 0; index < proseBlocks.length && sampled.length < 24; index += step) {
      sampled.push(textOf(proseBlocks[index]))
    }
    push(`【文档】${doc.title}\n\n`)
    for (const text of sampled) {
      push(`\n${text.slice(0, 800)}\n`)
      if (used >= MAX_CHARS) break
    }
  }

  const text = parts.join('').trim()

  if (usableChars < MIN_USABLE_CHARS) {
    warnings.push(
      `这份材料里像样的正文只有 ${usableChars} 字（其余多是代码、公式碎片或网页噪声），出的题可能不可靠`
    )
  }
  if (!useSections) {
    warnings.push('材料没有可靠的标题结构，已改为从正文里均匀取样；题目会围绕节选内容出')
  }

  return { text, sections: useSections ? sections : [], chars: text.length, usableChars, warnings }
}
