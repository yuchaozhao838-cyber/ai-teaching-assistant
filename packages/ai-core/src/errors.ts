export type AIErrorCode =
  | 'config'
  | 'auth'
  | 'network'
  | 'rate'
  | 'server'
  | 'timeout'
  | 'canceled'
  | 'badresponse'
  | 'unsupported'

export class AIError extends Error {
  code: AIErrorCode
  status?: number
  retryable: boolean
  provider: string

  constructor(message: string, code: AIErrorCode, opts: { status?: number; retryable?: boolean; provider?: string } = {}) {
    super(message)
    this.name = 'AIError'
    this.code = code
    this.status = opts.status
    this.provider = opts.provider ?? ''
    this.retryable = opts.retryable ?? ['network', 'rate', 'server', 'timeout'].includes(code)
  }

  get friendly(): string {
    switch (this.code) {
      case 'auth':
        return 'API Key 无效或已过期，请到「设置」里更新密钥'
      case 'config':
        return `模型配置不完整：${this.message}`
      case 'network':
        return `无法连接到模型服务（${this.message}）。请检查网络、代理或 Base URL`
      case 'rate':
        return '请求过于频繁或额度不足，请稍后重试'
      case 'server':
        return `模型服务返回异常（HTTP ${this.status ?? '5xx'}），已自动重试，稍后再试一次`
      case 'timeout':
        return '模型响应超时，请重试或换一个响应更快的模型'
      case 'canceled':
        return '已取消本次生成'
      case 'badresponse':
        return '模型返回内容无法解析（可能会被供应商安全策略拦截）'
      default:
        return this.message
    }
  }
}

export function isCanceled(error: unknown): boolean {
  if (error instanceof AIError) return error.code === 'canceled'
  const err = error as { name?: string; code?: string }
  return err?.name === 'AbortError' || err?.code === 'ABORT_ERR' || err?.code === 'ERR_CANCELED'
}
