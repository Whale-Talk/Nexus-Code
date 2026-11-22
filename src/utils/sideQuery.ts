import type {
  AssistantMessage,
  JSONOutputFormat,
  MessageParam,
  ModelRequest,
  TextContentBlock,
  ToolChoice,
  ToolDefinition,
} from '../services/api/provider/types.js'
import {
  getLastApiCompletionTimestamp,
  setLastApiCompletionTimestamp,
} from '../bootstrap/state.js'
import type { QuerySource } from '../constants/querySource.js'
import {
  getCLISyspromptPrefix,
} from '../constants/system.js'
import { logEvent } from '../services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../services/analytics/metadata.js'
import { getRequestUserId } from '../services/api/inference.js'
import { resolveProviderRoute } from '../services/api/provider/index.js'
import { withRetry } from '../services/api/withRetry.js'
import { returnValue } from './generators.js'
import { normalizeModelStringForAPI } from './model/model.js'

export type SideQueryOptions = {
  /** Model to use for the query */
  model: string
  /**
   * System prompt. Arrays retain per-block cache hints.
   */
  system?: string | TextContentBlock[]
  /** Messages to send (supports cache_control on content blocks) */
  messages: MessageParam[]
  /** Optional tools (client tools available to this query) */
  tools?: ToolDefinition[]
  /** Optional tool choice (use { type: 'tool', name: 'x' } for forced output) */
  tool_choice?: ToolChoice
  /** Optional JSON output format for structured responses */
  output_format?: JSONOutputFormat
  /** Max tokens (default: 1024) */
  max_tokens?: number
  /** Max retries (default: 2) */
  maxRetries?: number
  /** Abort signal */
  signal?: AbortSignal
  /** Skip CLI system prompt prefix (keeps attribution header for OAuth). For internal classifiers that provide their own prompt. */
  skipSystemPromptPrefix?: boolean
  /** Temperature override */
  temperature?: number
  /** Thinking budget (enables thinking), or `false` to send `{ type: 'disabled' }`. */
  thinking?: number | false
  /** Stop sequences — generation stops when any of these strings is emitted */
  stop_sequences?: string[]
  /** Attributes this call in nexus_api_success for COGS joining against reporting.sampling_calls. */
  querySource: QuerySource
}

/**
 * Lightweight API wrapper for "side queries" outside the main conversation loop.
 *
 * Uses the same channel as a normal request for the selected model.
 *
 * @example
 * // Permission explainer
 * await sideQuery({ querySource: 'permission_explainer', model, system: SYSTEM_PROMPT, messages, tools, tool_choice })
 *
 * @example
 * // Session search
 * await sideQuery({ querySource: 'session_search', model, system: SEARCH_PROMPT, messages })
 *
 * @example
 * // Model validation
 * await sideQuery({ querySource: 'model_validation', model, max_tokens: 1, messages: [{ role: 'user', content: 'Hi' }] })
 */
export async function sideQuery(opts: SideQueryOptions): Promise<AssistantMessage> {
  const {
    model,
    system,
    messages,
    tools,
    tool_choice,
    output_format,
    max_tokens = 1024,
    maxRetries = 2,
    signal,
    skipSystemPromptPrefix,
    temperature,
    thinking,
    stop_sequences,
  } = opts

  const systemBlocks: TextContentBlock[] = [
    // Skip CLI system prompt prefix for internal classifiers that provide their own prompt
    ...(skipSystemPromptPrefix
      ? []
      : [
          {
            type: 'text' as const,
            text: getCLISyspromptPrefix({
              isNonInteractive: false,
              hasAppendSystemPrompt: false,
            }),
          },
        ]),
    ...(Array.isArray(system)
      ? system
      : system
        ? [{ type: 'text' as const, text: system }]
        : []),
  ].filter((block): block is TextContentBlock => block !== null)

  const reasoning: ModelRequest['reasoning'] = thinking === false
    ? { mode: 'off' }
    : thinking === undefined ? undefined : { mode: 'budget', tokens: Math.min(thinking, max_tokens - 1) }

  const normalizedModel = normalizeModelStringForAPI(model)
  const start = Date.now()
  const request: ModelRequest = {
    model: normalizedModel, messages, system: systemBlocks,
    maxOutputTokens: max_tokens, reasoning, temperature, tools,
    toolChoice: tool_choice, outputFormat: output_format, stopSequences: stop_sequences,
    userId: getRequestUserId(),
  }
  const route = resolveProviderRoute(normalizedModel)
  const result = await returnValue(withRetry(
    async () => route.adapter,
    adapter => adapter.generateText({ ...request, model: route.model }, signal),
    {
      model,
      maxRetries,
      signal,
      thinkingConfig: reasoning?.mode === 'budget'
        ? { type: 'enabled', budgetTokens: reasoning.tokens }
        : { type: 'disabled' },
    },
  ))
  const response = result.data
  const requestId = result.requestId
  const now = Date.now()
  const lastCompletion = getLastApiCompletionTimestamp()
  logEvent('nexus_api_success', {
    requestId:
      requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    querySource:
      opts.querySource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    model:
      normalizedModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cachedInputTokens: response.usage.cache_read_input_tokens ?? 0,
    uncachedInputTokens: response.usage.cache_creation_input_tokens ?? 0,
    durationMsIncludingRetries: now - start,
    timeSinceLastApiCallMs:
      lastCompletion !== null ? now - lastCompletion : undefined,
  })
  setLastApiCompletionTimestamp(now)

  return response
}
