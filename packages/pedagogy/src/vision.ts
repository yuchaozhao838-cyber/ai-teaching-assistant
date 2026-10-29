import type { ChatMessage } from '@tutor/ai-core'
import { SYSTEM_PROMPT } from './prompts'

/**
 * 让视觉模型把「PDF 页面截图」转写成 Markdown + LaTeX。
 * 这条路能救回纯文本提取丢失的公式结构（上下标、分式、根号、积分限、矩阵）。
 */
export function buildPdfPageMessages(dataUrl: string, pageNo: number, total: number): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `这是课件第 ${pageNo}/${total} 页的图片。请把这一页**完整转写**成 Markdown，供后续做知识点讲解。

要求：
1. 标题用 # / ##，列表用 -，表格用 Markdown 表格；
2. 所有数学公式转成 LaTeX：行内 $...$，独立公式 $$...$$；务必写清上下标、分式、根号、积分上下限、矩阵；
3. 图、表、示意图用一行说明它在讲什么（例如「图 3-1：割线趋近切线的示意图」），不要编造细节；
4. 不要总结、不要补充图片里没有的内容；看不清的地方写「（此处模糊）」；
5. 只输出 Markdown 正文，不要任何解释或前后缀。`
        },
        { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
      ]
    }
  ]
}

/** 把逐页转写结果拼成整份材料（保留页码注释，便于对照原文） */
export function pagesToMarkdown(pages: string[]): string {
  return pages
    .map((markdown, index) => `<!-- 第 ${index + 1} 页 -->\n${markdown.trim()}`)
    .join('\n\n---\n\n')
    .trim()
}
