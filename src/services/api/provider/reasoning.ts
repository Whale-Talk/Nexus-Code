import type { ProviderKind } from './catalog.js'
import type { ModelRequest } from './types.js'

export const reasoningDialects = ['deepseek', 'glm', 'kimi', 'mimo'] as const
export type ReasoningDialect = (typeof reasoningDialects)[number]
export type ReasoningEffortLevel = NonNullable<ModelRequest['effort']>

export interface ReasoningProfile {
  thinking: 'toggle' | 'always'
  effortLevels?: readonly ReasoningEffortLevel[]
  defaultEffort?: ReasoningEffortLevel
}

const threeLevels = ['low', 'high', 'max'] as const
const highLevels = ['high', 'max'] as const

export function getOfficialReasoningDialect(protocol: ProviderKind, baseURL: string): ReasoningDialect | undefined {
  let url: URL
  try {
    url = new URL(baseURL)
  } catch {
    return undefined
  }
  if (url.username || url.password || url.search || url.hash) return undefined
  const path = url.pathname.replace(/\/+$/, '')
  const messages = protocol === 'messages'
  switch (url.origin) {
    case 'https://api.deepseek.com':
      if ((messages ? ['/anthropic', '/anthropic/v1'] : ['', '/v1']).includes(path)) return 'deepseek'
      break
    case 'https://open.bigmodel.cn':
    case 'https://api.z.ai':
      if ((messages ? ['/api/anthropic', '/api/anthropic/v1'] : ['/api/paas/v4', '/api/coding/paas/v4']).includes(path)) return 'glm'
      break
    case 'https://api.moonshot.ai':
    case 'https://api.moonshot.cn':
      if ((messages ? ['/anthropic', '/anthropic/v1'] : ['', '/v1']).includes(path)) return 'kimi'
      break
    case 'https://api.xiaomimimo.com':
    case 'https://token-plan-cn.xiaomimimo.com':
    case 'https://token-plan-sgp.xiaomimimo.com':
    case 'https://token-plan-ams.xiaomimimo.com':
      if ((messages ? ['/anthropic', '/anthropic/v1'] : ['', '/v1']).includes(path)) return 'mimo'
      break
  }
}

export function getReasoningProfile(
  protocol: ProviderKind,
  baseURL: string,
  model: string,
  configured?: ReasoningDialect,
): ReasoningProfile | undefined {
  const dialect = getOfficialReasoningDialect(protocol, baseURL) ?? configured
  const id = model.toLowerCase()
  switch (dialect) {
    case 'deepseek':
      if (/^deepseek-(?:v4-pro|(?:v4-)?flash)(?:\[1m\])?$/.test(id)) {
        return { thinking: 'toggle', effortLevels: threeLevels, defaultEffort: 'high' }
      }
      break
    case 'glm':
      if (/^glm-5\.3(?:-flashx?)?$/.test(id)) {
        // GLM documents request-level controls for Chat Completions.
        return protocol === 'messages' ? { thinking: 'always' }
          : { thinking: 'always', effortLevels: threeLevels, defaultEffort: 'max' }
      }
      if (protocol === 'messages') break
      if (id === 'glm-5.2') return { thinking: 'toggle', effortLevels: highLevels, defaultEffort: 'max' }
      if (/^glm-(?:5(?:\.1|-turbo|v-turbo)?|4\.[567](?:-flashx?|v)?)$/.test(id)) {
        return { thinking: 'toggle' }
      }
      break
    case 'kimi':
      if (/^kimi-k3(?:\.1-pro(?:-highspeed)?)?$/.test(id)) {
        return { thinking: 'always', effortLevels: threeLevels, defaultEffort: 'max' }
      }
      if (protocol === 'messages') break
      if (/^kimi-k2(?:-thinking(?:-turbo)?|\.7-code(?:-highspeed)?)$/.test(id)) return { thinking: 'always' }
      if (id === 'kimi-k2.6') return { thinking: 'toggle' }
      break
    case 'mimo':
      if (/^mimo-v2\.6-(?:flash|pro(?:-ultraspeed)?)$/.test(id)) return { thinking: 'toggle' }
      break
  }
}

export function clampReasoningEffort(
  requested: string,
  supported: readonly ReasoningEffortLevel[],
): ReasoningEffortLevel | undefined {
  const order = ['low', 'medium', 'high', 'max']
  const desired = order.includes(requested) ? requested : 'high'
  return supported.find(level => order.indexOf(level) >= order.indexOf(desired)) ?? supported.at(-1)
}

export function getWireReasoningEffort(
  profile: ReasoningProfile | undefined,
  request: ModelRequest,
): ReasoningEffortLevel | undefined {
  if (!request.effort || (request.reasoning?.mode === 'off' && profile?.thinking !== 'always')) return undefined
  return profile ? clampReasoningEffort(request.effort, profile.effortLevels ?? []) : request.effort
}
