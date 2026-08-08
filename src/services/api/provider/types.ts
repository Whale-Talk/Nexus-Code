// Provider 抽象层类型定义 — 内部模型请求/流事件/错误契约。
//
// 49 符号 (P0 实测: 45 直接导入 + 4 命名空间限定) × 3 语义组:
//   请求参数 / 流事件 / 错误语义
//
// 设计原则:
//   - 只重表达本仓库真实消费面 (P4 薄而稳)
//   - 不引入 @anthropic-ai/sdk 类型 (阶段 4 零直接导入)
//   - 保留别名映射 (BetaUsage→Usage, BetaMessageParam→MessageParam)

// ============================================================================
// 请求参数语义 — 构造 API 请求的消息/工具/配置面
// ============================================================================

/** 文本块参数 (对应 TextBlockParam, 33 文件消费) */
export interface TextContentBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' } | null
}

/** 图片来源 (Base64 image source) */
export interface Base64ImageSource {
  type: 'base64'
  media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
  data: string
}

/** URL 图片来源 */
export interface URLImageSource {
  type: 'url'
  url: string
}

/** PDF 图片来源 (Base64PDFSource 语义 — FileReadTool 文档块消费) */
export interface Base64PDFSource {
  type: 'base64'
  media_type: 'application/pdf'
  data: string
}

export type ImageSource = Base64ImageSource | URLImageSource

/** 图片块参数 (10 文件消费) */
export interface ImageContentBlock {
  type: 'image'
  source: ImageSource
  cache_control?: { type: 'ephemeral' } | null
}

/** 工具使用块参数 (30 文件消费) */
export interface ToolResultContentBlock {
  type: 'tool_result'
  tool_use_id: string
  content?: string | Array<TextContentBlock | ImageContentBlock>
  is_error?: boolean
  cache_control?: { type: 'ephemeral' } | null
}

/** 文档块 */
export interface DocumentContentBlock {
  type: 'document'
  source: ImageSource | Base64PDFSource
  cache_control?: { type: 'ephemeral' } | null
}

export type ContentBlockParam =
  | TextContentBlock
  | ImageContentBlock
  | ToolResultContentBlock
  | DocumentContentBlock

/** 消息参数 (BetaMessageParam 别名, 2 文件消费) */
export interface MessageParam {
  role: 'user' | 'assistant'
  content: string | ContentBlockParam[]
}

/** 工具定义 — 输入 schema (镜像 SDK Tool.InputSchema: 宽松 properties + 索引签名) */
export interface ToolInputSchema {
  type: 'object'
  properties?: unknown | null
  required?: string[] | null
  [k: string]: unknown
}

/** 工具定义 (Anthropic.Tool 命名空间限定, 4 文件消费) */
export interface ToolDefinition {
  name: string
  description?: string
  input_schema: ToolInputSchema
}

/** 工具选择 */
export type ToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'tool'; name: string }
  | { type: 'none' }

/** 工具使用块参数 (BetaToolUseBlockParam, 7 文件消费) */
export interface ToolUseContentBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

/** thinking 配置 (budget 格式 — DeepSeek 不兼容 adaptive) */
export interface ThinkingConfigParam {
  type: 'enabled'
  budget_tokens: number
}

/** 系统消息 */
export interface SystemMessageParam {
  text: string
  cache_control?: { type: 'ephemeral' } | null
}

/** 顶层请求参数 */
export interface ModelRequest {
  model: string
  messages: MessageParam[]
  system?: SystemMessageParam[]
  max_tokens: number
  temperature?: number
  stop_sequences?: string[]
  stream?: boolean
  tools?: ToolDefinition[]
  tool_choice?: ToolChoice
  thinking?: ThinkingConfigParam
  metadata?: { user_id?: string }
}

// ============================================================================
// 流事件语义 — 消费端使用的流事件/块/用量面
// ============================================================================

/** usage 统计 (BetaUsage 别名, 5 文件) */
export interface Usage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
  /** 服务端工具调用计数 (BetaServerToolUsage 语义) */
  server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number } | null
  /** 计费 tier (BetaUsage.service_tier 语义) */
  service_tier?: 'standard' | 'priority' | 'batch' | null
  /** 推理地域 (BetaUsage.inference_geo 语义) */
  inference_geo?: string | null
  /** 按迭代拆分用量 (BetaIterationsUsage 语义, 消费端仅 cast 读取) */
  iterations?: unknown[] | null
  /** 推理速度模式 (BetaUsage.speed 语义) */
  speed?: 'standard' | 'fast' | null
  /** 缓存 TTL 拆分 (BetaCacheCreation 语义) */
  cache_creation?: {
    ephemeral_1h_input_tokens?: number
    ephemeral_5m_input_tokens?: number
  } | null
}

/** 文本增量 */
export interface TextDelta {
  type: 'text_delta'
  text: string
}

/** 输入 JSON 增量 */
export interface InputJsonDelta {
  type: 'input_json_delta'
  partial_json: string
}

/** thinking 增量 (含签名 — claude.ts:2149 透传) */
export interface ThinkingDelta {
  type: 'thinking_delta'
  thinking: string
  signature?: string
}

/** thinking 块 (SDK ThinkingBlock 语义, 消费: messages.ts / AssistantThinkingMessage) */
export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
  signature: string
}

/** thinking 块参数 (SDK ThinkingBlockParam 语义) */
export interface ThinkingBlockParam {
  type: 'thinking'
  thinking: string
  signature: string
}

/** 脱敏 thinking 块 (SDK RedactedThinkingBlock 语义) */
export interface RedactedThinkingBlock {
  type: 'redacted_thinking'
  data: string
}

/** 脱敏 thinking 块参数 (SDK RedactedThinkingBlockParam 语义) */
export interface RedactedThinkingBlockParam {
  type: 'redacted_thinking'
  data: string
}

/** 内容块 (BetaContentBlock 联合类型, 8 文件) */
export type ContentBlock =
  | TextContentBlock
  | ImageContentBlock
  | ToolUseContentBlock
  | ThinkingBlock
  | RedactedThinkingBlock

/** 消息 (BetaMessage, 6 文件) */
export interface AssistantMessage {
  id: string
  type: 'message'
  role: 'assistant'
  content: ContentBlock[]
  model: string
  stop_reason: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence' | null
  stop_sequence?: string | null
  usage: Usage
}

/** 流事件 (5 类, 映射自 BetaRawMessageStreamEvent) */
export type StreamEvent =
  | { type: 'message_start'; message: AssistantMessage }
  | { type: 'content_block_start'; index: number; content_block: ContentBlock }
  | { type: 'content_block_delta'; index: number; delta: TextDelta | InputJsonDelta | ThinkingDelta }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: AssistantMessage['stop_reason']; stop_sequence?: string | null }; usage: Usage }
  | { type: 'message_stop' }

// ============================================================================
// 适配器接口
// ============================================================================

export interface StreamResponse {
  /** 异步迭代器 — 消费流事件 */
  [Symbol.asyncIterator](): AsyncIterator<StreamEvent>
  /** 中止流 (claude.ts:2911-2912) */
  controller: {
    abort(): void
    readonly signal: AbortSignal
  }
}

export interface WithResponse<T> {
  data: T
  request_id: string
  response: {
    headers: Headers
    status: number
  }
}

export interface ProviderAdapter {
  /** 流式请求 — 返回异步事件迭代器 */
  streamText(request: ModelRequest, signal?: AbortSignal): Promise<StreamResponse>
  /** 非流式请求 — 返回完整消息 + 请求级元数据 */
  generateText(request: ModelRequest, signal?: AbortSignal): Promise<WithResponse<AssistantMessage>>
}

// ============================================================================
// 错误语义 — 见 ./errors.ts (6 类: 4 实 + 2 占位)
// ============================================================================
