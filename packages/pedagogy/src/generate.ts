import type {
  DocumentRecord,
  ExplanationSection,
  KeyPoint,
  LessonArtifact,
  LessonPhase,
  OutlineNode
} from '@tutor/shared'
import type { AIClient } from '@tutor/ai-core'
import { AIError, isCanceled } from '@tutor/ai-core'
import { chunkBlocks, excerptForSection, truncate } from '@tutor/content-ingest'
import { PROMPT_VERSION, buildChunkSummaryMessages, buildKeyPointMessages, buildOutlineMessages, buildRepairMessages, buildSectionMessages } from './prompts'
import { extractJson, keyPointsFromMarkdown, normalizeKeyPoints, normalizeOutline } from './schema'

export interface LessonProgress {
  phase: LessonPhase
  message: string
  current?: number
  total?: number
  title?: string
}

export interface LessonCallbacks {
  onProgress: (progress: LessonProgress) => void
  onOutline: (outline: OutlineNode[]) => void
  onDelta: (sectionId: string, chunk: string) => void
  onSection: (section: ExplanationSection) => void
  onKeyPoints: (keyPoints: KeyPoint[]) => void
  onLog?: (message: string) => void
}

export interface GenerateLessonInput {
  document: DocumentRecord
  artifact: LessonArtifact
  client: AIClient
  callbacks: LessonCallbacks
  signal?: AbortSignal
  useChunkSummary?: boolean
  maxSections?: number
}

const CHUNK_SUMMARY_LIMIT = 8
const LONG_DOC_THRESHOLD = 12_000

function ensureNotCanceled(signal?: AbortSignal) {
  if (signal?.aborted) throw new AIError('已取消', 'canceled')
}

/** 结构化调用：解析失败时带修正提示自动重试一次（对应设计文档错误处理策略） */
async function callStructured(
  client: AIClient,
  messages: ReturnType<typeof buildOutlineMessages>,
  signal?: AbortSignal,
  opts: { maxTokens?: number; temperature?: number } = {}
): Promise<unknown> {
  const base = {
    maxTokens: opts.maxTokens ?? 1800,
    temperature: opts.temperature ?? 0.3,
    timeoutMs: 150_000,
    json: true,
    signal
  }
  const first = await client.chat({ messages, ...base })
  try {
    return extractJson(first)
  } catch (error) {
    const second = await client.chat({
      messages: [...messages, ...buildRepairMessages(first, (error as Error).message)] as typeof messages,
      ...base
    })
    return extractJson(second)
  }
}

/** 大纲兜底：按材料的标题层级 / 段落顺序生成，保证流程能继续 */
export function heuristicOutline(document: DocumentRecord, max = 8): OutlineNode[] {
  const pickHeadings = (maxLevel: number) =>
    document.blocks
      .filter(
        (b) =>
          b.type === 'heading' &&
          (b.level ?? 2) >= 2 &&
          (b.level ?? 2) <= maxLevel &&
          (b.text?.trim().length ?? 0) >= 2 &&
          (b.text?.length ?? 0) <= 40 &&
          b.text?.trim() !== document.title.trim()
      )
      .map((h) => h.text!.trim())

  // 优先用二级/三级标题（一级标题通常是整份材料的标题，不该当作小节）
  let titles = pickHeadings(3).filter((title, index, all) => all.indexOf(title) === index)
  if (titles.length < 3) {
    const deeper = pickHeadings(4)
    if (deeper.length >= 3) titles = deeper
  }

  if (titles.length < 3) {
    const paragraphs = document.blocks.filter((b) => (b.text?.length ?? 0) > 20)
    const groupSize = Math.max(1, Math.ceil(paragraphs.length / 4))
    const derived: string[] = []
    for (let i = 0; i < paragraphs.length; i += groupSize) {
      const text = paragraphs[i]?.text ?? ''
      const sentence = text.split(/[。；;：:\n]/)[0]?.trim() ?? ''
      derived.push(sentence.slice(0, 20) || `第 ${derived.length + 1} 部分`)
    }
    titles = derived
  }

  if (!titles.length) titles = ['全文概览']
  return titles.slice(0, max).map((title, index) => ({
    id: `s${index + 1}`,
    title,
    summary: '',
    children: []
  }))
}

export async function generateLesson(input: GenerateLessonInput): Promise<LessonArtifact> {
  const startedAt = Date.now()
  const { document, artifact, client, callbacks } = input
  const warnings: string[] = []
  const explainFailures: string[] = []

  callbacks.onProgress({ phase: 'prepare', message: '整理材料与提示词…' })

  // ---- 1. 长文档：分块 → 提炼摘要（对应「分块 + 映射归并」） ----
  let material = truncate(document.plainText, 12_000)
  const longDoc = document.plainText.length > LONG_DOC_THRESHOLD
  if (longDoc && input.useChunkSummary !== false) {
    const chunks = chunkBlocks(document.blocks, 3600).slice(0, CHUNK_SUMMARY_LIMIT)
    callbacks.onProgress({
      phase: 'chunking',
      message: `长文档分块：共 ${chunks.length} 块，先逐块提炼要点…`,
      current: 0,
      total: chunks.length
    })
    const summaries: string[] = []
    for (let i = 0; i < chunks.length; i += 1) {
      ensureNotCanceled(input.signal)
      try {
        const text = await client.chat({
          messages: buildChunkSummaryMessages(chunks[i].text, i, chunks.length),
          maxTokens: 600,
          temperature: 0.2,
          timeoutMs: 90_000,
          signal: input.signal
        })
        if (text.trim()) summaries.push(`【分块 ${i + 1}】\n${text.trim()}`)
      } catch (error) {
        if (isCanceled(error)) throw error
        warnings.push(`第 ${i + 1} 块摘要失败，已跳过`)
      }
      callbacks.onProgress({
        phase: 'chunking',
        message: `已提炼 ${i + 1}/${chunks.length} 块`,
        current: i + 1,
        total: chunks.length
      })
    }
    if (summaries.length) material = summaries.join('\n\n')
  }

  // ---- 2. 大纲 ----
  callbacks.onProgress({ phase: 'outline', message: '生成知识点大纲…' })
  let outline: OutlineNode[] = []
  try {
    const raw = await callStructured(client, buildOutlineMessages(document, material, longDoc), input.signal, {
      maxTokens: 1400
    })
    outline = normalizeOutline(raw)
  } catch (error) {
    if (isCanceled(error)) throw error
    warnings.push('大纲结构化输出失败，已按材料原有标题结构降级生成')
    outline = heuristicOutline(document)
  }

  outline = outline.slice(0, input.maxSections ?? 9)
  artifact.outline = outline
  callbacks.onOutline(outline)
  callbacks.onLog?.(`大纲包含 ${outline.length} 个知识点`)

  // ---- 3. 逐节详解（流式） ----
  const explanations: ExplanationSection[] = []
  callbacks.onProgress({ phase: 'explain', message: '逐节生成详解…', current: 0, total: outline.length })

  for (let i = 0; i < outline.length; i += 1) {
    ensureNotCanceled(input.signal)
    const node = outline[i]
    callbacks.onProgress({
      phase: 'explain',
      message: `正在讲解：${node.title}`,
      current: i,
      total: outline.length,
      title: node.title
    })

    const excerpt = excerptForSection(document.blocks, node.title, 3800)
    let markdown = ''
    try {
      markdown = await client.chat({
        messages: buildSectionMessages({ document, outline, node, index: i, excerpt }),
        temperature: 0.7,
        maxTokens: 2200,
        timeoutMs: 180_000,
        signal: input.signal,
        onDelta: (chunk) => callbacks.onDelta(node.id, chunk)
      })
    } catch (error) {
      if (isCanceled(error)) throw error
      const reason = error instanceof AIError ? error.friendly : (error as Error).message
      warnings.push(`《${node.title}》生成失败：${reason}`)
      explainFailures.push(node.id)
      markdown = `> ⚠ 这一节生成失败：${reason}\n>\n> 可以点击顶部「重新生成」或本节右上角的「重生成」再试一次。`
    }

    const section: ExplanationSection = {
      sectionId: node.id,
      markdown: markdown.trim(),
      updatedAt: Date.now(),
      model: client.config.model
    }
    explanations.push(section)
    callbacks.onSection(section)
    callbacks.onProgress({
      phase: 'explain',
      message: `已完成：${node.title}`,
      current: i + 1,
      total: outline.length
    })
  }

  // ---- 4. 重点划分（高/中/低） ----
  callbacks.onProgress({ phase: 'keypoints', message: '划分重点等级…' })
  let keyPoints: KeyPoint[] = []
  try {
    const raw = await callStructured(
      client,
      buildKeyPointMessages({
        document,
        outline,
        explanations: explanations.map((e) => ({ sectionId: e.sectionId, markdown: e.markdown }))
      }),
      input.signal,
      { maxTokens: 1800, temperature: 0.2 }
    )
    keyPoints = normalizeKeyPoints(raw, outline).map((kp, index) => ({ id: `k${index + 1}`, ...kp }))
  } catch (error) {
    if (isCanceled(error)) throw error
    warnings.push('重点划分结构化输出失败，已从详解正文中自动抽取重点')
    const fallback = keyPointsFromMarkdown(
      explanations.map((e) => e.markdown).join('\n\n'),
      outline
    )
    keyPoints = fallback.map((kp, index) => ({ id: `k${index + 1}`, ...kp }))
  }
  callbacks.onKeyPoints(keyPoints)

  // ---- 5. 收尾 ----
  const allFailed = explanations.length > 0 && explainFailures.length === explanations.length
  const status: LessonArtifact['status'] = allFailed ? 'failed' : warnings.length ? 'partial' : 'done'
  const result: LessonArtifact = {
    ...artifact,
    promptVersion: PROMPT_VERSION,
    outline,
    explanations,
    keyPoints,
    warnings,
    status,
    updatedAt: Date.now(),
    error: allFailed ? '所有小节都生成失败，请检查模型配置或稍后重试' : undefined,
    stats: {
      sections: outline.length,
      chars: explanations.reduce((acc, e) => acc + e.markdown.length, 0),
      elapsedMs: Date.now() - startedAt,
      mocked: false
    }
  }
  callbacks.onProgress({
    phase: 'done',
    message: `讲解完成：${outline.length} 节 · ${Math.round((Date.now() - startedAt) / 1000)}s`
  })
  return result
}

export { PROMPT_VERSION }
