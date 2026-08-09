// Provider 适配器: @ai-sdk/anthropic 实现 (P1-A)。
//
// 对接面 (PoC 实测, ai@7.0.58 + @ai-sdk/anthropic@4.0.36):
//   - createAnthropic({ baseURL, apiKey, headers, fetch }) — 运行时参数每次调用读取
//   - streamText({ model, messages, maxOutputTokens, providerOptions: { anthropic: { thinking } }, ... })
//   - result.stream 公开部件: start / text-start|delta|end (id=wire index) /
//     reasoning-start|delta|end (id=wire index, signature 走 providerMetadata.anthropic.signature) /
//     tool-input-start|delta|end (id=toolCallId) / tool-call / finish (rawFinishReason=wire stop_reason)
//
// 关键映射决策:
//   1. thinking: 本仓库 budget 格式 { type:'enabled', budget_tokens } → providerOptions.anthropic.thinking
//      (camelCase budgetTokens)。注意: SDK 会把 thinking budget 加进 wire max_tokens,
//      此处沿用 claude.ts:1624 的预算封顶 (min(max_tokens-1)) 抑制放大。
//   2. 头注入: 非 api.anthropic.com relay 注入 X-Conversation-ID / X-Message-ID / X-Parent-Message-ID,
//      镜像 client.ts buildFetch (441-454) 的语义; X-Parent-Message-ID 由本模块自维护 (client.ts 不导出)。
//   3. reasoning 解码: AI SDK 把 thinking_delta/signature_delta 统一折叠为 reasoning-delta 部件,
//      签名经 providerMetadata.anthropic.signature 到达 — 映射为 thinking_delta { thinking, signature }。
//   4. stop_reason 归一化: DeepSeek relay 可能返回 tool_calls → tool_use (本仓库消费点期望 Anthropic 命名)。
//   5. 错误面: AI SDK APICallError → 本层 APIError (status/headers/requestID 属性面),
//      中止 → APIUserAbortError (message 契约钉死在 errors.ts)。
//   6. message_start 的 message.id: AI SDK 只在流结束后暴露真实 message id (result.response.id),
//      消费端以自身 uuid 为消息身份, 此处用占位 id 保持消息骨架完整。

import { createAnthropic, type AnthropicProvider } from '@ai-sdk/anthropic'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import {
  APICallError,
  generateText as aiGenerateText,
  jsonSchema,
  streamText as aiStreamText,
  type ContentPart,
  type FinishReason,
  type JSONSchema7,
  type JSONValue,
  type LanguageModelUsage,
  type ModelMessage,
  type ProviderMetadata,
  type ToolChoice,
  type ToolSet,
} from 'ai'
import { randomUUID } from 'crypto'

import { APIError, APIUserAbortError } from '../errors.js'
import type {
  AssistantMessage,
  Base64PDFSource,
  ContentBlock,
  ContentBlockParam,
  ImageSource,
  MessageParam,
  ModelRequest,
  ProviderAdapter,
  StreamEvent,
  StreamResponse,
  SystemMessageParam,
  ToolDefinition,
  Usage,
  WithResponse,
} from '../types.js'

// ============================================================================
// 模块状态 — X-Parent-Message-ID 跨请求追踪 (镜像 client.ts:364 的 lastAssistantMessageId)
// ============================================================================

let lastParentMessageId = ''

/** 扫描响应前 N 字节提取 assistant message id — SSE 找 message_start, JSON 读顶层 id */
const MAX_SSE_SCAN = 16_384

async function extractAssistantMessageId(response: Response): Promise<void> {
  try {
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('text/event-stream')) {
      const clone = response.clone()
      const reader = clone.body?.getReader()
      if (!reader) return
      const decoder = new TextDecoder()
      let buffer = ''
      let bytesRead = 0
      try {
        while (bytesRead < MAX_SSE_SCAN) {
          const { done, value } = await reader.read()
          if (done) break
          bytesRead += value?.length ?? 0
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6)) as {
                  type?: string
                  message?: { id?: string }
                }
                if (data.type === 'message_start' && data.message?.id) {
                  lastParentMessageId = data.message.id
                  await reader.cancel()
                  return
                }
              } catch {
                // skip unparseable SSE data lines
              }
            }
          }
        }
      } finally {
        try {
          reader.cancel()
        } catch {}
      }
    } else {
      const clone = response.clone()
      const data = (await clone.json()) as { id?: string }
      if (data?.id) lastParentMessageId = data.id
    }
  } catch {
    // never let header tracking crash the fetch
  }
}

// ============================================================================
// 运行时配置 — baseURL / apiKey / headers 每次调用从 process.env 读取
// ============================================================================

/**
 * relay 要求路径含 /v1 (isDeepSeekRelay 判定, modelOptions.ts:301-318):
 * AI SDK 请求 `${baseURL}/messages`, 而 relay 实际路由为 `${baseURL}/v1/messages`,
 * 与 @anthropic-ai/sdk 把 env baseURL 当 v1 根的行为一致。
 */
function resolveBaseURL(): string {
  const raw = process.env.NEXUS_BASE_URL
  if (!raw) return 'https://api.anthropic.com/v1'
  const trimmed = raw.replace(/\/+$/, '')
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`
}

/**
 * 会话追踪头 — 只对自定义 relay 注入, 绝不泄漏到 api.anthropic.com。
 * X-Conversation-ID 复用 bin/nexus.cjs:131 初始化的 CLAUDE_CONVERSATION_ID;
 * X-Message-ID 每次请求唯一; X-Parent-Message-ID 链接上一条 assistant 消息。
 */
function buildConversationHeaders(baseURL: string): Record<string, string> {
  if (baseURL.includes('api.anthropic.com')) return {}
  const conversationId =
    process.env.CLAUDE_CONVERSATION_ID || process.env.X_CONVERSATION_ID
  if (!conversationId) return {}
  const headers: Record<string, string> = {
    'X-Conversation-ID': conversationId,
    'X-Message-ID': randomUUID(),
  }
  if (lastParentMessageId) {
    headers['X-Parent-Message-ID'] = lastParentMessageId
  }
  return headers
}

/** fetch 包装: 捕获响应 (status/headers — WithResponse 契约) + 后台提取 parent message id */
function buildTrackingFetch(onResponse: (response: Response) => void): FetchFunction {
  const inner = globalThis.fetch
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const response = inner(input, init)
    response
      .then(res => {
        onResponse(res)
        void extractAssistantMessageId(res)
      })
      .catch(() => {})
    return response
  }) as unknown as FetchFunction
}

function createProvider(onResponse: (response: Response) => void): AnthropicProvider {
  const baseURL = resolveBaseURL()
  return createAnthropic({
    baseURL,
    // relay 的 key 无 sk- 前缀, 原样透传 (bin/nexus.cjs:66-74)
    apiKey: process.env.NEXUS_API_KEY,
    headers: buildConversationHeaders(baseURL),
    fetch: buildTrackingFetch(onResponse),
  })
}

// ============================================================================
// 请求参数映射 — wire Anthropic 形状 → AI SDK ModelMessage / ToolSet / providerOptions
// ============================================================================

/** 助理侧输入块 — types.ts 的 ContentBlockParam 不含 tool_use/thinking, 此处防御性放宽 */
type AssistantInputBlock =
  | ContentBlockParam
  | {
      type: 'tool_use'
      id: string
      name: string
      input: Record<string, unknown>
      cache_control?: { type: 'ephemeral' } | null
    }
  | {
      type: 'thinking'
      thinking: string
      signature: string
      cache_control?: { type: 'ephemeral' } | null
    }

function cacheControlProviderOptions(cacheControl?: {
  type: 'ephemeral'
} | null): { anthropic: { cacheControl: { type: 'ephemeral' } } } | undefined {
  return cacheControl ? { anthropic: { cacheControl } } : undefined
}

/** image/document 的 source → FilePart 的 data (URL 必须是 URL 实例, schema 钉死) */
function toFileData(source: ImageSource | Base64PDFSource): { type: 'data'; data: string } | { type: 'url'; url: URL } {
  return source.type === 'base64'
    ? { type: 'data', data: source.data }
    : { type: 'url', url: new URL(source.url) }
}

/**
 * 消息转换 — 保持 wire 语义:
 *   - user 的 text/image/document 块 → role:'user' 消息 (文本块直接内联)
 *   - user 的 tool_result 块 → role:'tool' 消息 (SDK 会与相邻 user 消息合并回 tool_result 块,
 *     顺序不变, probe 实测)
 *   - assistant 的 tool_use → tool-call 部件; thinking → reasoning 部件
 */
function convertMessages(messages: MessageParam[]): ModelMessage[] {
  const converted: ModelMessage[] = []
  for (const message of messages) {
    if (message.role === 'user') {
      if (typeof message.content === 'string') {
        converted.push({ role: 'user', content: message.content })
        continue
      }
      // tool_result 必须先于同消息的文本块发出: SDK 的语义检查 (convertToLanguageModelPrompt)
      // 在遇到 user 消息时校验此前所有 tool-call 都有结果, 顺序颠倒会抛 MissingToolResultsError
      for (const block of message.content) {
        if (block.type === 'tool_result') {
          converted.push({ role: 'tool', content: [convertToolResultBlock(block)] })
        }
      }
      const userParts = message.content.flatMap(convertUserBlock)
      if (userParts.length > 0) {
        converted.push({ role: 'user', content: userParts })
      }
    } else {
      const content =
        typeof message.content === 'string'
          ? message.content
          : (message.content as AssistantInputBlock[]).flatMap(convertAssistantBlock)
      converted.push({ role: 'assistant', content })
    }
  }
  return converted
}

type UserPart =
  | { type: 'text'; text: string }
  | { type: 'file'; data: { type: 'data'; data: string } | { type: 'url'; url: URL }; mediaType: string }

function convertUserBlock(block: ContentBlockParam): UserPart[] {
  const cacheControl = cacheControlProviderOptions(block.cache_control)
  switch (block.type) {
    case 'text':
      return [
        {
          type: 'text',
          text: block.text,
          ...(cacheControl ? { providerOptions: cacheControl } : {}),
        },
      ]
    case 'image':
      return [
        {
          type: 'file',
          data: toFileData(block.source),
          // URL 图片来源无 media_type — 顶层 'image' 足够 SDK 判定为图片
          mediaType: block.source.type === 'base64' ? block.source.media_type : 'image/*',
          ...(cacheControl ? { providerOptions: cacheControl } : {}),
        },
      ]
    case 'document':
      return [
        {
          type: 'file',
          data: toFileData(block.source),
          mediaType:
            block.source.type === 'base64'
              ? block.source.media_type
              : 'application/octet-stream',
          ...(cacheControl ? { providerOptions: cacheControl } : {}),
        },
      ]
    default:
      return []
  }
}

type ToolContentValuePart =
  | { type: 'text'; text: string }
  | { type: 'file'; data: { type: 'data'; data: string } | { type: 'url'; url: URL }; mediaType: string }

type ToolResultOutputPart =
  | { type: 'text'; value: string }
  | { type: 'error-text'; value: string }
  | { type: 'content'; value: ToolContentValuePart[] }

function convertToolResultBlock(
  block: Extract<ContentBlockParam, { type: 'tool_result' }>,
): { type: 'tool-result'; toolCallId: string; toolName: string; output: ToolResultOutputPart } {
  const content = block.content
  let output: ToolResultOutputPart
  if (typeof content === 'string') {
    output = block.is_error
      ? { type: 'error-text', value: content }
      : { type: 'text', value: content }
  } else {
    output = {
      type: 'content',
      value: (content ?? []).flatMap<ToolContentValuePart>(part => {
        if (part.type === 'text') return [{ type: 'text', text: part.text }]
        if (part.type === 'image') {
          return [
            {
              type: 'file',
              data: toFileData(part.source),
              mediaType: part.source.type === 'base64' ? part.source.media_type : 'image/*',
            },
          ]
        }
        return []
      }),
    }
  }
  return {
    type: 'tool-result',
    toolCallId: block.tool_use_id,
    // 本仓库 ToolResultContentBlock 无工具名; anthropic 转换只消费 tool_use_id (schema 必填)
    toolName: '',
    output,
  }
}

function convertAssistantBlock(
  block: AssistantInputBlock,
): Array<
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'reasoning'; text: string; providerOptions?: { anthropic: { signature: string } } }
> {
  const cacheControl = cacheControlProviderOptions(block.cache_control)
  switch (block.type) {
    case 'text':
      return [
        {
          type: 'text',
          text: block.text,
          ...(cacheControl ? { providerOptions: cacheControl } : {}),
        },
      ]
    case 'tool_use':
      return [{ type: 'tool-call', toolCallId: block.id, toolName: block.name, input: block.input }]
    case 'thinking':
      // 防御性: 本仓库发送前会剥离 thinking 块 (claude.ts:659-660), 但保留映射以免静默丢块
      return [
        {
          type: 'reasoning',
          text: block.thinking,
          ...(block.signature
            ? { providerOptions: { anthropic: { signature: block.signature } } }
            : {}),
        },
      ]
    default:
      return []
  }
}

function convertSystem(system: SystemMessageParam[] | undefined): ModelMessage[] {
  if (!system || system.length === 0) return []
  return system.map(s => ({
    role: 'system',
    content: s.text,
    ...(s.cache_control
      ? { providerOptions: { anthropic: { cacheControl: s.cache_control } } }
      : {}),
  }))
}

function convertTools(tools: ToolDefinition[] | undefined): ToolSet | undefined {
  if (!tools || tools.length === 0) return undefined
  const converted: Record<string, unknown> = {}
  for (const tool of tools) {
    converted[tool.name] = {
      type: 'function',
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      inputSchema: jsonSchema(tool.input_schema as unknown as JSONSchema7),
    }
  }
  return converted as unknown as ToolSet
}

function convertToolChoice(
  choice: ModelRequest['tool_choice'],
): ToolChoice<Record<string, unknown>> | undefined {
  if (!choice) return undefined
  switch (choice.type) {
    case 'any':
      return 'required'
    case 'none':
      return 'none'
    case 'tool':
      return { type: 'tool', toolName: choice.name }
    default:
      return 'auto'
  }
}

function buildProviderOptions(
  request: ModelRequest,
): { anthropic: Record<string, JSONValue> } | undefined {
  const anthropicOptions: Record<string, JSONValue> = {}
  if (request.thinking?.type === 'enabled') {
    // 预算封顶镜像 claude.ts:1624 (max_tokens - 1);
    // 注意 SDK 会向 wire max_tokens 追加 budget (anthropic provider 内部行为)
    const budget = Math.min(
      request.thinking.budget_tokens,
      Math.max(1, request.max_tokens - 1),
    )
    anthropicOptions.thinking = { type: 'enabled', budgetTokens: budget }
  }
  if (request.metadata?.user_id) {
    anthropicOptions.metadata = { userId: request.metadata.user_id }
  }
  return Object.keys(anthropicOptions).length > 0
    ? { anthropic: anthropicOptions }
    : undefined
}

interface CallOptions {
  model: ReturnType<AnthropicProvider>
  messages: ModelMessage[]
  maxOutputTokens: number
  temperature?: number
  stopSequences?: string[]
  tools?: ToolSet
  toolChoice?: ToolChoice<Record<string, unknown>>
  providerOptions?: { anthropic: Record<string, JSONValue> }
  allowSystemInMessages: boolean
  abortSignal: AbortSignal
  maxRetries: 0
}

function buildCallOptions(
  request: ModelRequest,
  provider: AnthropicProvider,
  abortSignal: AbortSignal,
): CallOptions {
  const thinkingEnabled = request.thinking?.type === 'enabled'
  const tools = convertTools(request.tools)
  const providerOptions = buildProviderOptions(request)
  return {
    model: provider(request.model),
    messages: [...convertSystem(request.system), ...convertMessages(request.messages)],
    maxOutputTokens: request.max_tokens,
    // 与 claude.ts:1691 一致: thinking 启用时不发 temperature (SDK 会忽略并告警)
    ...(request.temperature !== undefined && !thinkingEnabled
      ? { temperature: request.temperature }
      : {}),
    ...(request.stop_sequences && request.stop_sequences.length > 0
      ? { stopSequences: request.stop_sequences }
      : {}),
    ...(tools ? { tools } : {}),
    ...(request.tool_choice ? { toolChoice: convertToolChoice(request.tool_choice) } : {}),
    ...(providerOptions ? { providerOptions } : {}),
    allowSystemInMessages: true,
    abortSignal,
    // 重试由 withRetry 层负责, 关闭 SDK 自动重试 (与 claude.ts:1781 maxRetries: 0 对齐)
    maxRetries: 0,
  }
}

// ============================================================================
// 流事件映射 — AI SDK 部件 → wire StreamEvent
// ============================================================================

const EMPTY_USAGE: Usage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: null,
  cache_read_input_tokens: null,
}

/** streamText 元数据扩展面 — fetch 响应头到达后 resolve (模拟 SDK .withResponse()) */
interface StreamMetadata {
  status: number
  headers: Headers
  requestID: string
}

function mapUsage(usage: LanguageModelUsage | undefined): Usage {
  if (!usage) return { ...EMPTY_USAGE }
  return {
    // wire 语义: input_tokens 不含缓存命中 (cacheRead/cacheWrite 单列)
    input_tokens: usage.inputTokenDetails?.noCacheTokens ?? usage.inputTokens ?? 0,
    output_tokens: usage.outputTokens ?? 0,
    cache_creation_input_tokens: usage.inputTokenDetails?.cacheWriteTokens ?? null,
    cache_read_input_tokens: usage.inputTokenDetails?.cacheReadTokens ?? null,
  }
}

const WIRE_STOP_REASONS: ReadonlySet<string> = new Set([
  'end_turn',
  'max_tokens',
  'tool_use',
  'stop_sequence',
])

/**
 * stop_reason 归一化 — raw 优先 (wire stop_reason 原样),
 * 缺失时按 unified FinishReason 反推。
 */
function normalizeStopReason(
  raw: string | undefined,
  unified: FinishReason,
): AssistantMessage['stop_reason'] {
  if (raw) {
    // DeepSeek relay 的 stop_reason 可能为 tool_calls — 归一化为 Anthropic 命名
    if (raw === 'tool_calls') return 'tool_use'
    if (WIRE_STOP_REASONS.has(raw)) return raw as AssistantMessage['stop_reason']
  }
  switch (unified) {
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

/** 从 providerMetadata.anthropic 读取字符串字段 (signature / stopSequence) */
function extractAnthropicString(
  metadata: ProviderMetadata | undefined,
  key: string,
): string | undefined {
  const anthropic = metadata?.anthropic
  if (anthropic == null || typeof anthropic !== 'object') return undefined
  const value = (anthropic as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

function indexFor(map: Map<string, number>, id: string): number {
  return map.get(id) ?? 0
}

/** 链接外部 signal → 内部 controller, 使 StreamResponse.controller.signal 驱动请求 */
function createLinkedController(signal: AbortSignal | undefined): AbortController {
  const controller = new AbortController()
  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason)
    } else {
      signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
    }
  }
  return controller
}

async function* streamEvents(
  request: ModelRequest,
  controller: AbortController,
  provider: AnthropicProvider,
): AsyncGenerator<StreamEvent, void, unknown> {
  const result = aiStreamText(buildCallOptions(request, provider, controller.signal))
  const partIndexByBlockId = new Map<string, number>()
  let nextBlockIndex = 0
  let messageStarted = false
  let finishSeen = false
  let stopReason: AssistantMessage['stop_reason'] = null
  let usage: Usage = { ...EMPTY_USAGE }

  try {
    for await (const part of result.stream) {
      switch (part.type) {
        case 'start': {
          messageStarted = true
          yield {
            type: 'message_start',
            message: {
              // 真实 message id 只在流结束后可读 (result.response.id) —
              // 消费端以自身 uuid 为消息身份, 此处占位保持消息骨架完整
              id: randomUUID(),
              type: 'message',
              role: 'assistant',
              content: [],
              model: request.model,
              stop_reason: null,
              usage: { ...EMPTY_USAGE },
            },
          }
          break
        }
        case 'text-start': {
          const index = nextBlockIndex++
          partIndexByBlockId.set(part.id, index)
          yield { type: 'content_block_start', index, content_block: { type: 'text', text: '' } }
          break
        }
        case 'text-delta':
          yield {
            type: 'content_block_delta',
            index: indexFor(partIndexByBlockId, part.id),
            delta: { type: 'text_delta', text: part.text },
          }
          break
        case 'text-end':
          yield { type: 'content_block_stop', index: indexFor(partIndexByBlockId, part.id) }
          break
        case 'reasoning-start': {
          const index = nextBlockIndex++
          partIndexByBlockId.set(part.id, index)
          yield {
            type: 'content_block_start',
            index,
            content_block: { type: 'thinking', thinking: '', signature: '' },
          }
          break
        }
        case 'reasoning-delta': {
          // AI SDK 把 thinking_delta 与 signature_delta 统一折叠为 reasoning-delta,
          // 签名经 providerMetadata.anthropic.signature 到达 (PoC 实测)
          const signature = extractAnthropicString(part.providerMetadata, 'signature')
          yield {
            type: 'content_block_delta',
            index: indexFor(partIndexByBlockId, part.id),
            delta: {
              type: 'thinking_delta',
              thinking: part.text,
              ...(signature ? { signature } : {}),
            },
          }
          break
        }
        case 'reasoning-end':
          yield { type: 'content_block_stop', index: indexFor(partIndexByBlockId, part.id) }
          break
        case 'tool-input-start': {
          const index = nextBlockIndex++
          partIndexByBlockId.set(part.id, index)
          yield {
            type: 'content_block_start',
            index,
            content_block: { type: 'tool_use', id: part.id, name: part.toolName, input: {} },
          }
          break
        }
        case 'tool-input-delta':
          yield {
            type: 'content_block_delta',
            index: indexFor(partIndexByBlockId, part.id),
            delta: { type: 'input_json_delta', partial_json: part.delta },
          }
          break
        case 'tool-input-end':
          yield { type: 'content_block_stop', index: indexFor(partIndexByBlockId, part.id) }
          break
        case 'finish': {
          // rawFinishReason = wire 的 delta.stop_reason (含 DeepSeek 的 tool_calls)
          stopReason = normalizeStopReason(part.rawFinishReason, part.finishReason)
          usage = mapUsage(part.totalUsage)
          finishSeen = true
          break
        }
        case 'error':
          // API 错误 (429/5xx 等) 以 error 部件到达, 而不是迭代抛错 (PoC 实测);
          // 中止优先: 用户已取消, 任何残留错误都让位于 APIUserAbortError
          if (controller.signal.aborted) throw new APIUserAbortError()
          throw mapAPIError(part.error)
        default:
          // tool-call (完整 JSON 汇总, 已由 input_json_delta 流式送达) /
          // start-step / finish-step / source / file 等: 无 wire 等价事件
          break
      }
    }
  } catch (error) {
    // 中止优先: 用户/看门狗已取消, 任何残留错误 (含裸 AbortError) 都归一到 APIUserAbortError
    if (controller.signal.aborted) throw new APIUserAbortError()
    throw mapAPIError(error)
  }

  if (controller.signal.aborted) {
    // 用户中止: SDK 静默关流, 这里补抛中止错误 (与 SDK 时代语义一致)
    throw new APIUserAbortError()
  }

  // message_delta 在流结束后补发: stop_sequence 只在 finalStep 元数据中可用,
  // 且必须排在 message_stop 之前 — 与 wire 事件顺序一致
  if (finishSeen && messageStarted) {
    let stopSequence: string | null = null
    try {
      const finalStep = await result.finalStep
      stopSequence = extractAnthropicString(finalStep.providerMetadata, 'stopSequence') ?? null
    } catch {
      // 流已正常结束, finalStep 元数据缺失时降级为 null
    }
    yield { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: stopSequence }, usage }
    yield { type: 'message_stop' }
  }
}

// ============================================================================
// 错误映射 — @ai-sdk/provider APICallError → 本层 APIError 属性面
// ============================================================================

function parseErrorBody(responseBody: string | undefined): Record<string, unknown> {
  if (!responseBody) return {}
  try {
    const parsed = JSON.parse(responseBody) as unknown
    if (parsed != null && typeof parsed === 'object') return parsed as Record<string, unknown>
  } catch {
    // 非 JSON 错误体
  }
  return {}
}

function mapAPIError(error: unknown): unknown {
  if (APICallError.isInstance(error)) {
    const headers = new Headers(error.responseHeaders ?? {})
    return new APIError(
      error.statusCode ?? 500,
      parseErrorBody(error.responseBody),
      error.message,
      headers,
      headers.get('request-id') ?? undefined,
    )
  }
  // provider 侧流错误可能是裸字符串 (如 "text part 0 not found") — 包装为 Error 保持调用方可捕获
  if (error instanceof Error) return error
  return new Error(typeof error === 'string' ? error : 'Stream error')
}

// ============================================================================
// 非流式响应组装
// ============================================================================

function parseToolInput(input: unknown): Record<string, unknown> {
  if (input != null && typeof input === 'object') return input as Record<string, unknown>
  if (typeof input === 'string' && input !== '') {
    try {
      const parsed = JSON.parse(input) as unknown
      if (parsed != null && typeof parsed === 'object') return parsed as Record<string, unknown>
    } catch {
      // 回退空对象
    }
  }
  return {}
}

function buildContentBlocks(content: Array<ContentPart<ToolSet>>): ContentBlock[] {
  const blocks: ContentBlock[] = []
  for (const part of content) {
    switch (part.type) {
      case 'text':
        blocks.push({ type: 'text', text: part.text })
        break
      case 'reasoning':
        blocks.push({
          type: 'thinking',
          thinking: part.text,
          signature: extractAnthropicString(part.providerMetadata, 'signature') ?? '',
        })
        break
      case 'tool-call':
        blocks.push({
          type: 'tool_use',
          id: part.toolCallId,
          name: part.toolName,
          input: parseToolInput(part.input),
        })
        break
      default:
        break
    }
  }
  return blocks
}

// ============================================================================
// ProviderAdapter 实现
// ============================================================================

export const adapter: ProviderAdapter = {
  async streamText(request, signal): Promise<StreamResponse> {
    const controller = createLinkedController(signal)
    let resolveMetadata: ((metadata: StreamMetadata) => void) | undefined
    const metadata = new Promise<StreamMetadata>((resolve, reject) => {
      resolveMetadata = resolve
      // 中止时 fetch 可能未到达 (响应头未产生) — 元数据随中止拒绝, 防止桥接侧悬挂
      controller.signal.addEventListener(
        'abort',
        () => reject(new APIUserAbortError()),
        { once: true },
      )
    })
    const provider = createProvider(res => {
      // fetch 响应头到达即 resolve — 模拟 SDK .withResponse() 的 request_id/headers 面
      resolveMetadata?.({
        status: res.status,
        headers: new Headers(res.headers),
        requestID: res.headers.get('request-id') ?? '',
      })
    })
    const iterator = streamEvents(request, controller, provider)
    const stream: StreamResponse = {
      [Symbol.asyncIterator]: () => iterator,
      controller,
    }
    // metadata 为扩展面 (claude.ts 桥接以类型断言读取) — StreamResponse 接口契约保持不变
    return Object.assign(stream, { metadata })
  },

  async generateText(request, signal): Promise<WithResponse<AssistantMessage>> {
    if (signal?.aborted) throw new APIUserAbortError()
    const controller = createLinkedController(signal)
    let status = 200
    const provider = createProvider(res => {
      status = res.status
    })
    try {
      // response / providerMetadata 为 finalStep 的文档级别名 (GenerateTextResult 无 finalStep)
      const result = await aiGenerateText(buildCallOptions(request, provider, controller.signal))
      const response = result.response
      const message: AssistantMessage = {
        id: response.id ?? '',
        type: 'message',
        role: 'assistant',
        content: buildContentBlocks(result.content as unknown as Array<ContentPart<ToolSet>>),
        model: response.modelId ?? request.model,
        stop_reason: normalizeStopReason(result.rawFinishReason, result.finishReason),
        stop_sequence: extractAnthropicString(result.providerMetadata, 'stopSequence') ?? null,
        usage: mapUsage(result.usage),
      }
      return {
        data: message,
        request_id: response.headers?.['request-id'] ?? response.id ?? '',
        response: {
          headers: new Headers(response.headers ?? {}),
          status,
        },
      }
    } catch (error) {
      if (controller.signal.aborted) throw new APIUserAbortError()
      throw mapAPIError(error)
    }
  },
}
