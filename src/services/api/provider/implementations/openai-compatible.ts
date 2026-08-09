// Provider 适配器: OpenAI-compatible 后端 (DeepSeek relay PoC)。
//
// 职责 (P1-B):
//   1. 请求面: Anthropic 形态 ModelRequest → AI SDK prompt
//      (@ai-sdk/openai-compatible 内部再转成 OpenAI chat.completions JSON,
//      /v1/chat/completions 路径)
//   2. 流面: AI SDK fullStream 事件 → Anthropic SSE 形状的 StreamEvent
//      (relay 走 OpenAI 协议, 消费端只认 Anthropic 事件形状)
//   3. 头透传: new-api 会话分组头 X-Conversation-ID / X-Message-ID /
//      X-Parent-Message-ID (模式对齐 client.ts:438-453)
//   4. 错误映射: AI SDK 错误 → provider/errors.ts 的 app 错误类
//
// 已知限制 (PoC):
//   - DeepSeek thinking 无 Anthropic signature — thinking 块 signature 置 ''
//     (与 claude.ts:2035-2036 的初始化一致)
//   - OpenAI 协议无 stop_sequence — message_delta.stop_sequence 恒为 null
//   - request.thinking 不映射 — DeepSeek 推理由模型侧自动开启, 不送
//     reasoning_effort 参数
//   - AI SDK 内部重试关闭 (maxRetries: 0) — 重试语义交给仓库 withRetry
//   - 不直接 import '@anthropic-ai/sdk' — 只消费 provider/types.ts 契约

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { OpenAICompatibleProvider } from '@ai-sdk/openai-compatible'
import {
  APICallError,
  generateText,
  jsonSchema,
  streamText,
  type AsyncIterableStream,
  type FinishReason,
  type JSONSchema7,
  type LanguageModel,
  type LanguageModelUsage,
  type ModelMessage,
  type TextStreamPart,
  type ToolSet,
} from 'ai'
import { randomUUID } from 'crypto'
import type {
  AssistantMessage,
  ContentBlock,
  ModelRequest,
  ProviderAdapter,
  StreamEvent,
  StreamResponse,
  ToolChoice,
  ToolResultContentBlock,
  Usage,
  WithResponse,
} from '../types.js'
import {
  APIConnectionError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  NotFoundError,
} from '../errors.js'

// ============================================================================
// Options / 工厂
// ============================================================================

export interface OpenAICompatibleAdapterOptions {
  /** 后端 base URL — 必须带 /v1 后缀 (如 http://192.168.77.162:8080/v1/) */
  baseURL: string
  /** Relay API key — new-api 会剥 sk- 前缀查库, 原样透传即可 */
  apiKey?: string
  /** 静态附加请求头 (与会话跟踪头合并, 跟踪头优先) */
  headers?: Record<string, string>
  /** AI SDK provider 名 (遥测 / UA) */
  name?: string
  /** 自定义 fetch — 用于接入仓库 fetch override (client.ts 请求 ID 捕获) */
  fetch?: typeof globalThis.fetch
  /** 流式响应是否请求 usage (DeepSeek 默认开启 — 计费/成本追踪依赖) */
  includeUsage?: boolean
}

/**
 * 创建 OpenAI-compatible ProviderAdapter。
 * baseURL 处理: openai-compatible 会拼 `${baseURL}chat/completions`,
 * 若 baseURL 未以 / 结尾则自动补全（Zhipu 的 /api/paas/v4 等也支持）。
 */
export function createOpenAICompatibleAdapter(
  options: OpenAICompatibleAdapterOptions,
): ProviderAdapter {
  const baseURL = options.baseURL.endsWith('/')
    ? options.baseURL
    : options.baseURL + '/'

  const provider = createOpenAICompatible({
    name: options.name ?? 'openai-compatible',
    baseURL,
    ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
    ...(options.headers !== undefined ? { headers: options.headers } : {}),
    ...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
    includeUsage: options.includeUsage ?? true,
  })

  return {
    streamText: (request, signal) =>
      streamRequest(request, provider, signal),
    generateText: (request, signal) =>
      generateRequest(request, provider, signal),
  }
}

/**
 * 注册表友好工厂 (index.ts registerProvider 签名: () => Promise<{ adapter }>)。
 * 环境变量驱动: NEXUS_BASE_URL + NEXUS_AUTH_TOKEN / NEXUS_API_KEY。
 */
export function createOpenAICompatibleProvider(): Promise<{
  adapter: ProviderAdapter
}> {
  const baseURL = process.env.NEXUS_BASE_URL
  const apiKey =
    process.env.NEXUS_AUTH_TOKEN || process.env.NEXUS_API_KEY
  if (!baseURL) {
    return Promise.reject(
      new Error(
        'createOpenAICompatibleProvider: NEXUS_BASE_URL 未设置',
      ),
    )
  }
  return Promise.resolve({
    adapter: createOpenAICompatibleAdapter({ baseURL, apiKey }),
  })
}

// ============================================================================
// 会话跟踪头 — new-api 会话分组 (模式对齐 client.ts:364/438-453)
// ============================================================================

/** 上一条 assistant 消息 id — 作为下一条请求的 X-Parent-Message-ID */
let lastAssistantMessageId = ''

/**
 * 构建会话跟踪头。仅在配置了会话 id 时注入 (与 client.ts 行为一致,
 * 不向直连后端泄漏会话信息)。
 */
function buildTrackingHeaders(): Record<string, string> {
  const conversationId =
    process.env.CLAUDE_CONVERSATION_ID || process.env.X_CONVERSATION_ID
  if (!conversationId) {
    return {}
  }
  const headers: Record<string, string> = {
    'X-Conversation-ID': conversationId,
    'X-Message-ID': randomUUID(),
  }
  if (lastAssistantMessageId) {
    headers['X-Parent-Message-ID'] = lastAssistantMessageId
  }
  return headers
}

// ============================================================================
// 请求面映射 — ModelRequest → AI SDK prompt
// ============================================================================

/** tool_result 内容折叠为纯文本 (OpenAI tool 消息只有字符串 content) */
function toolResultText(block: ToolResultContentBlock): string {
  if (typeof block.content === 'string') {
    return block.content
  }
  return (block.content ?? [])
    .map(part => (part.type === 'text' ? part.text : ''))
    .join('\n')
}

/**
 * Anthropic 消息形态 → AI SDK ModelMessage。
 * 转换规则:
 *   - user text/image → user 消息 (图片用 FilePart, openai-compatible 只认
 *     'text'/'file' part, 弃用的 'image' part 会抛 UnsupportedFunctionalityError)
 *   - tool_result → 独立 role:'tool' 消息 (错误用 'error-text' 输出)
 *   - assistant tool_use → assistant 消息的 tool-call part
 *   - assistant thinking 块仅存在于响应侧 — OpenAI 请求面无对应字段, 丢弃
 */
function toModelMessages(request: ModelRequest): ModelMessage[] {
  const out: ModelMessage[] = []
  for (const msg of request.messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        if (msg.content !== '') {
          out.push({ role: 'user', content: msg.content })
        }
        continue
      }
      const parts: Array<
        | { type: 'text'; text: string }
        | { type: 'file'; mediaType: string; data: { type: 'data'; data: string } | { type: 'url'; url: URL } }
      > = []
      for (const block of msg.content) {
        switch (block.type) {
          case 'text':
            if (block.text !== '') {
              parts.push({ type: 'text', text: block.text })
            }
            break
          case 'image': {
            const source = block.source
            if (source.type === 'base64') {
              parts.push({
                type: 'file',
                mediaType: source.media_type,
                data: { type: 'data', data: source.data },
              })
            } else {
              parts.push({
                type: 'file',
                mediaType: 'image',
                data: { type: 'url', url: new URL(source.url) },
              })
            }
            break
          }
          case 'tool_result':
            // 折叠为独立 tool 消息, 保持与 assistant tool-call 的顺序一致
            out.push({
              role: 'tool',
              content: [
                {
                  type: 'tool-result',
                  toolCallId: block.tool_use_id,
                  toolName: '',
                  output: {
                    type: block.is_error ? 'error-text' : 'text',
                    value: toolResultText(block),
                  },
                },
              ],
            })
            break
        }
      }
      if (parts.length > 0) {
        out.push({ role: 'user', content: parts })
      }
    } else {
      // assistant
      if (typeof msg.content === 'string') {
        out.push({ role: 'assistant', content: msg.content })
        continue
      }
      const parts: Array<
        | { type: 'text'; text: string }
        | { type: 'reasoning'; text: string }
        | {
            type: 'tool-call'
            toolCallId: string
            toolName: string
            input: unknown
          }
      > = []
      for (const block of msg.content) {
        if (block.type === 'text') {
          if (block.text !== '') {
            parts.push({ type: 'text', text: block.text })
          }
          continue
        }
        // 运行时兜底: 请求侧契约 (types.ts ContentBlockParam) 不含
        // tool_use/thinking, 但 transcript 回传 (assistantMessageToMessageParam)
        // 会携带 — tool_use → tool-call part; thinking → reasoning part
        // (DeepSeek 支持 assistant reasoning_content 回传续接思考上下文)
        const extra = block as unknown as
          | { type: 'tool_use'; id: string; name: string; input: unknown }
          | { type: 'thinking'; thinking: string }
        if (extra.type === 'tool_use') {
          parts.push({
            type: 'tool-call',
            toolCallId: extra.id,
            toolName: extra.name,
            input: extra.input,
          })
        } else if (extra.type === 'thinking') {
          parts.push({ type: 'reasoning', text: extra.thinking })
        }
      }
      if (parts.length > 0) {
        out.push({ role: 'assistant', content: parts })
      }
    }
  }
  return out
}

/** Anthropic ToolDefinition → AI SDK ToolSet (无 execute — 工具执行在仓库侧) */
function toToolSet(request: ModelRequest): ToolSet | undefined {
  if (!request.tools || request.tools.length === 0) {
    return undefined
  }
  const set: ToolSet = {}
  for (const t of request.tools) {
    // v7 工具契约字段是 inputSchema (不是 parameters) — ai core 用
    // asSchema(tool.inputSchema) 取 schema, 放错字段会退化成空 schema
    set[t.name] = {
      inputSchema: jsonSchema(t.input_schema as unknown as JSONSchema7),
      ...(t.description !== undefined ? { description: t.description } : {}),
    } as unknown as ToolSet[string]
  }
  return set
}

function toToolChoice(
  toolChoice: ToolChoice | undefined,
):
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'tool'; toolName: string }
  | undefined {
  if (!toolChoice) {
    return undefined
  }
  switch (toolChoice.type) {
    case 'auto':
      return 'auto'
    case 'any':
      return 'required'
    case 'none':
      return 'none'
    case 'tool':
      return { type: 'tool', toolName: toolChoice.name }
  }
}

/** 组装 streamText / generateText 共享的调用参数 */
function buildCallArgs(
  request: ModelRequest,
  model: LanguageModel,
  signal: AbortSignal | undefined,
  onResponse?: (response: Response) => void,
) {
  const tools = toToolSet(request)
  return {
    model,
    messages: toModelMessages(request),
    // system 折叠为单条 (OpenAI 协议无多 system 消息)
    ...(request.system && request.system.length > 0
      ? { system: request.system.map(s => s.text).join('\n\n') }
      : {}),
    ...(request.max_tokens !== undefined
      ? { maxOutputTokens: request.max_tokens }
      : {}),
    ...(request.temperature !== undefined
      ? { temperature: request.temperature }
      : {}),
    ...(request.stop_sequences !== undefined &&
    request.stop_sequences.length > 0
      ? { stopSequences: request.stop_sequences }
      : {}),
    ...(tools !== undefined
      ? {
          tools,
          ...(request.tool_choice !== undefined
            ? { toolChoice: toToolChoice(request.tool_choice) }
            : {}),
        }
      : {}),
    abortSignal: signal,
    // new-api 会话分组头 (每次请求新 X-Message-ID)
    headers: buildTrackingHeaders(),
    // 重试交给仓库 withRetry — 关闭 AI SDK 内部重试避免双重重试
    maxRetries: 0,
    ...(onResponse !== undefined ? { onResponse } : {}),
  }
}

// ============================================================================
// 流面映射 — AI SDK fullStream → Anthropic SSE 形状 StreamEvent
// ============================================================================

/**
 * OpenAI finish_reason → Anthropic stop_reason。
 *   stop → end_turn / length → max_tokens / tool_calls → tool_use
 *   content-filter / error / other → null (Anthropic 无对应语义)
 */
function mapStopReason(finishReason: FinishReason): AssistantMessage['stop_reason'] {
  switch (finishReason) {
    case 'stop':
      return 'end_turn'
    case 'length':
      return 'max_tokens'
    case 'tool-calls':
      return 'tool_use'
    default:
      return null
  }
}

/** AI SDK LanguageModelUsage → provider Usage (缺省字段置 0/null) */
function toUsage(usage: LanguageModelUsage): Usage {
  return {
    input_tokens: usage.inputTokens ?? 0,
    output_tokens: usage.outputTokens ?? 0,
    cache_creation_input_tokens:
      usage.inputTokenDetails?.cacheWriteTokens ?? null,
    cache_read_input_tokens:
      usage.inputTokenDetails?.cacheReadTokens ?? null,
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === 'object' && !Array.isArray(value)
  )
}

/**
 * AI SDK 错误 → provider/errors.ts app 错误类。
 *   - 中止 → APIUserAbortError ('Request was aborted.')
 *   - HTTP 错误 → APIError (401 → AuthenticationError, 404 → NotFoundError)
 *   - 无 statusCode 的网络错误 → APIConnectionError (带 cause 供 .code 提取)
 */
function mapError(error: unknown, signal: AbortSignal | undefined): unknown {
  if (signal?.aborted) {
    return new APIUserAbortError()
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new APIUserAbortError()
  }
  if (APICallError.isInstance(error)) {
    const statusCode = error.statusCode
    if (statusCode !== undefined) {
      let body: Record<string, unknown> | undefined
      if (error.responseBody) {
        try {
          body = JSON.parse(error.responseBody) as Record<string, unknown>
        } catch {
          body = undefined
        }
      }
      if (statusCode === 401) {
        return new AuthenticationError(error.message)
      }
      if (statusCode === 404) {
        return new NotFoundError(error.message, body)
      }
      return new APIError(
        statusCode,
        body,
        error.message,
        new Headers(error.responseHeaders),
      )
    }
    // 无 statusCode — 网络层错误 ("Cannot connect to API: ...")。
    // AI SDK 把底层网络错误 (带 .code, 如 ECONNREFUSED) 包在 APICallError.cause,
    // 传 cause 供 errors.ts 直接提取 .code (withRetry ECONNRESET/EPIPE 判定)
    return new APIConnectionError(error.message, error.cause ?? error)
  }
  return error
}

/**
 * fullStream → StreamEvent 事件迭代器。
 *
 * 事件形状对齐 Anthropic SSE (消费端 claude.ts 的 for-await 只认此形状):
 *   - reasoning-start/delta/end → thinking 块 (content_block_start/delta/stop,
 *     delta 为 thinking_delta; DeepSeek 无 signature, 置 '')
 *   - text-start/delta/end → text 块 (text_delta)
 *   - tool-input-start/delta → tool_use 块 (input_json_delta 累积 JSON 串)
 *   - tool-call → 关闭 tool_use 块; 若流式 JSON 未送达 (非流式参数),
 *     用最终解析对象补一发 input_json_delta
 *   - finish → message_delta (stop_reason/usage) + message_stop
 *   - error/abort → 抛映射后的 app 错误
 *
 * message_start 惰性发射 (首个内容事件前) — HTTP 失败时不会泄漏 message_start。
 */
async function* streamEvents(
  modelId: string,
  fullStream: AsyncIterableStream<TextStreamPart<ToolSet>>,
  controllerSignal: AbortSignal,
  outerSignal: AbortSignal | undefined,
  onOuterAbort: () => void,
): AsyncGenerator<StreamEvent> {
  let messageId: string | null = null
  let nextIndex = 0
  // AI SDK part id → Anthropic content block index (支持多工具调用并行交错)
  const openBlocks = new Map<
    string,
    { index: number; kind: 'text' | 'thinking' | 'tool_use'; args: string }
  >()
  let finishSeen = false
  let stopReason: AssistantMessage['stop_reason'] = null

  const startMessage = (): StreamEvent | null => {
    if (messageId !== null) {
      return null
    }
    messageId = randomUUID()
    lastAssistantMessageId = messageId
    return {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        content: [],
        model: modelId,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    }
  }

  try {
    for await (const part of fullStream) {
      switch (part.type) {
        case 'start':
          break
        case 'error':
          throw mapError(part.error, outerSignal)
        case 'abort':
          throw new APIUserAbortError()
        case 'text-start': {
          const start = startMessage()
          if (start) yield start
          if (!openBlocks.has(part.id)) {
            const index = nextIndex++
            openBlocks.set(part.id, { index, kind: 'text', args: '' })
            yield {
              type: 'content_block_start',
              index,
              content_block: { type: 'text', text: '' },
            }
          }
          break
        }
        case 'text-delta': {
          const start = startMessage()
          if (start) yield start
          let block = openBlocks.get(part.id)
          if (!block) {
            block = { index: nextIndex++, kind: 'text', args: '' }
            openBlocks.set(part.id, block)
            yield {
              type: 'content_block_start',
              index: block.index,
              content_block: { type: 'text', text: '' },
            }
          }
          yield {
            type: 'content_block_delta',
            index: block.index,
            delta: { type: 'text_delta', text: part.text },
          }
          break
        }
        case 'text-end': {
          const block = openBlocks.get(part.id)
          if (block && block.kind === 'text') {
            openBlocks.delete(part.id)
            yield { type: 'content_block_stop', index: block.index }
          }
          break
        }
        case 'reasoning-start': {
          const start = startMessage()
          if (start) yield start
          if (!openBlocks.has(part.id)) {
            const index = nextIndex++
            openBlocks.set(part.id, { index, kind: 'thinking', args: '' })
            yield {
              type: 'content_block_start',
              index,
              content_block: { type: 'thinking', thinking: '', signature: '' },
            }
          }
          break
        }
        case 'reasoning-delta': {
          const start = startMessage()
          if (start) yield start
          let block = openBlocks.get(part.id)
          if (!block) {
            block = { index: nextIndex++, kind: 'thinking', args: '' }
            openBlocks.set(part.id, block)
            yield {
              type: 'content_block_start',
              index: block.index,
              content_block: { type: 'thinking', thinking: '', signature: '' },
            }
          }
          // DeepSeek thinking 无 Anthropic signature — 置 '' 保持字段存在
          yield {
            type: 'content_block_delta',
            index: block.index,
            delta: {
              type: 'thinking_delta',
              thinking: part.text,
              signature: '',
            },
          }
          break
        }
        case 'reasoning-end': {
          const block = openBlocks.get(part.id)
          if (block && block.kind === 'thinking') {
            openBlocks.delete(part.id)
            yield { type: 'content_block_stop', index: block.index }
          }
          break
        }
        case 'tool-input-start': {
          const start = startMessage()
          if (start) yield start
          if (!openBlocks.has(part.id)) {
            const index = nextIndex++
            openBlocks.set(part.id, { index, kind: 'tool_use', args: '' })
            yield {
              type: 'content_block_start',
              index,
              content_block: {
                type: 'tool_use',
                id: part.id,
                name: part.toolName,
                // 消费端以字符串累积 JSON (claude.ts:2000), 类型面要求 object
                input: '' as unknown as Record<string, unknown>,
              },
            }
          }
          break
        }
        case 'tool-input-delta': {
          const start = startMessage()
          if (start) yield start
          let block = openBlocks.get(part.id)
          if (!block) {
            block = { index: nextIndex++, kind: 'tool_use', args: '' }
            openBlocks.set(part.id, block)
            yield {
              type: 'content_block_start',
              index: block.index,
              content_block: {
                type: 'tool_use',
                id: part.id,
                name: '',
                input: '' as unknown as Record<string, unknown>,
              },
            }
          }
          block.args += part.delta
          yield {
            type: 'content_block_delta',
            index: block.index,
            delta: { type: 'input_json_delta', partial_json: part.delta },
          }
          break
        }
        case 'tool-call': {
          const start = startMessage()
          if (start) yield start
          let block = openBlocks.get(part.toolCallId)
          if (!block) {
            block = { index: nextIndex++, kind: 'tool_use', args: '' }
            openBlocks.set(part.toolCallId, block)
            yield {
              type: 'content_block_start',
              index: block.index,
              content_block: {
                type: 'tool_use',
                id: part.toolCallId,
                name: part.toolName,
                input: '' as unknown as Record<string, unknown>,
              },
            }
          }
          // 流式 JSON 未送达 (如非流式参数路径) — 用最终解析对象补一发
          if (block.args === '' && isPlainObject(part.input)) {
            yield {
              type: 'content_block_delta',
              index: block.index,
              delta: {
                type: 'input_json_delta',
                partial_json: JSON.stringify(part.input),
              },
            }
          }
          openBlocks.delete(part.toolCallId)
          yield { type: 'content_block_stop', index: block.index }
          break
        }
        case 'finish': {
          finishSeen = true
          const start = startMessage()
          if (start) yield start
          for (const block of openBlocks.values()) {
            yield { type: 'content_block_stop', index: block.index }
          }
          openBlocks.clear()
          stopReason = mapStopReason(part.finishReason)
          yield {
            type: 'message_delta',
            delta: { stop_reason: stopReason, stop_sequence: null },
            usage: toUsage(part.totalUsage),
          }
          yield { type: 'message_stop' }
          break
        }
        default:
          // start-step / finish-step / custom 等辅助事件 — 消费端不需要
          break
      }
    }

    // 流被服务端提前关闭 (无 finish) — 兜底关闭已打开的块, 避免悬挂
    if (!finishSeen && messageId !== null) {
      for (const block of openBlocks.values()) {
        yield { type: 'content_block_stop', index: block.index }
      }
      openBlocks.clear()
      yield {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { input_tokens: 0, output_tokens: 0 },
      }
      yield { type: 'message_stop' }
    }
  } finally {
    if (outerSignal) {
      outerSignal.removeEventListener('abort', onOuterAbort)
    }
    try {
      await fullStream.cancel()
    } catch {
      // 流可能已关闭/报错 — 忽略
    }
  }
}

async function streamRequest(
  request: ModelRequest,
  provider: OpenAICompatibleProvider,
  signal: AbortSignal | undefined,
): Promise<StreamResponse> {
  // 内部 controller: 既驱动 AI SDK 调用, 也暴露给消费端 (cleanupStream 会
  // 调 controller.abort(), 见 claude.ts:2911-2912)
  const controller = new AbortController()
  const onOuterAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) {
      controller.abort()
    } else {
      signal.addEventListener('abort', onOuterAbort, { once: true })
    }
  }

  const result = streamText(
    buildCallArgs(request, provider(request.model), controller.signal),
  )

  const stream: StreamResponse = {
    controller,
    [Symbol.asyncIterator]() {
      return streamEvents(
        request.model,
        result.fullStream,
        controller.signal,
        signal,
        onOuterAbort,
      )
    },
  }
  // 扩展面: metadata — 绑定 AI SDK result.response (PromiseLike, 流结束后 resolve)
  // claude.ts 桥接读取 stream.metadata.status 做错误处理; 对 OpenAI 兼容端点,
  // 响应头在流结束时才可用, 桥接的 await 会延迟到流完成 (正常流无感知)。
  const metadata = (async () => {
    const res = await result.response
    const headers = res.headers ?? {}
    const requestId = headers['x-request-id'] ?? headers['request-id'] ?? res.id ?? ''
    return {
      // OpenAI 兼容端点无独立 status — 请求级错误以流事件 error 呈现,
      // 桥接的 status >= 400 检查对正常流始终通过。
      status: 200,
      headers: new Headers(headers),
      requestID: requestId,
    }
  })()
  return Object.assign(stream, { metadata })
}

// ============================================================================
// 非流式映射 — generateText → WithResponse<AssistantMessage>
// ============================================================================

async function generateRequest(
  request: ModelRequest,
  provider: OpenAICompatibleProvider,
  signal: AbortSignal | undefined,
): Promise<WithResponse<AssistantMessage>> {
  try {
    const result = await generateText(
      buildCallArgs(request, provider(request.model), signal),
    )

    const content: ContentBlock[] = []
    for (const r of result.reasoning) {
      if (r.type === 'reasoning' && r.text !== '') {
        content.push({ type: 'thinking', thinking: r.text, signature: '' })
      }
    }
    if (result.text !== '') {
      content.push({ type: 'text', text: result.text })
    }
    for (const call of result.toolCalls) {
      content.push({
        type: 'tool_use',
        id: call.toolCallId,
        name: call.toolName,
        input: call.input as Record<string, unknown>,
      })
    }

    const message: AssistantMessage = {
      id: result.response.id,
      type: 'message',
      role: 'assistant',
      content,
      model: request.model,
      stop_reason: mapStopReason(result.finishReason),
      stop_sequence: null,
      usage: toUsage(result.usage),
    }
    lastAssistantMessageId = message.id

    const responseHeaders = result.response.headers ?? {}
    return {
      data: message,
      request_id:
        responseHeaders['x-request-id'] ??
        responseHeaders['request-id'] ??
        result.response.id,
      response: {
        headers: new Headers(responseHeaders),
        // AI SDK 不暴露 HTTP status — 非 2xx 已在 mapError 抛错
        status: 200,
      },
    }
  } catch (error) {
    throw mapError(error, signal)
  }
}
