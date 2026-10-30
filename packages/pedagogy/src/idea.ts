import type { ChatMessage } from '@tutor/ai-core'
import type { IdeaPolishMode } from '@tutor/shared'

/**
 * 灵感笔记的 AI 处理：
 * - polish：润色成通顺表达（保留原意，不新增事实）
 * - outline：整理成要点清单
 * - title：起 3 个标题候选
 */
export function buildIdeaMessages(input: { text: string; mode: IdeaPolishMode; title?: string }): ChatMessage[] {
  const text = String(input.text ?? '').trim()
  const base =
    input.mode === 'outline'
      ? `把下面这段随手记录整理成「要点清单」：
- 用「- 」开头，每条一句，最多 8 条；
- 只保留原文里出现的信息，不要补充、不要评价；
- 如果原文很零碎，可以合并同类项，但不能改变意思。`
      : input.mode === 'title'
        ? `给下面这段记录起 3 个简洁的标题（每个不超过 16 字），每行一个，不要编号、不要解释。`
        : `把下面这段随手记录润色成通顺、简洁的中文：
- 保留原意与全部事实，不新增内容、不删关键信息；
- 修正口语、重复与语病，分段清晰；
- 如果原文里有公式，用 LaTeX（$...$）保留。`

  return [
    { role: 'system', content: '你是一个中文写作助手，只做改写，不编造。直接输出结果，不要前言后语。' },
    {
      role: 'user',
      content: `${base}

${input.title ? `【标题】${input.title}\n` : ''}【原文】
${text.slice(0, 6000)}`
    }
  ]
}
