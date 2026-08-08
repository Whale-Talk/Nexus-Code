// Provider 层 app 自有错误类 — 6 类 (4 实 + 2 占位)。
//
// 契约来源: P0-B 全库消费面实测 (.omc/plans/error-contract-map.md)
//   76 instanceof 站点 / 11 构造站点 / message 字符串契约 11 条
//
// 关键约束:
//   - 必须保持与 @anthropic-ai/sdk 错误类相同的 instanceof 身份
//   - messages 文本契约钉死 (compact.ts 字符串匹配依赖)
//   - 构造签名 3 种形态 (位置 4 元组 / 对象参数 / 无参)
//   - .status / .headers / .requestID / .error / .cause 属性面

// ============================================================================
// APIError — 主错误类 (53 instanceof + 52 .status + 75 .message + 3 构造)
// ============================================================================

/** 构造签名 1: new APIError(status, errorBody, message, headers) (rateLimitMocking.ts:52/96/116) */
export class APIError extends Error {
  declare status: number
  declare headers: Headers
  declare requestID: string
  declare error: Record<string, unknown>

  constructor(
    status: number,
    body?: Record<string, unknown>,
    message?: string,
    headers?: Headers,
    requestID?: string,
  ) {
    super(message ?? `API Error (${status})`)
    this.name = 'APIError'
    this.status = status
    this.headers = headers ?? new Headers()
    this.error = body ?? {}
    this.requestID =
      requestID ??
      (this.headers.get('request-id') ?? (body as { request_id?: string })?.request_id ?? '')
  }

  // 允许 message 覆盖 (errors.ts:549-553 对 429 构造后替换 body 与 message)
  setBody(body: Record<string, unknown>): this {
    this.error = body
    return this
  }
}

// ============================================================================
// APIConnectionError — 7 instanceof + .cause/.code (extractConnectionErrorDetails)
// ============================================================================

export class APIConnectionError extends Error {
  declare cause: unknown
  declare code?: string

  constructor(message?: string, cause?: unknown) {
    super(message ?? 'Connection error.')
    this.name = 'APIConnectionError'
    this.cause = cause
    // 从 cause 中提取 Node.js 错误码 (ECONNRESET/EPIPE 判定, withRetry.ts:118)
    if (cause != null && typeof cause === 'object' && 'code' in cause) {
      this.code = (cause as { code?: string }).code
    }
  }
}

// ============================================================================
// APIConnectionTimeoutError — 2 instanceof + 对象参数构造 (claude.ts:2465)
// ============================================================================

export class APIConnectionTimeoutError extends Error {
  constructor(opts: { message: string }) {
    super(opts.message)
    this.name = 'APIConnectionTimeoutError'
  }
}

// ============================================================================
// APIUserAbortError — 12 instanceof + 无参构造 6 处
//   强制: message 必须为 'Request was aborted.' (compact.ts:295 文本匹配 + 5 消费点)
// ============================================================================

export class APIUserAbortError extends Error {
  constructor() {
    super('Request was aborted.')
    this.name = 'APIUserAbortError'
  }
}

// ============================================================================
// AuthenticationError — 1 instanceof (validateModel.ts:100)
//   占位但必须可抛出、可 instanceof
// ============================================================================

export class AuthenticationError extends Error {
  constructor(message?: string) {
    super(message ?? 'Authentication error')
    this.name = 'AuthenticationError'
  }
}

// ============================================================================
// NotFoundError — 1 instanceof (validateModel.ts:89)
//   validateModel.ts:117-128 消费 error.error.type === 'not_found_error' + message 字段
//   占位但必须可抛出、可 instanceof + .error body 可读写
// ============================================================================

export class NotFoundError extends Error {
  declare error: Record<string, unknown>

  constructor(message?: string, body?: Record<string, unknown>) {
    super(message ?? 'Not found')
    this.name = 'NotFoundError'
    this.error = body ?? {}
  }
}
