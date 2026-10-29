export interface SSEChunkResult {
  delta: string
  done: boolean
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
}

/** 解析 OpenAI 兼容的流式响应中的一行 */
export function parseSSELine(line: string): SSEChunkResult | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith(':')) return null
  if (!trimmed.startsWith('data:')) return null
  const payload = trimmed.slice(5).trim()
  if (!payload) return null
  if (payload === '[DONE]') return { delta: '', done: true }
  try {
    const json = JSON.parse(payload)
    const choice = json.choices?.[0]
    const delta =
      choice?.delta?.content ??
      choice?.delta?.reasoning_content ??
      choice?.message?.content ??
      choice?.text ??
      ''
    return { delta: typeof delta === 'string' ? delta : '', done: Boolean(choice?.finish_reason), usage: json.usage }
  } catch {
    return null
  }
}

/** 从非流式响应体里取出正文 */
export function extractMessageContent(json: any): string {
  const choice = json?.choices?.[0]
  const content = choice?.message?.content ?? choice?.delta?.content ?? choice?.text ?? ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === 'string' ? part : part?.text ?? ''))
      .join('')
  }
  return ''
}
