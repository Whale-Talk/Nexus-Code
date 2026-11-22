import { feature } from 'bun:bundle'
import { getSdkBetas } from '../bootstrap/state.js'
import {
  BEDROCK_EXTRA_PARAMS_HEADERS,
  CONTEXT_1M_BETA_HEADER,
  CONTEXT_MANAGEMENT_BETA_HEADER,
  INTERLEAVED_THINKING_BETA_HEADER,
  PROMPT_CACHING_SCOPE_BETA_HEADER,
  STRUCTURED_OUTPUTS_BETA_HEADER,
  TOOL_SEARCH_BETA_HEADER_1P,
  TOOL_SEARCH_BETA_HEADER_3P,
} from '../constants/betas.js'
import { getModelCapabilityOverride } from './model/modelSupportOverrides.js'
import { getAPIProvider } from './model/providers.js'
import { isEnvTruthy } from './envUtils.js'

/**
 * SDK-provided betas that are allowed for API key users.
 * Only betas in this list can be passed via SDK options.
 */
const ALLOWED_SDK_BETAS = [CONTEXT_1M_BETA_HEADER]

/**
 * Filter betas to only include those in the allowlist.
 * Returns allowed and disallowed betas separately.
 */
function partitionBetasByAllowlist(betas: string[]): {
  allowed: string[]
  disallowed: string[]
} {
  const allowed: string[] = []
  const disallowed: string[] = []
  for (const beta of betas) {
    if (ALLOWED_SDK_BETAS.includes(beta)) {
      allowed.push(beta)
    } else {
      disallowed.push(beta)
    }
  }
  return { allowed, disallowed }
}

/**
 * Filter SDK betas to only include allowed ones.
 * Warns about disallowed betas and subscriber restrictions.
 * Returns undefined if no valid betas remain or if user is a subscriber.
 */
export function filterAllowedSdkBetas(
  sdkBetas: string[] | undefined,
): string[] | undefined {
  if (!sdkBetas || sdkBetas.length === 0) {
    return undefined
  }

  const { allowed, disallowed } = partitionBetasByAllowlist(sdkBetas)
  for (const beta of disallowed) {
    // biome-ignore lint/suspicious/noConsole: intentional warning
    console.warn(
      `Warning: Beta header '${beta}' is not allowed. Only the following betas are supported: ${ALLOWED_SDK_BETAS.join(', ')}`,
    )
  }
  return allowed.length > 0 ? allowed : undefined
}

export function modelSupportsISP(model: string): boolean {
  return getModelCapabilityOverride(model, 'interleavedThinking') === true
}

export function modelSupportsContextManagement(model: string): boolean {
  return getModelCapabilityOverride(model, 'contextManagement') === true
}

export function modelSupportsStructuredOutputs(model: string): boolean {
  return getModelCapabilityOverride(model, 'structuredOutputs') === true
}

export function modelSupportsAutoMode(model: string): boolean {
  if (feature('TRANSCRIPT_CLASSIFIER')) return getModelCapabilityOverride(model, 'autoMode') === true
  return false
}

export function getToolSearchBetaHeader(): string {
  const provider = getAPIProvider()
  if (provider === 'vertex' || provider === 'bedrock') {
    return TOOL_SEARCH_BETA_HEADER_3P
  }
  return TOOL_SEARCH_BETA_HEADER_1P
}

export function areProtocolExtensionsEnabled(): boolean {
  return !isEnvTruthy(process.env.NEXUS_DISABLE_EXPERIMENTAL_BETAS)
}

export function shouldUseGlobalCacheScope(): boolean {
  return areProtocolExtensionsEnabled() && configuredHeaders().includes(PROMPT_CACHING_SCOPE_BETA_HEADER)
}

function configuredHeaders(): string[] {
  return (process.env.NEXUS_BETAS ?? '').split(',').map(header => header.trim()).filter(Boolean)
}

export function getAllModelBetas(model: string): string[] {
  const flags = configuredHeaders()
  if (areProtocolExtensionsEnabled()) {
    if (modelSupportsISP(model) && !isEnvTruthy(process.env.DISABLE_INTERLEAVED_THINKING)) flags.push(INTERLEAVED_THINKING_BETA_HEADER)
    if (modelSupportsContextManagement(model)) flags.push(CONTEXT_MANAGEMENT_BETA_HEADER)
    if (modelSupportsStructuredOutputs(model)) flags.push(STRUCTURED_OUTPUTS_BETA_HEADER)
  }
  return [...new Set(flags)]
}

export function getModelBetas(model: string): string[] {
  const flags = getAllModelBetas(model)
  return getAPIProvider() === 'bedrock' ? flags.filter(header => !BEDROCK_EXTRA_PARAMS_HEADERS.has(header)) : flags
}

export function getBedrockExtraBodyParamsBetas(model: string): string[] {
  return getAllModelBetas(model).filter(header => BEDROCK_EXTRA_PARAMS_HEADERS.has(header))
}

export function getMergedBetas(model: string): string[] {
  return [...new Set([...getModelBetas(model), ...(getSdkBetas() ?? [])])]
}
