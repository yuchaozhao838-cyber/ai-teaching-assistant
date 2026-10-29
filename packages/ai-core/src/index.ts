import { AIError, isCanceled } from './errors'
import { extractMessageContent, parseSSELine } from './sse'

export { AIError, isCanceled } from './errors'
export type { AIErrorCode } from './errors'
export { parseSSELine, extractMessageContent } from './sse'

export type ChatRole = 'system' | 'user' | 'assistant'

/** 多模态内容块：文本 + 图片（data URL 或公网地址），用于视觉模型识别 PDF 页面 */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }

export interface ChatMessage {
  role: ChatRole
  content: string | ChatContentPart[]
}

export interface ChatOptions {
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  /** 要求供应商返回 JSON 对象（OpenAI response_format） */
  json?: boolean
  signal?: AbortSignal
  /** 传入即启用流式，收到增量时回调 */
  onDelta?: (chunk: string, full: string) => void
  timeoutMs?: number
}

export interface AIClientConfig {
  providerId: string
  providerName: string
  baseUrl: string
  model: string
  apiKey: string
  temperature?: number
}

export interface AIClient {
  config: AIClientConfig
  endpoint: string
  chat(options: ChatOptions): Promise<string>
}

export const DEFAULT_TIMEOUT_MS = 150_000
const STREAM_IDLE_TIMEOUT_MS = 90_000
const MAX_ATTEMPTS = 3

export function resolveEndpoint(baseUrl: string): string {
  const base = (baseUrl ?? '').trim().replace(/\/+$/, '')
  if (!base) throw new AIError('Base URL 为空', 'config')
  if (/\/chat\/completions$/.test(base)) return base
  return `${base}/chat/completions`
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 220 ? `${flat.slice(0, 220)}…` : flat
}

function mapHttpError(status: number, bodyText: string, provider: string): AIError {
  const detail = snippet(bodyText)
  if (status === 401 || status === 403) {
    return new AIError(`HTTP ${status}，请检查密钥。${detail}`, 'auth', { status, provider })
  }
  if (status === 429) {
    return new AIError(`HTTP 429 ${detail}`, 'rate', { status, provider, retryable: true })
  }
  if (status >= 500) {
    return new AIError(`HTTP ${status} ${detail}`, 'server', { status, provider, retryable: true })
  }
  if (status === 404) {
    return new AIError(`HTTP 404，接口地址或模型名可能不对。${detail}`, 'config', { status, provider })
  }
  return new AIError(`HTTP ${status} ${detail}`, 'badresponse', { status, provider })
}

function wrapNetworkError(error: unknown, provider: string): AIError {
  const err = error as Error & { cause?: { code?: string; message?: string } }
  const cause = err?.cause?.code ?? err?.cause?.message ?? ''
  const detail = cause || err?.message || 'unknown'
  return new AIError(detail, 'network', { provider, retryable: true })
}

export function createAIClient(config: AIClientConfig): AIClient {
  const provider = config.providerName || config.providerId || 'model'
  const endpoint = resolveEndpoint(config.baseUrl)

  const runOnce = async (options: ChatOptions, markEmitted: () => void): Promise<string> => {
    if (!config.apiKey) throw new AIError('未配置 API Key', 'config', { provider })
    if (!config.model) throw new AIError('未配置模型名称', 'config', { provider })

    const streaming = typeof options.onDelta === 'function'
    const controller = new AbortController()
    let userCanceled = false
    let timedOut = false

    const onAbort = () => {
      userCanceled = true
      controller.abort()
    }
    if (options.signal) {
      if (options.signal.aborted) {
        throw new AIError('已取消', 'canceled', { provider })
      }
      options.signal.addEventListener('abort', onAbort, { once: true })
    }

    let timer: NodeJS.Timeout | undefined
    const scheduleTimeout = (ms: number) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, ms)
    }
    scheduleTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

    const body: Record<string, unknown> = {
      model: config.model,
      messages: options.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: streaming,
      temperature: options.temperature ?? config.temperature ?? 0.6
    }
    if (options.maxTokens) body.max_tokens = options.maxTokens
    if (options.json) body.response_format = { type: 'json_object' }

    try {
      let res: Response
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
            Accept: streaming ? 'text/event-stream' : 'application/json'
          },
          body: JSON.stringify(body),
          signal: controller.signal
        })
      } catch (error) {
        if (userCanceled) throw new AIError('已取消', 'canceled', { provider })
        if (timedOut) throw new AIError('请求超时', 'timeout', { provider })
        throw wrapNetworkError(error, provider)
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw mapHttpError(res.status, text, provider)
      }

      if (!streaming) {
        const text = await res.text()
        let json: any
        try {
          json = JSON.parse(text)
        } catch {
          throw new AIError(`响应不是合法 JSON：${snippet(text)}`, 'badresponse', { provider })
        }
        if (json?.error) {
          throw new AIError(snippet(typeof json.error === 'string' ? json.error : JSON.stringify(json.error)), 'badresponse', {
            provider
          })
        }
        return extractMessageContent(json)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new AIError('响应没有可读的流', 'badresponse', { provider })

      const decoder = new TextDecoder()
      let buffer = ''
      let full = ''
      let done = false
      scheduleTimeout(STREAM_IDLE_TIMEOUT_MS)

      while (!done) {
        let chunk: ReadableStreamReadResult<Uint8Array>
        try {
          chunk = await reader.read()
        } catch (error) {
          if (userCanceled) throw new AIError('已取消', 'canceled', { provider })
          if (timedOut) throw new AIError('流式响应超时', 'timeout', { provider })
          throw wrapNetworkError(error, provider)
        }
        if (chunk.done) break
        scheduleTimeout(STREAM_IDLE_TIMEOUT_MS)
        buffer += decoder.decode(chunk.value, { stream: true })

        let lineBreak = buffer.indexOf('\n')
        while (lineBreak >= 0) {
          const line = buffer.slice(0, lineBreak)
          buffer = buffer.slice(lineBreak + 1)
          const parsed = parseSSELine(line)
          if (parsed) {
            if (parsed.delta) {
              full += parsed.delta
              markEmitted()
              options.onDelta!(parsed.delta, full)
            }
            if (parsed.done) done = true
          }
          lineBreak = buffer.indexOf('\n')
        }
      }

      if (buffer.trim()) {
        const parsed = parseSSELine(buffer)
        if (parsed?.delta) {
          full += parsed.delta
          options.onDelta!(parsed.delta, full)
        }
      }

      if (!full.trim()) {
        // 少数供应商在 stream=true 时仍返回整段 JSON
        throw new AIError('模型没有返回任何内容', 'badresponse', { provider })
      }
      return full
    } catch (error) {
      if (error instanceof AIError) throw error
      if (userCanceled) throw new AIError('已取消', 'canceled', { provider })
      if (timedOut) throw new AIError('请求超时', 'timeout', { provider })
      throw wrapNetworkError(error, provider)
    } finally {
      if (timer) clearTimeout(timer)
      if (options.signal) options.signal.removeEventListener('abort', onAbort)
    }
  }

  const chat = async (options: ChatOptions): Promise<string> => {
    let attempt = 0
    let emitted = false
    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt += 1
      try {
        return await runOnce(options, () => {
          emitted = true
        })
      } catch (error) {
        const aiError = error instanceof AIError ? error : wrapNetworkError(error, provider)
        if (isCanceled(aiError)) throw aiError
        // 已经吐出部分内容时不重试，避免前端看到重复段落
        if (!aiError.retryable || attempt >= MAX_ATTEMPTS || emitted) throw aiError
        await delay(Math.min(6000, 700 * 2 ** (attempt - 1)) + Math.round(Math.random() * 400))
      }
    }
  }

  return { config, endpoint, chat }
}

export interface TestConnectionResult {
  ok: boolean
  message: string
  latencyMs?: number
}

export async function testConnection(config: AIClientConfig): Promise<TestConnectionResult> {
  const started = Date.now()
  try {
    const client = createAIClient({ ...config, temperature: 0 })
    const reply = await client.chat({
      messages: [{ role: 'user', content: '只回复两个字：正常' }],
      maxTokens: 16,
      timeoutMs: 40_000
    })
    return {
      ok: true,
      latencyMs: Date.now() - started,
      message: `连接成功（${Date.now() - started}ms）：${reply.trim().slice(0, 40) || '（空回复）'}`
    }
  } catch (error) {
    const aiError = error instanceof AIError ? error : new AIError((error as Error).message, 'network')
    return { ok: false, message: aiError.friendly, latencyMs: Date.now() - started }
  }
}
