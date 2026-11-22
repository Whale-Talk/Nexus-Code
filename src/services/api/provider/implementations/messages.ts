import { randomUUID } from 'node:crypto'
import { APIConnectionError, APIError, APIUserAbortError, AuthenticationError } from '../errors.js'
import { getOfficialReasoningDialect, getReasoningProfile, getWireReasoningEffort } from '../reasoning.js'
import { captureStreamMetadata } from '../streamMetadata.js'
import type {
  AssistantMessage, ContentBlock, MessageParam, ModelRequest, ProviderAdapter, StreamEvent, Usage,
} from '../types.js'

type ChannelConnection = { baseURL: string; apiKey: string; fetch?: typeof globalThis.fetch }
type JsonObject = Record<string, unknown>

export function normalizeMessagesBaseURL(baseURL: string): string {
  const prefix = baseURL.replace(/\/+$/, '')
  return prefix.endsWith('/v1') ? prefix : prefix + '/v1'
}

export function messagesHeaders(apiKey: string) {
  // These two fields are part of the HTTP Messages protocol.
  return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
}

function record(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

type InputBlock = Exclude<MessageParam['content'], string>[number]

function serializeBlock(block: InputBlock): JsonObject | undefined {
  const cache = 'cache_control' in block && block.cache_control
    ? { cache_control: block.cache_control } : {}
  switch (block.type) {
    case 'text': return { type: 'text', text: block.text, ...cache }
    case 'image':
    case 'document': return { type: block.type, source: block.source, ...cache }
    case 'thinking': return { type: block.type, thinking: block.thinking, signature: block.signature }
    case 'redacted_thinking': return { type: block.type, data: block.data }
    case 'tool_use': return { type: block.type, id: block.id, name: block.name, input: block.input, ...cache }
    case 'tool_result': return {
      type: block.type, tool_use_id: block.tool_use_id, is_error: block.is_error, ...cache,
      content: Array.isArray(block.content) ? block.content.map(serializeBlock).filter(Boolean) : block.content,
    }
  }
}

function serializeMessages(request: ModelRequest, stream: boolean, baseURL: string) {
  if (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0) {
    throw new Error('maxOutputTokens must be a positive integer')
  }
  const reasoning = request.reasoning
  const profile = getReasoningProfile('messages', baseURL, request.model, request.reasoningDialect)
  const effort = getWireReasoningEffort(profile, request)
  const thinking = !reasoning || profile?.thinking === 'always' ? undefined
    : reasoning.mode === 'off' ? { type: 'disabled' }
    : profile?.thinking === 'toggle' ? { type: 'enabled' }
    : reasoning.mode === 'budget'
      ? { type: 'enabled', budget_tokens: Math.min(reasoning.tokens, request.maxOutputTokens - 1) }
      : { type: 'adaptive' }
  const messages = request.messages.map(({ role, content }) => {
    if (typeof content === 'string') return { role, content }
    // Tool results come first in a user turn. Local-only transcript fields stay local.
    const results: JsonObject[] = []
    const rest: JsonObject[] = []
    for (const block of content) {
      const serialized = serializeBlock(block)
      if (!serialized) continue
      const destination = role === 'user' && block.type === 'tool_result' ? results : rest
      destination.push(serialized)
    }
    return { role, content: [...results, ...rest] }
  })
  return {
    model: request.model,
    messages,
    max_tokens: request.maxOutputTokens,
    stream,
    system: request.system?.length ? request.system.map(block => ({ type: 'text', ...block })) : undefined,
    tools: request.tools?.length
      ? request.tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }))
      : undefined,
    tool_choice: request.toolChoice,
    temperature: profile?.thinking === 'always' || (thinking && thinking.type !== 'disabled') ? undefined : request.temperature,
    stop_sequences: request.stopSequences,
    thinking,
    output_config: effort || request.outputFormat ? { effort, format: request.outputFormat } : undefined,
    metadata: request.userId === undefined ? undefined : { user_id: request.userId },
  }
}

function channelError(status: number, body: unknown, headers: Headers, key: string): APIError {
  if (status === 401 || status === 403) return new AuthenticationError(status, headers)
  const detail = record(body) && record(body.error) ? body.error : body
  const message = record(detail) && typeof detail.message === 'string'
    ? detail.message.split(key).join('[redacted]') : `Model service returned HTTP ${status}`
  const type = record(detail) && typeof detail.type === 'string' && !detail.type.includes(key)
    ? detail.type : 'api_error'
  return new APIError(status, { error: { type, message } }, message, headers)
}

function stopReason(value: unknown): AssistantMessage['stop_reason'] {
  switch (value) {
    case 'tool_calls': return 'tool_use'
    case 'stop': return 'end_turn'
    case 'length': return 'max_tokens'
    case 'end_turn': case 'tool_use': case 'stop_sequence': case 'max_tokens': case 'refusal':
    case 'pause_turn': case 'compaction': case 'model_context_window_exceeded': return value
    default: return null
  }
}

function usage(value: unknown): Usage {
  if (!record(value)) return { input_tokens: 0, output_tokens: 0 }
  return {
    ...value,
    input_tokens: typeof value.input_tokens === 'number' ? value.input_tokens : 0,
    output_tokens: typeof value.output_tokens === 'number' ? value.output_tokens : 0,
  }
}

function assistantMessage(value: unknown, model: string): AssistantMessage {
  if (!record(value) || value.type !== 'message' || value.role !== 'assistant' || !Array.isArray(value.content)) {
    throw new Error('Invalid Messages response: expected an assistant message')
  }
  return {
    ...value,
    id: typeof value.id === 'string' ? value.id : randomUUID(),
    type: 'message', role: 'assistant',
    model: typeof value.model === 'string' ? value.model : model,
    content: value.content as ContentBlock[],
    stop_reason: stopReason(value.stop_reason),
    stop_sequence: typeof value.stop_sequence === 'string' ? value.stop_sequence : null,
    usage: usage(value.usage),
  }
}

/** UTF-8 and CRLF can both span packets. Blank lines delimit SSE records. */
async function* eventData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let data: string[] = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let start = 0
      for (let i = 0; i < buffer.length; i++) {
        const ch = buffer[i]
        if (ch !== '\r' && ch !== '\n') continue
        if (ch === '\r' && i + 1 === buffer.length && !done) break
        const line = buffer.slice(start, i)
        if (ch === '\r' && buffer[i + 1] === '\n') i++
        start = i + 1
        if (line === '') {
          if (data.length) { yield data.join('\n'); data = [] }
        } else if (line.startsWith('data:')) {
          data.push(line.slice(line.startsWith('data: ') ? 6 : 5))
        }
      }
      buffer = buffer.slice(start)
      if (done) {
        if (buffer.startsWith('data:')) data.push(buffer.slice(buffer.startsWith('data: ') ? 6 : 5))
        if (data.length) yield data.join('\n')
        return
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

const errorStatuses: Record<string, number> = {
  authentication_error: 401, billing_error: 402, permission_error: 403,
  invalid_request_error: 400, not_found_error: 404, rate_limit_error: 429, overloaded_error: 529,
}

async function* streamEvents(response: Response, model: string, key: string, onMessage: (id: string) => void): AsyncGenerator<StreamEvent> {
  if (!response.body) throw new APIConnectionError('Model service returned an empty stream')
  let started = false
  for await (const data of eventData(response.body)) {
    const event: unknown = JSON.parse(data)
    if (!record(event)) throw new Error('Invalid Messages stream event')
    if (event.type === undefined && record(event.error)) {
      throw channelError(500, event, response.headers, key)
    }
    switch (event.type) {
      case 'error': {
        const type = record(event.error) && typeof event.error.type === 'string' ? event.error.type : ''
        throw channelError(errorStatuses[type] ?? 500, event, response.headers, key)
      }
      case 'message_start': {
        const message = assistantMessage(event.message, model)
        started = true
        onMessage(message.id)
        yield { type: 'message_start', message }
        break
      }
      case 'content_block_start':
      case 'content_block_delta':
      case 'content_block_stop':
        if (!started || typeof event.index !== 'number') throw new Error('Invalid Messages content event')
        yield event as StreamEvent
        break
      case 'message_delta':
        if (!started || !record(event.delta)) throw new Error('Invalid Messages update')
        yield {
          type: 'message_delta', usage: usage(event.usage),
          delta: { ...event.delta, stop_reason: stopReason(event.delta.stop_reason) },
        }
        break
      case 'message_stop':
        if (!started) throw new Error('Missing Messages stream start')
        yield { type: 'message_stop' }
        return
    }
  }
  throw new APIConnectionError('Model service closed its stream before completion')
}

export function createMessagesAdapter({ baseURL, apiKey, fetch: transport = globalThis.fetch }: ChannelConnection): ProviderAdapter {
  const url = normalizeMessagesBaseURL(baseURL) + '/messages'
  const dialect = getOfficialReasoningDialect('messages', baseURL)
  const authHeaders = dialect === 'kimi' || dialect === 'mimo'
    ? { authorization: `Bearer ${apiKey}` } : messagesHeaders(apiKey)
  let parentMessageId: string | undefined
  async function send(body: ReturnType<typeof serializeMessages>, signal?: AbortSignal) {
    const headers = new Headers({ ...authHeaders, 'content-type': 'application/json',
      accept: body.stream ? 'text/event-stream' : 'application/json' })
    const conversationId = process.env.NEXUS_CONVERSATION_ID || process.env.X_CONVERSATION_ID
    if (conversationId && new URL(url).hostname !== 'api.anthropic.com') {
      headers.set('X-Conversation-ID', conversationId)
      headers.set('X-Message-ID', randomUUID())
      if (parentMessageId) headers.set('X-Parent-Message-ID', parentMessageId)
    }
    let response: Response
    try {
      response = await transport(url, { method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error' })
    } catch (cause) {
      if (signal?.aborted) throw new APIUserAbortError()
      throw new APIConnectionError('Could not connect to the model service', cause)
    }
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw channelError(response.status, error, response.headers, apiKey)
    }
    return response
  }

  return {
    async generateText(request, signal) {
      const response = await send(serializeMessages(request, false, baseURL), signal)
      try {
        const message = assistantMessage(await response.json(), request.model)
        parentMessageId = message.id
        return { data: message, requestId: response.headers.get('request-id') ?? response.headers.get('x-request-id') ?? message.id,
          response: { status: response.status, headers: response.headers } }
      } catch (error) {
        if (signal?.aborted) throw new APIUserAbortError()
        throw error
      }
    },
    async streamText(request, outerSignal) {
      const body = serializeMessages(request, true, baseURL)
      const controller = new AbortController()
      const signal = outerSignal ? AbortSignal.any([outerSignal, controller.signal]) : controller.signal
      const headers = captureStreamMetadata(signal)
      const response = send(body, signal)
      void response.then(headers.receive, headers.fail)
      return {
        controller, metadata: headers.metadata,
        async *[Symbol.asyncIterator]() {
          try {
            yield* streamEvents(await response, request.model, apiKey, id => { parentMessageId = id })
          } catch (error) {
            if (signal.aborted) throw new APIUserAbortError()
            throw error
          }
        },
      }
    },
  }
}
