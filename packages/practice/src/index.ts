import { z } from 'zod'
import type { AIClient, ChatMessage } from '@tutor/ai-core'
import type { ProblemDifficulty, ProblemItem, ProblemType } from '@tutor/shared'
import { SYSTEM_PROMPT, extractJson } from '@tutor/pedagogy'
import { truncate } from '@tutor/content-ingest'

export { buildMaterialContext } from './material'
export type { MaterialContext } from './material'

export const PROBLEM_TYPES: Array<{ value: ProblemType; label: string }> = [
  { value: 'choice', label: '选择题' },
  { value: 'fill', label: '填空题' },
  { value: 'calc', label: '计算题' },
  { value: 'proof', label: '证明题' },
  { value: 'short', label: '简答题' }
]

export const DIFFICULTY_LABEL: Record<ProblemDifficulty, string> = {
  easy: '基础',
  medium: '中等',
  hard: '进阶'
}

const problemSchema = z.object({
  problems: z
    .array(
      z.object({
        type: z.string().optional(),
        difficulty: z.string().optional(),
        stem: z.string().min(1),
        options: z.array(z.string()).optional(),
        answer: z.string().optional(),
        explanation: z.string().optional(),
        sectionTitle: z.string().optional(),
        /** 材料里的原句依据，用来防"出题跑题" */
        sourceQuote: z.string().optional()
      })
    )
    .min(1)
    .max(30)
})

function normalizeType(raw: unknown): ProblemType {
  const value = String(raw ?? '').toLowerCase()
  if (/choice|选择|单选/.test(value)) return 'choice'
  if (/fill|填空/.test(value)) return 'fill'
  if (/proof|证明/.test(value)) return 'proof'
  if (/short|简答|问答/.test(value)) return 'short'
  return 'calc'
}

function normalizeDifficulty(raw: unknown): ProblemDifficulty {
  const value = String(raw ?? '').toLowerCase()
  if (/easy|基础|简单|易/.test(value)) return 'easy'
  if (/hard|进阶|难/.test(value)) return 'hard'
  return 'medium'
}

export function normalizeProblems(raw: unknown): Array<Omit<ProblemItem, 'id'>> {
  const parsed = problemSchema.parse(raw)
  return parsed.problems.map((item) => {
    const type = normalizeType(item.type)
    const options = (item.options ?? []).map((option) => String(option).trim()).filter(Boolean)
    return {
      type,
      difficulty: normalizeDifficulty(item.difficulty),
      stem: item.stem.trim(),
      options: type === 'choice' ? options.slice(0, 6) : [],
      answer: (item.answer ?? '').trim() || '（模型未给出答案，请手动补充）',
      explanation: (item.explanation ?? '').trim() || '（模型未给出解析，可点「编辑」补充）',
      sectionTitle: item.sectionTitle?.trim() || undefined,
      origin: 'ai' as const,
      sourceQuote: item.sourceQuote?.trim() || undefined
    }
  })
}

/* --------------------------- 防跑题：引用校验 --------------------------- */

function normalizeForMatch(text: string): string {
  return String(text ?? '')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .toLowerCase()
}

/**
 * 题目是否"贴着材料"：它给的原句必须能在材料里找到（允许去掉标点空白后匹配，
 * 也允许只匹配前 24 个字符，防止模型多打了几个字就判定失败）。
 */
export function isGrounded(sourceQuote: string | undefined, materialNormalized: string): boolean {
  const quote = normalizeForMatch(sourceQuote ?? '')
  if (quote.length < 6) return false
  if (materialNormalized.includes(quote)) return true
  const head = quote.slice(0, Math.min(24, quote.length))
  return head.length >= 8 && materialNormalized.includes(head)
}

export interface GenerateProblemsInput {
  mode: 'create' | 'extract'
  /** 材料节选（来自 buildMaterialContext） */
  material: string
  /** 可考查的知识点清单 */
  sections: string[]
  count: number
  difficulty: 'mixed' | ProblemDifficulty
  types: ProblemType[]
  client: AIClient
  signal?: AbortSignal
  /** 主题模式没有材料，不做引用校验 */
  checkGrounding?: boolean
}

const DIFFICULTY_TEXT: Record<string, string> = {
  mixed: '混合（基础 / 中等 / 进阶各占一部分）',
  easy: '基础（概念辨析、直接套公式）',
  medium: '中等（需要两三步推理或计算）',
  hard: '进阶（综合应用、需要构造或分类讨论）'
}

function buildMessages(input: GenerateProblemsInput, strict = false): ChatMessage[] {
  const types = input.types.length
    ? input.types.map((t) => PROBLEM_TYPES.find((x) => x.value === t)?.label ?? t).join('、')
    : '不限'
  const sectionList = input.sections.length
    ? input.sections.map((title, index) => `${index + 1}. ${title}`).join('\n')
    : '（材料没有明显标题，请依据下面的节选内容自己归纳 3-6 个知识点）'

  const taskText =
    input.mode === 'extract'
      ? `下面是学生手上的现成题目材料。请把其中的题目**整理成结构化题目**：原样保留题意，材料里有答案就沿用，没有就自己解出来并补解析。`
      : `请根据学生手上的这份学习材料出 ${input.count} 道习题，用来复习这份材料。`

  const strictNote = strict
    ? `\n\n【重要】上一次生成的问题与材料无关，被判定为跑题。这次请务必：每道题都只能是上面材料里出现过的概念、符号、数据，sourceQuote 必须从材料里**逐字复制**一句话（10-60 字，不要改写、不要加省略号）。拿不准的题目宁可不写。`
    : ''

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `${taskText}

【这份材料的知识点清单】（题目的考点必须从这个清单里选）
${sectionList}

【材料节选】
${truncate(input.material, 9000)}

【题目要求】
- 数量：${input.mode === 'extract' ? '按材料里的实际题数（最多 20 道）' : `${input.count} 道`}
- 难度：${DIFFICULTY_TEXT[input.difficulty] ?? input.difficulty}
- 题型：${types}

【硬性规则】
1. 只能考材料里出现过的知识点与数据；材料没讲的内容**一律不许出题**，也不要出"常识题"或与课程无关的问题；
2. 每道题必须提供 sourceQuote：从上面「材料节选」里**原样复制** 10-60 字（可以是定义、公式、例题的关键句），用于核对题目确实来自材料；
3. 选择题给 4 个选项，answer 只写字母（如 "B"）；其它题型 answer 写最终答案（含单位）；
4. explanation 写 3-6 步解析，公式用 LaTeX（行内 $...$），要说明"为什么这么做"；
5. type 取 choice / fill / calc / proof / short；difficulty 取 easy / medium / hard；
6. sectionTitle 从上面的知识点清单里挑一条原样填写；
7. 材料里没有足够内容出满这么多题时，就少出几道（宁缺毋滥），不要编造。${strictNote}

只输出 JSON，不要代码块、不要多余文字：
{"problems":[{"type":"choice","difficulty":"medium","stem":"...","options":["...","...","...","..."],"answer":"B","explanation":"...","sectionTitle":"...","sourceQuote":"材料原句"}]}`
    }
  ]
}

export interface GenerateProblemsResult {
  items: Array<Omit<ProblemItem, 'id'>>
  warnings: string[]
  /** 被判定跑题剔除的题目描述 */
  dropped: string[]
}

function runValidation(
  items: Array<Omit<ProblemItem, 'id'>>,
  material: string,
  checkGrounding: boolean
): { kept: Array<Omit<ProblemItem, 'id'>>; dropped: string[] } {
  if (!checkGrounding) return { kept: items, dropped: [] }
  const normalized = normalizeForMatch(material)
  const kept: Array<Omit<ProblemItem, 'id'>> = []
  const dropped: string[] = []
  for (const item of items) {
    if (isGrounded(item.sourceQuote, normalized)) kept.push(item)
    else dropped.push(item.stem.slice(0, 40))
  }
  return { kept, dropped }
}

export async function generateProblems(input: GenerateProblemsInput): Promise<GenerateProblemsResult> {
  const warnings: string[] = []
  const checkGrounding = input.checkGrounding ?? Boolean(input.material)
  const call = (extra: ChatMessage[] = [], strict = false) =>
    input.client.chat({
      messages: [...buildMessages(input, strict), ...extra],
      temperature: 0.2,
      maxTokens: 4000,
      timeoutMs: 240_000,
      json: true,
      signal: input.signal
    })

  const attempt = async (strict: boolean): Promise<GenerateProblemsResult> => {
    const raw = await call([], strict)
    let items: Array<Omit<ProblemItem, 'id'>>
    try {
      items = normalizeProblems(extractJson(raw))
    } catch (error) {
      warnings.push(`模型输出不是合法 JSON（${(error as Error).message}），已带修正提示重试`)
      const fixed = await call(
        [
          { role: 'assistant', content: truncate(raw, 1200) },
          {
            role: 'user',
            content: '上一次输出不是合法 JSON 或字段缺失。请严格只输出 {"problems":[...]}，不要代码块、不要解释。'
          }
        ],
        strict
      )
      items = normalizeProblems(extractJson(fixed))
    }
    const { kept, dropped } = runValidation(items, input.material, checkGrounding)
    return { items: kept, warnings, dropped }
  }

  const first = await attempt(false)
  if (first.items.length > 0) {
    if (first.dropped.length) {
      warnings.push(`有 ${first.dropped.length} 道题找不到材料里的原句依据，已剔除（防止出成和课程无关的题）`)
    }
    return first
  }

  if (!checkGrounding) {
    throw new Error('模型没有产出可用的题目，请换个材料或再试一次')
  }

  // 全部跑题 → 用更严格的提示重来一次
  const second = await attempt(true)
  if (second.items.length === 0) {
    throw new Error(
      '这次生成的题目和材料对不上（原句校验全部失败），已中止以免给你一堆跑题的题。\n' +
        '常见原因：材料是扫描件/图片、材料文字太少、或者内容主要是代码。\n' +
        '建议：换一份文字版材料，或先用「PDF 识图导入」把 PDF 转成文字再出题。'
    )
  }
  warnings.push('第一次生成的题目与材料无关，已按更严格的要求重新生成')
  if (second.dropped.length) {
    warnings.push(`重试后仍剔除了 ${second.dropped.length} 道找不到依据的题`)
  }
  return second
}
