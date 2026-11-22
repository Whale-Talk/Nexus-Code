import type { Usage } from '../services/api/provider/types.js'
import { getCatalogModel } from '../services/api/provider/catalog.js'
import { setHasUnknownModelCost } from '../bootstrap/state.js'

export type ModelCosts = {
  inputTokens: number
  outputTokens: number
  promptCacheWriteTokens: number
  promptCacheReadTokens: number
  webSearchRequests: number
}

function tokensToUSDCost(modelCosts: ModelCosts, usage: Usage): number {
  return (
    (usage.input_tokens / 1_000_000) * modelCosts.inputTokens +
    (usage.output_tokens / 1_000_000) * modelCosts.outputTokens +
    ((usage.cache_read_input_tokens ?? 0) / 1_000_000) *
      modelCosts.promptCacheReadTokens +
    ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) *
      modelCosts.promptCacheWriteTokens +
    (usage.server_tool_use?.web_search_requests ?? 0) *
      modelCosts.webSearchRequests
  )
}

/** Prices belong to the configured channel/model pair. Unknown prices are excluded from the total. */
export function getModelCosts(model: string): ModelCosts | undefined {
  const rates = getCatalogModel(model)?.pricing
  if (!rates) return undefined
  return {
    inputTokens: rates.inputTokens,
    outputTokens: rates.outputTokens,
    promptCacheReadTokens: rates.promptCacheReadTokens ?? rates.inputTokens,
    promptCacheWriteTokens: rates.promptCacheWriteTokens ?? rates.inputTokens,
    webSearchRequests: rates.webSearchRequests ?? 0,
  }
}

export function calculateUSDCost(resolvedModel: string, usage: Usage): number {
  const costs = getModelCosts(resolvedModel)
  if (costs) return tokensToUSDCost(costs, usage)
  setHasUnknownModelCost()
  return 0
}

/**
 * Calculate cost from raw token counts without requiring a full Usage object.
 * Useful for side queries (e.g. classifier) that track token counts independently.
 */
export function calculateCostFromTokens(
  model: string,
  tokens: {
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
  },
): number {
  const usage: Usage = {
    input_tokens: tokens.inputTokens,
    output_tokens: tokens.outputTokens,
    cache_read_input_tokens: tokens.cacheReadInputTokens,
    cache_creation_input_tokens: tokens.cacheCreationInputTokens,
  } as Usage
  return calculateUSDCost(model, usage)
}

function formatPrice(price: number): string {
  // Format price: integers without decimals, others with 2 decimal places
  // e.g., 3 -> "$3", 0.8 -> "$0.80", 22.5 -> "$22.50"
  if (Number.isInteger(price)) {
    return `$${price}`
  }
  return `$${price.toFixed(2)}`
}

/**
 * Format model costs as a pricing string for display
 * e.g., "$3/$15 per Mtok"
 */
export function formatModelPricing(costs: ModelCosts): string {
  return `${formatPrice(costs.inputTokens)}/${formatPrice(costs.outputTokens)} per Mtok`
}

/**
 * Get formatted pricing string for a model
 * Accepts either a short name or full model name
 * Returns undefined if model is not found
 */
export function getModelPricingString(model: string): string | undefined {
  const costs = getModelCosts(model)
  return costs && formatModelPricing(costs)
}
