export interface TextContentBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' } | null
}

export interface Base64ImageSource {
  type: 'base64'
  media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
  data: string
}

export interface URLImageSource {
  type: 'url'
  url: string
}

export interface Base64PDFSource {
  type: 'base64'
  media_type: 'application/pdf'
  data: string
}

export type ImageSource = Base64ImageSource | URLImageSource

export interface ImageContentBlock {
  type: 'image'
  source: ImageSource
  cache_control?: { type: 'ephemeral' } | null
}

export interface ToolResultContentBlock {
  type: 'tool_result'
  tool_use_id: string
  content?: string | Array<TextContentBlock | ImageContentBlock>
  is_error?: boolean
  cache_control?: { type: 'ephemeral' } | null
}

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

export interface MessageParam {
  role: 'user' | 'assistant'
  content: string | Array<ContentBlockParam | ToolUseContentBlock | ThinkingBlock | RedactedThinkingBlock>
}

export interface ToolInputSchema {
  type: 'object'
  properties?: unknown | null
  required?: string[] | null
  [k: string]: unknown
}

export interface ToolDefinition {
  type?: 'custom' | null
  name: string
  description?: string
  input_schema: ToolInputSchema
}

export type ToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'tool'; name: string }
  | { type: 'none' }

export interface ToolUseContentBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface JSONOutputFormat {
  type: 'json_schema'
  schema: { [key: string]: unknown }
}

export interface SystemMessageParam {
  text: string
  cache_control?: { type: 'ephemeral' } | null
}

// Requests shared by both transports. The transcript block representation is retained on disk.
export interface ModelRequest {
  model: string
  messages: MessageParam[]
  system?: SystemMessageParam[]
  maxOutputTokens: number
  temperature?: number
  stopSequences?: string[]
  tools?: ToolDefinition[]
  toolChoice?: ToolChoice
  reasoning?: { mode: 'budget'; tokens: number } | { mode: 'adaptive' | 'off' }
  outputFormat?: JSONOutputFormat
  effort?: 'low' | 'medium' | 'high' | 'max'
  userId?: string
}

export interface Usage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
  server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number } | null
  service_tier?: 'standard' | 'priority' | 'batch' | null
  inference_geo?: string | null
  iterations?: unknown[] | null
  speed?: 'standard' | 'fast' | null
  cache_creation?: {
    ephemeral_1h_input_tokens?: number
    ephemeral_5m_input_tokens?: number
  } | null
}

export interface SignatureDelta {
  type: 'signature_delta'
  signature: string
}

export interface TextDelta {
  type: 'text_delta'
  text: string
}

export interface InputJsonDelta {
  type: 'input_json_delta'
  partial_json: string
}

export interface ThinkingDelta {
  type: 'thinking_delta'
  thinking: string
  signature?: string
}

export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
  signature: string
}

export interface ThinkingBlockParam {
  type: 'thinking'
  thinking: string
  signature: string
}

export interface RedactedThinkingBlock {
  type: 'redacted_thinking'
  data: string
}

export interface RedactedThinkingBlockParam {
  type: 'redacted_thinking'
  data: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

export interface ServerToolUseBlock { type: 'server_tool_use' }
export interface WebSearchToolResultBlock { type: 'web_search_tool_result' }
export interface WebFetchToolResultBlock { type: 'web_fetch_tool_result' }
export interface CodeExecutionToolResultBlock { type: 'code_execution_tool_result' }
export interface BashCodeExecutionToolResultBlock { type: 'bash_code_execution_tool_result' }
export interface TextEditorCodeExecutionToolResultBlock { type: 'text_editor_code_execution_tool_result' }
export interface ToolSearchToolResultBlock { type: 'tool_search_tool_result' }
export interface MCPToolUseBlock { type: 'mcp_tool_use' }
export interface MCPToolResultBlock { type: 'mcp_tool_result' }
export interface ContainerUploadBlock { type: 'container_upload' }
export interface CompactionBlock { type: 'compaction' }

export type ContentBlock =
  | TextContentBlock
  | ImageContentBlock
  | ToolUseContentBlock
  | ToolUseBlock
  | ThinkingBlock
  | RedactedThinkingBlock
  | ServerToolUseBlock
  | WebSearchToolResultBlock
  | WebFetchToolResultBlock
  | CodeExecutionToolResultBlock
  | BashCodeExecutionToolResultBlock
  | TextEditorCodeExecutionToolResultBlock
  | ToolSearchToolResultBlock
  | MCPToolUseBlock
  | MCPToolResultBlock
  | ContainerUploadBlock
  | CompactionBlock

export interface AssistantMessage {
  id: string
  type: 'message'
  role: 'assistant'
  content: ContentBlock[]
  model: string
  stop_reason: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence' | 'refusal' | 'pause_turn' |
    'compaction' | 'model_context_window_exceeded' | null
  stop_sequence?: string | null
  usage: Usage
}

export type StreamEvent =
  | { type: 'message_start'; message: AssistantMessage }
  | { type: 'content_block_start'; index: number; content_block: ContentBlock }
  | { type: 'content_block_delta'; index: number; delta: TextDelta | InputJsonDelta | ThinkingDelta | SignatureDelta }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: AssistantMessage['stop_reason']; stop_sequence?: string | null }; usage: Usage }
  | { type: 'message_stop' }

export interface StreamResponse {
  [Symbol.asyncIterator](): AsyncIterator<StreamEvent>
  controller: {
    abort(): void
    readonly signal: AbortSignal
  }
}

export interface ModelResponse<T> {
  data: T
  requestId: string
  response: {
    headers: Headers
    status: number
  }
}

export interface ProviderAdapter {
  streamText(request: ModelRequest, signal?: AbortSignal): Promise<ChannelStream>
  generateText(request: ModelRequest, signal?: AbortSignal): Promise<ModelResponse<AssistantMessage>>
}

export interface ChannelStream extends StreamResponse {
  metadata: Promise<{ status: number; headers: Headers; requestID: string }>
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>
