import type { DocumentRecord, ExplanationSection, KeyPoint, LessonArtifact, OutlineNode } from '@tutor/shared'
import { excerptForSection } from '@tutor/content-ingest'
import { heuristicOutline, type LessonCallbacks } from './generate'

const DEMO_NOTE =
  '> 演示模式：本节由本地规则生成（原文摘录 + 结构提示），用于体验完整流程。在「设置」中接入 DeepSeek / 通义千问等模型后，即可得到真正的 AI 讲解。'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function pickSentences(text: string, limit = 6, maxLen = 90): string[] {
  return text
    .split(/(?<=[。！？!?；;])|\n/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8)
    .slice(0, limit)
    .map((s) => (s.length > maxLen ? `${s.slice(0, maxLen)}…` : s))
}

function buildDemoMarkdown(node: OutlineNode, excerpt: string, index: number, total: number): string {
  const sentences = pickSentences(excerpt)
  const bullets = sentences.length
    ? sentences.map((s) => `- ${s}`).join('\n')
    : '- 材料中这一部分的文字较少，接入真实模型后可由模型补充说明。'

  return `${DEMO_NOTE}

### ${node.title}

**这一节在整份材料中的位置**：第 ${index + 1}/${total} 节${node.summary ? `，目标是「${node.summary}」` : ''}。

**材料原文要点**

${bullets}

**怎么把这段读懂**

1. 先找出这段在定义什么对象、成立需要什么条件；
2. 再看它给出的结论或公式，逐个确认符号含义；
3. 最后自己举一个最小例子，把条件代入验证一遍。

> ⚠ 易错点：演示模式不判断内容对错，也缺少具体例题；请以教材与老师的讲解为准。
`
}

function buildDemoKeyPoints(outline: OutlineNode[], explanations: ExplanationSection[], document: DocumentRecord): KeyPoint[] {
  const levelWords = /(定义|定理|公式|性质|条件|必须|注意|结论|证明|推导|法则)/
  const result: KeyPoint[] = []
  for (const node of outline) {
    const explanation = explanations.find((e) => e.sectionId === node.id)?.markdown ?? ''
    const sentences = pickSentences(explanation, 4, 60).filter((s) => !s.startsWith('>') && !s.startsWith('**'))
    for (const sentence of sentences.slice(0, 2)) {
      result.push({
        id: `k${result.length + 1}`,
        sectionId: node.id,
        level: levelWords.test(sentence) ? 'high' : 'medium',
        text: sentence.replace(/^[-*]\s*/, '').slice(0, 80),
        rationale: '演示模式自动抽取的原文要点'
      })
      if (result.length >= 12) return result
    }
  }
  if (!result.length && document.blocks[0]?.text) {
    result.push({
      id: 'k1',
      sectionId: outline[0]?.id ?? 's1',
      level: 'medium',
      text: document.blocks[0].text.slice(0, 60),
      rationale: '材料开头的第一句'
    })
  }
  return result
}

/** 本地演示模型：不调用任何网络接口，用于首次体验与离线验收 */
export async function generateMockLesson(input: {
  document: DocumentRecord
  artifact: LessonArtifact
  callbacks: LessonCallbacks
  signal?: AbortSignal
}): Promise<LessonArtifact> {
  const startedAt = Date.now()
  const { document, artifact, callbacks } = input

  callbacks.onProgress({ phase: 'prepare', message: '演示模型：读取材料…' })
  await sleep(180)
  callbacks.onProgress({ phase: 'outline', message: '演示模型：生成知识点大纲…' })
  await sleep(220)

  const outline = heuristicOutline(document, 6)
  artifact.outline = outline
  callbacks.onOutline(outline)

  const explanations: ExplanationSection[] = []
  for (let i = 0; i < outline.length; i += 1) {
    if (input.signal?.aborted) break
    const node = outline[i]
    callbacks.onProgress({
      phase: 'explain',
      message: `演示模型：讲解「${node.title}」`,
      current: i,
      total: outline.length,
      title: node.title
    })
    const markdown = buildDemoMarkdown(node, excerptForSection(document.blocks, node.title, 1200), i, outline.length)
    for (let cursor = 0; cursor < markdown.length; cursor += 26) {
      if (input.signal?.aborted) break
      callbacks.onDelta(node.id, markdown.slice(cursor, cursor + 26))
      await sleep(8)
    }
    const section: ExplanationSection = {
      sectionId: node.id,
      markdown,
      updatedAt: Date.now(),
      model: 'demo-tutor'
    }
    explanations.push(section)
    callbacks.onSection(section)
    callbacks.onProgress({ phase: 'explain', message: `演示模型：已完成「${node.title}」`, current: i + 1, total: outline.length })
  }

  callbacks.onProgress({ phase: 'keypoints', message: '演示模型：划重点…' })
  await sleep(200)
  const keyPoints = buildDemoKeyPoints(outline, explanations, document)
  callbacks.onKeyPoints(keyPoints)

  const result: LessonArtifact = {
    ...artifact,
    outline,
    explanations,
    keyPoints,
    warnings: ['当前使用「本地演示模型」，讲解内容为规则生成，不代表真实教学质量'],
    status: 'partial',
    updatedAt: Date.now(),
    stats: {
      sections: outline.length,
      chars: explanations.reduce((acc, e) => acc + e.markdown.length, 0),
      elapsedMs: Date.now() - startedAt,
      mocked: true
    }
  }
  callbacks.onProgress({ phase: 'done', message: '演示讲解完成' })
  return result
}
