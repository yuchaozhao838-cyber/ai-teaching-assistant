import type { DocumentRecord, OutlineNode } from '@tutor/shared'
import { truncate } from '@tutor/content-ingest'

export const PROMPT_VERSION = 'v1.0'

export const SYSTEM_PROMPT = `你是一位大学课程助教，擅长把教材、课件和题目材料拆解成学生能够自学的知识结构。
写作要求：
1. 用中文，语言具体，不写「本文将介绍」这类空话；
2. 紧扣给定材料，不编造材料里没有的数据、人名与结论；材料没讲清楚的地方明确标注「材料未展开」；
3. 数学公式一律用 LaTeX：行内 $...$，独立公式 $$...$$；
4. 面向大学生自学，默认读者具备高中基础，需要时补充必要的数学/专业前提；
5. 讲解要有因果链：是什么 → 为什么 → 怎么用 → 容易错在哪。`

export function buildChunkSummaryMessages(chunkText: string, index: number, total: number) {
  return [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: `下面是一份学习材料的第 ${index + 1}/${total} 部分。请提炼其中的核心知识点，最多 5 条，每条一行，格式：
- 知识点：一句话说明（≤40 字）
只输出这些行，不要前言、不要总结。若这部分是图表/公式说明，也要提炼出它在讲什么。

【材料片段】
${truncate(chunkText, 4000)}`
    }
  ]
}

export function buildOutlineMessages(document: DocumentRecord, material: string, longDoc: boolean) {
  return [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: `【材料标题】${document.title}
【材料规模】约 ${document.plainText.length} 字，${document.blocks.length} 个内容块
【材料内容${longDoc ? '（长文档：以下为各分块摘要）' : ''}】
${material}

任务：为这份材料设计一份「知识点讲解大纲」，把它拆成 5-8 个依次递进的知识点。
要求：
- 每个知识点都必须能在材料中找到对应内容，不要引入材料外的主题；
- 顺序遵循认知规律：概念定义 → 条件与性质 → 公式与推导 → 应用与例题 → 易错点；
- title 为 8-20 字的名词性短语，summary 一句话（≤40 字）说明这一节要解决什么问题；
- hint 写出这一节最容易被误解的一点（≤40 字，没有就省略）。

只输出 JSON，不要代码块、不要任何多余文字：
{"outline":[{"title":"...","summary":"...","hint":"..."}]}`
    }
  ]
}

export function buildSectionMessages(input: {
  document: DocumentRecord
  outline: OutlineNode[]
  node: OutlineNode
  index: number
  excerpt: string
}) {
  const outlineText = input.outline.map((n, i) => `${i + 1}. ${n.title}：${n.summary}`).join('\n')
  return [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: `【材料标题】${input.document.title}
【本节的定位】第 ${input.index + 1}/${input.outline.length} 节《${input.node.title}》
【本节目标】${input.node.summary || '把这一知识点讲清楚'}
${input.node.hint ? `【易错提示】${input.node.hint}` : ''}
【全篇大纲】
${outlineText}

【材料中与本节相关的原文】
${truncate(input.excerpt, 3800)}

请为这一节写一份可直接阅读的讲解，Markdown 格式，400-700 字：
1. 开头 1-2 句话给出核心结论或定义，再解释「为什么是这样」；
2. 涉及公式时写出 LaTeX，并逐个解释符号含义；
3. 给一个具体例子或类比，帮助建立直觉；
4. 用「> ⚠ 易错点：…」指出一个学生常见错误；
5. 结尾一句话总结本节（可为空）。
不要重复大纲原句，不要写「本节将介绍」「综上所述」这类空话。`
    }
  ]
}

export function buildKeyPointMessages(input: {
  document: DocumentRecord
  outline: OutlineNode[]
  explanations: { sectionId: string; markdown: string }[]
}) {
  const ids = input.outline.map((n) => `${n.id}=${n.title}`).join('，')
  const body = input.explanations
    .map((e) => {
      const node = input.outline.find((n) => n.id === e.sectionId)
      return `【${e.sectionId}｜${node?.title ?? ''}】\n${truncate(e.markdown, 700)}`
    })
    .join('\n\n')

  return [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: `【材料标题】${input.document.title}
【大纲与 id】${ids}
【各节讲解（节选）】
${truncate(body, 9000)}

任务：为这份材料划重点。
要求：
- 每节 1-3 条，全篇 8-16 条；
- level 只能取 high / medium / low：high=必须掌握、考试高频；medium=理解即可；low=了解即可；
- text ≤ 60 字，必须是可独立成立的结论、公式或判断，不能是「掌握本节内容」这种空话；
- sectionId 必须严格取自上面列出的 id（例如 s1、s2）；
- rationale 说明为什么重要（≤40 字）。

只输出 JSON，不要代码块、不要多余文字：
{"keyPoints":[{"sectionId":"s1","level":"high","text":"...","rationale":"..."}]}`
    }
  ]
}

export function buildRepairMessages(badOutput: string, error: string) {
  return [
    {
      role: 'assistant' as const,
      content: truncate(badOutput, 1200)
    },
    {
      role: 'user' as const,
      content: `上一次的输出不是合法 JSON 或缺少必需字段（${error}）。请严格只输出合法 JSON 对象，不要 markdown 代码块，不要任何解释文字。字段必须完整。`
    }
  ]
}
