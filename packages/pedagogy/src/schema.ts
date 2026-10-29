import { z } from 'zod'
import type { KeyPointLevel, OutlineNode } from '@tutor/shared'

const outlineItem = z.object({
  title: z.string().min(1),
  summary: z.string().optional(),
  hint: z.string().optional()
})

export const outlineSchema = z.object({
  outline: z.array(outlineItem).min(1).max(16)
})

const levelSchema = z.string()

const keyPointItem = z.object({
  sectionId: z.string().optional(),
  section: z.union([z.string(), z.number()]).optional(),
  level: levelSchema.optional(),
  text: z.string().min(1),
  rationale: z.string().optional()
})

export const keyPointSchema = z.object({
  keyPoints: z.array(keyPointItem).min(1).max(60)
})

export interface OutlineJsonResult {
  title: string
  summary: string
  hint?: string
}

/** 从模型输出中抠出第一个完整的 JSON 对象（容忍代码块、前后废话） */
export function extractJson(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '')
  const candidates: string[] = []
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi
  let fenceMatch: RegExpExecArray | null
  while ((fenceMatch = fence.exec(raw))) candidates.push(fenceMatch[1])
  candidates.push(text)

  for (const candidate of candidates) {
    const direct = candidate.trim()
    if ((direct.startsWith('{') || direct.startsWith('[')) && direct.length > 2) {
      try {
        return JSON.parse(direct)
      } catch {
        /* fall through */
      }
    }
    const first = candidate.indexOf('{')
    if (first < 0) continue
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = first; i < candidate.length; i += 1) {
      const ch = candidate[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '{') depth += 1
      else if (ch === '}') {
        depth -= 1
        if (depth === 0) {
          const slice = candidate.slice(first, i + 1)
          try {
            return JSON.parse(slice)
          } catch {
            break
          }
        }
      }
    }
  }
  throw new Error('模型输出里没有可解析的 JSON')
}

export function normalizeOutline(raw: unknown): OutlineNode[] {
  const parsed = outlineSchema.parse(raw)
  return parsed.outline.map((item, index) => ({
    id: `s${index + 1}`,
    title: item.title.trim().slice(0, 60),
    summary: (item.summary ?? '').trim().slice(0, 120),
    hint: item.hint?.trim().slice(0, 120) || undefined,
    children: []
  }))
}

export function normalizeLevel(raw: unknown): KeyPointLevel {
  const value = String(raw ?? '').toLowerCase().trim()
  if (['high', 'h', '高', '重点', '3', '核心', 'important'].includes(value)) return 'high'
  if (['low', 'l', '低', '了解', '1', 'easy'].includes(value)) return 'low'
  return 'medium'
}

export interface KeyPointJsonResult {
  sectionId?: string
  section?: string | number
  level?: string
  text: string
  rationale?: string
}

export function normalizeKeyPoints(
  raw: unknown,
  outline: OutlineNode[]
): Array<{ sectionId: string; level: KeyPointLevel; text: string; rationale?: string }> {
  const parsed = keyPointSchema.parse(raw)
  const idSet = new Set(outline.map((n) => n.id))
  return parsed.keyPoints
    .map((item) => {
      let sectionId = (item.sectionId ?? '').trim()
      if (!idSet.has(sectionId)) {
        // 允许模型用序号或小节标题指代
        const numeric = Number(sectionId.replace(/[^0-9]/g, ''))
        if (sectionId && Number.isFinite(numeric) && numeric >= 1 && numeric <= outline.length) {
          sectionId = outline[numeric - 1].id
        } else if (typeof item.section === 'number' && item.section >= 1 && item.section <= outline.length) {
          sectionId = outline[item.section - 1].id
        } else if (typeof item.section === 'string') {
          const byTitle = outline.find((n) => n.title.includes(item.section as string) || (item.section as string).includes(n.title))
          sectionId = byTitle?.id ?? outline[0]?.id ?? 's1'
        } else {
          sectionId = outline[0]?.id ?? 's1'
        }
      }
      return {
        sectionId,
        level: normalizeLevel(item.level),
        text: item.text.trim().slice(0, 140),
        rationale: item.rationale?.trim().slice(0, 100) || undefined
      }
    })
    .filter((item) => item.text.length > 0)
}

/** 降级方案：从 Markdown 的「【高】…」或 `**重点**` 里抽取重点 */
export function keyPointsFromMarkdown(
  markdown: string,
  outline: OutlineNode[]
): Array<{ sectionId: string; level: KeyPointLevel; text: string; rationale?: string }> {
  const result: Array<{ sectionId: string; level: KeyPointLevel; text: string; rationale?: string }> = []
  const fallbackSection = outline[0]?.id ?? 's1'
  const lines = markdown.split('\n')
  for (const line of lines) {
    const tagged = /^\s*(?:[-*+]|\d+[.)])\s*[【\[]?(高|中|低|high|medium|low)[】\]]?[:：\s-]*(.+)$/.exec(line)
    if (tagged) {
      result.push({ sectionId: fallbackSection, level: normalizeLevel(tagged[1]), text: tagged[2].trim().slice(0, 140) })
    }
  }
  if (result.length) return result
  const bold = /(?:\*\*|__)([^*_]{6,60})(?:\*\*|__)/g
  let match: RegExpExecArray | null
  while ((match = bold.exec(markdown))) {
    result.push({ sectionId: fallbackSection, level: 'medium', text: match[1].trim() })
    if (result.length >= 12) break
  }
  return result
}
