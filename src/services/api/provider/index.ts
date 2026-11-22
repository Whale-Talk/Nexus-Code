import { getModelCatalog, requireCatalogModel, type ProviderKind } from './catalog.js'
import { createMessagesAdapter } from './implementations/messages.js'
import { createOpenAICompatibleAdapter } from './implementations/openai-compatible.js'
import { getWireContextModelId } from './modelContext.js'
import type { ProviderAdapter } from './types.js'

export type { ModelRequest, StreamEvent, StreamResponse, ProviderAdapter, ModelResponse } from './types.js'
export {
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  AuthenticationError,
  NotFoundError,
} from './errors.js'

export type { ProviderKind } from './catalog.js'

type Connection = { protocol: ProviderKind; baseURL: string; apiKey?: string }
const adapters = new Map<string, Connection & { adapter: ProviderAdapter }>()

// Per-response routing metadata survives the in-memory message spreads. JSON transcripts omit symbols.
export type RequestRoute = Readonly<{ origin: string; channel?: string; keyVariable?: string }>
const routeTag = Symbol('request route')
export function tagResponseRoute(message: object, route: RequestRoute): void {
  Object.assign(message, { [routeTag]: route })
}
export function responseRoute(message: object | undefined): RequestRoute | undefined {
  return (message as { [routeTag]?: RequestRoute } | undefined)?.[routeTag]
}

function singleChannelKeyVariable(): string {
  return process.env.NEXUS_PROVIDER === 'openai-compatible' && process.env.NEXUS_AUTH_TOKEN
    ? 'NEXUS_AUTH_TOKEN' : 'NEXUS_API_KEY'
}

/** An auxiliary API may reuse a credential only at the origin that actually served this turn.
 * Re-check its current binding after tool approval, in case the user edited the channel meanwhile. */
export function keyForRequestOrigin(route: RequestRoute | undefined, origin: string): string | undefined {
  if (!route?.keyVariable || route.origin !== origin) return undefined
  const catalog = getModelCatalog()
  const channel = route.channel ? catalog?.config.channels[route.channel] : undefined
  if (route.channel ? !channel : Boolean(catalog)) return undefined
  const baseURL = channel?.baseURL ?? process.env.NEXUS_BASE_URL
  const variable = channel ? channel.apiKeyEnv : singleChannelKeyVariable()
  if (!baseURL || new URL(baseURL).origin !== origin || variable !== route.keyVariable) return undefined
  return process.env[route.keyVariable]?.trim() || undefined
}

export function resolveProviderRoute(model: string, legacyApiKeyOverride?: string) {
  const catalog = getModelCatalog()
  if (catalog) {
    const selected = requireCatalogModel(model)
    const channel = catalog.config.channels[selected.channel]!
    const apiKey = channel.apiKeyEnv ? process.env[channel.apiKeyEnv]?.trim() : undefined
    if (channel.apiKeyEnv && !apiKey) {
      throw new Error(`渠道 ${selected.channel} 缺少环境变量 ${channel.apiKeyEnv}`)
    }
    return {
      source: { origin: new URL(channel.baseURL).origin, channel: selected.channel, keyVariable: channel.apiKeyEnv },
      adapter: adapterFor(selected.channel, { protocol: channel.protocol, baseURL: channel.baseURL, apiKey }),
      model: getWireContextModelId(channel, selected.id),
      reasoningDialect: selected.reasoningDialect,
    }
  }

  const protocol = process.env.NEXUS_PROVIDER ?? 'messages'
  if (protocol !== 'messages' && protocol !== 'openai-compatible') {
    throw new Error('NEXUS_PROVIDER 只支持 messages 或 openai-compatible')
  }
  const baseURL = process.env.NEXUS_BASE_URL?.trim()
  if (!baseURL) throw new Error('NEXUS_BASE_URL 未设置，请使用 /nexus-config 配置服务地址')
  const keyVariable = singleChannelKeyVariable()
  const apiKey = legacyApiKeyOverride ?? process.env[keyVariable]
  return { adapter: adapterFor('', { protocol, baseURL, apiKey }), model: getWireContextModelId({ protocol, baseURL }, model), reasoningDialect: undefined,
    source: { origin: new URL(baseURL).origin, keyVariable: legacyApiKeyOverride === undefined ? keyVariable : undefined } }
}

function adapterFor(channel: string, connection: Connection): ProviderAdapter {
  const cached = adapters.get(channel)
  if (cached && cached.protocol === connection.protocol &&
    cached.baseURL === connection.baseURL && cached.apiKey === connection.apiKey) {
    return cached.adapter
  }
  const { protocol, baseURL, apiKey } = connection
  if (protocol === 'messages' && !apiKey) {
    throw new Error(channel ? `请为渠道 ${channel} 配置 apiKeyEnv` : 'NEXUS_API_KEY 未设置')
  }
  const adapter = protocol === 'messages'
    ? createMessagesAdapter({ baseURL, apiKey: apiKey! })
    : createOpenAICompatibleAdapter({ baseURL, apiKey, name: channel || 'openai-compatible' })
  adapters.set(channel, { ...connection, adapter })
  return adapter
}
