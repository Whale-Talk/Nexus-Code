import { getCatalogModel } from '../services/api/provider/catalog.js'
import { getKnownContextWindow } from '../services/api/provider/modelContext.js'
import { isEnvTruthy } from './envUtils.js'

// Conservative working defaults for a channel without declared limits.
export const MODEL_CONTEXT_WINDOW_DEFAULT = 200_000

// Maximum output tokens for compact operations
export const COMPACT_MAX_OUTPUT_TOKENS = 20_000

// Default max output tokens
const MAX_OUTPUT_TOKENS_DEFAULT = 32_000
const MAX_OUTPUT_TOKENS_UPPER_LIMIT = 64_000

// Capped default for slot-reservation optimization. BQ p99 output = 4,911
// tokens, so 32k/64k defaults over-reserve 8-16× slot capacity. With the cap
// enabled, <1% of requests hit the limit; those get one clean retry at 64k
// (see query.ts max_output_tokens_escalate). Cap is applied in
// nexus.ts:getMaxOutputTokensForModel to avoid the growthbook→betas→context
// import cycle.
export const CAPPED_DEFAULT_MAX_TOKENS = 8_000
export const ESCALATED_MAX_TOKENS = 64_000

export function is1mContextDisabled(): boolean {
  return isEnvTruthy(process.env.NEXUS_DISABLE_1M_CONTEXT)
}

export function has1mContext(model: string): boolean {
  return !is1mContextDisabled() && /\[1m\]$/i.test(model)
}

export function modelSupports1M(model: string): boolean {
  return getContextWindowForModel(model) >= 1_000_000
}

export function getContextWindowForModel(model: string, _betas?: string[]): number {
  const known = getKnownContextWindow(model)
  const override = Number(process.env.NEXUS_MAX_CONTEXT_TOKENS)
  const limit = known ?? (has1mContext(model) ? 1_000_000 : MODEL_CONTEXT_WINDOW_DEFAULT)
  const enabledLimit = is1mContextDisabled() ? Math.min(limit, MODEL_CONTEXT_WINDOW_DEFAULT) : limit
  return Number.isSafeInteger(override) && override > 0 ? Math.min(enabledLimit, override) : enabledLimit
}

/**
 * Calculate context window usage percentage from token usage data.
 * Returns used and remaining percentages, or null values if no usage data.
 */
export function calculateContextPercentages(
  currentUsage: {
    input_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  } | null,
  contextWindowSize: number,
): { used: number | null; remaining: number | null } {
  if (!currentUsage) {
    return { used: null, remaining: null }
  }

  const totalInputTokens =
    currentUsage.input_tokens +
    currentUsage.cache_creation_input_tokens +
    currentUsage.cache_read_input_tokens

  const usedPercentage = Math.round(
    (totalInputTokens / contextWindowSize) * 100,
  )
  const clampedUsed = Math.min(100, Math.max(0, usedPercentage))

  return {
    used: clampedUsed,
    remaining: 100 - clampedUsed,
  }
}

/**
 * Returns the model's default and upper limit for max output tokens.
 */
export function getModelMaxOutputTokens(model: string): {
  default: number
  upperLimit: number
} {
  const window = getContextWindowForModel(model)
  const configuredLimit = getCatalogModel(model)?.maxOutputTokens ?? MAX_OUTPUT_TOKENS_UPPER_LIMIT
  const upperLimit = Math.min(configuredLimit, Math.max(1, window - 1))
  // Keep room for the prompt when a local or relay model advertises a small context.
  const defaultLimit = Math.min(upperLimit, MAX_OUTPUT_TOKENS_DEFAULT, Math.max(1, Math.floor(window / 4)))
  return { default: defaultLimit, upperLimit }
}

/**
 * Returns the max thinking budget tokens for a given model. The max
 * thinking tokens should be strictly less than the max output tokens.
 *
 * Deprecated since newer models use adaptive thinking rather than a
 * strict thinking token budget.
 */
export function getMaxThinkingTokensForModel(model: string): number {
  return getModelMaxOutputTokens(model).upperLimit - 1
}
