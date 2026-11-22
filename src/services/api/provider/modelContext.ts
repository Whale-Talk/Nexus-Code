import { getCatalogModel, getModelCatalog, type ChannelConnection } from './catalog.js'
import type { ModelDirectoryEntry } from './listModels.js'
import { getOfficialModelService, type OfficialModelService } from './officialChannels.js'

const binary1m = 1_048_576
const binary256k = 262_144
const kimiAccountModels = new Set(['k3', 'k3.1-pro'])
const legacyContextSuffix = /\[1m\]$/i
const documentedLimits: Partial<Record<OfficialModelService, Record<string, {
  contextWindow: number
  maxOutputTokens?: number
}>>> = {
  minimax: {
    'minimax-m3.1-flash': { contextWindow: 1_000_000, maxOutputTokens: 524_288 },
    'minimax-m3': { contextWindow: 1_000_000, maxOutputTokens: 524_288 },
  },
  qwen: {
    'qwen4-max': { contextWindow: 1_000_000 },
    'qwen3.8-flash': { contextWindow: 1_000_000, maxOutputTokens: 131_072 },
  },
  doubao: {
    'doubao-seed-2-1-pro-260915': { contextWindow: binary1m, maxOutputTokens: binary256k },
    'doubao-seed-2-1-lite-260915': { contextWindow: binary1m, maxOutputTokens: binary256k },
    'doubao-seed-2-1-turbo-260628': { contextWindow: binary256k, maxOutputTokens: binary256k },
  },
  stepfun: { 'step-3.7-flash': { contextWindow: binary256k } },
}

function documentedModelLimits(service: OfficialModelService, model: string) {
  const id = model.toLowerCase().replace(legacyContextSuffix, '')
  const models = documentedLimits[service]
  return models && Object.hasOwn(models, id) ? models[id] : undefined
}

export function getDocumentedContextWindow(service: OfficialModelService, model: string): number | undefined {
  const id = model.toLowerCase().replace(legacyContextSuffix, '')
  switch (service) {
    case 'deepseek':
      if (/^deepseek-(?:v4-pro|flash|v4-flash(?:-vision-exp)?)$/.test(id)) return 1_000_000
      break
    case 'glm':
      if (/^glm-5\.(?:2|3(?:-flash(?:x(?:-legal)?)?)?)$/.test(id)) return 1_000_000
      if (/^glm-(?:5(?:\.1|-turbo)?|4\.(?:6|7(?:-flashx?)?))$/.test(id)) return 200_000
      if (/^glm-4\.5(?:-air)?$/.test(id)) return 128_000
      break
    case 'kimi':
      if (/^kimi-k3(?:\.1-pro(?:-highspeed)?)?$/.test(id)) return binary1m
      if (/^kimi-k2\.(?:6|7-code(?:-highspeed)?)$/.test(id)) return binary256k
      break
    case 'kimi-code':
      if (id === 'k3.1-pro-highspeed' || id === 'kimi-for-coding') return binary1m
      if (kimiAccountModels.has(id) || id === 'k3-256k' || id === 'kimi-for-coding-highspeed') return binary256k
      break
    case 'mimo':
      if (/^mimo-v2\.6-(?:flash|pro(?:-ultraspeed)?)$/.test(id)) return binary1m
      break
    default:
      return documentedModelLimits(service, model)?.contextWindow
  }
}

export function getWireContextModelId(connection: ChannelConnection, model: string): string {
  if (!legacyContextSuffix.test(model)) return model
  const service = getOfficialModelService(connection.protocol, connection.baseURL)
  // Keep literal IDs on relays, including any registered suffix.
  if ((service && getDocumentedContextWindow(service, model) !== undefined) ||
      (/^deepseek-/i.test(model) && URL.canParse(connection.baseURL) &&
        new URL(connection.baseURL).origin === 'https://api.deepseek.com')) {
    return model.replace(legacyContextSuffix, '')
  }
  return model
}

export function getDisplayContextModelId(model: string): string {
  const route = getContextRoute(model)
  return route ? getWireContextModelId(route.connection, route.id) : model
}

function getContextRoute(model: string) {
  const catalog = getModelCatalog()
  if (catalog) {
    const entry = getCatalogModel(model)
    if (!entry) return undefined
    const connection = catalog.config.channels[entry.channel]!
    return { id: entry.id, entry, connection }
  }
  const protocol = process.env.NEXUS_PROVIDER ?? 'messages'
  const baseURL = process.env.NEXUS_BASE_URL?.trim()
  if (!baseURL || (protocol !== 'openai-compatible' && protocol !== 'messages')) return undefined
  const apiKeyEnv = protocol === 'openai-compatible' && process.env.NEXUS_AUTH_TOKEN
    ? 'NEXUS_AUTH_TOKEN' : 'NEXUS_API_KEY'
  const connection: ChannelConnection = { protocol, baseURL, apiKeyEnv }
  return { id: model, entry: undefined, connection }
}

type AccountDirectory = {
  apiKey: string
  validUntil: number
  models?: Map<string, ModelDirectoryEntry>
  loading?: Promise<void>
}
const accountDirectories = new Map<string, AccountDirectory>()

function accountDirectoryKey(connection: ChannelConnection): string {
  return JSON.stringify([connection.protocol, connection.baseURL, connection.apiKeyEnv])
}

function accountApiKey(connection: ChannelConnection): string | undefined {
  return connection.apiKeyEnv ? process.env[connection.apiKeyEnv]?.trim() || undefined : undefined
}

function getAccountModel(connection: ChannelConnection, id: string): ModelDirectoryEntry | undefined {
  const directory = accountDirectories.get(accountDirectoryKey(connection))
  if (directory && directory.apiKey === accountApiKey(connection)) {
    return directory.models?.get(id.replace(legacyContextSuffix, ''))
  }
}

export type KnownContextSource = 'manual' | 'channel' | 'official'

export function getKnownContextLimit(model: string): { contextWindow: number; contextSource: KnownContextSource } | undefined {
  const route = getContextRoute(model)
  if (!route) return undefined
  const { connection, entry, id } = route
  if (entry?.contextWindow !== undefined) return { contextWindow: entry.contextWindow, contextSource: 'manual' }
  const service = getOfficialModelService(connection.protocol, connection.baseURL)
  // A saved discovery may belong to a different subscription after a key change.
  const discovered = service === 'kimi-code' && kimiAccountModels.has(id.replace(legacyContextSuffix, ''))
    ? getAccountModel(connection, id)?.contextWindow : entry?.discoveredContextWindow
  if (discovered !== undefined) return { contextWindow: discovered, contextSource: 'channel' }
  const documented = service && getDocumentedContextWindow(service, id)
  if (documented !== undefined) return { contextWindow: documented, contextSource: 'official' }
}

export function getKnownContextWindow(model: string): number | undefined {
  return getKnownContextLimit(model)?.contextWindow
}

export function getKnownOutputLimit(model: string): number | undefined {
  const route = getContextRoute(model)
  if (!route) return undefined
  const { connection, entry, id } = route
  if (entry?.maxOutputTokens !== undefined) return entry.maxOutputTokens
  const service = getOfficialModelService(connection.protocol, connection.baseURL)
  if (service === 'kimi-code' && kimiAccountModels.has(id.replace(legacyContextSuffix, ''))) {
    return getAccountModel(connection, id)?.maxOutputTokens
  }
  return entry?.discoveredMaxOutputTokens ?? (service && documentedModelLimits(service, id)?.maxOutputTokens)
}

/** Some Kimi Code IDs share a name across accounts with different limits. */
export async function loadAccountContextWindow(model: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  const route = getContextRoute(model)
  if (!route || route.entry?.contextWindow !== undefined) return
  const { connection, id } = route
  if (!kimiAccountModels.has(id.replace(legacyContextSuffix, '')) ||
      getOfficialModelService(connection.protocol, connection.baseURL) !== 'kimi-code') return
  const apiKey = accountApiKey(connection)
  if (!apiKey) return

  const key = accountDirectoryKey(connection)
  const cached = accountDirectories.get(key)
  if (cached?.apiKey === apiKey) {
    if (cached.loading) return cached.loading
    if (cached.validUntil > Date.now()) return
  }
  const current: AccountDirectory = { apiKey, validUntil: 0 }
  accountDirectories.set(key, current)
  current.loading = (async () => {
    try {
      const { fetchChannelModels } = await import('./listModels.js')
      const models = await fetchChannelModels(connection, AbortSignal.timeout(3_000), apiKey)
      current.models = new Map(models.map(entry => [entry.id, entry]))
      current.validUntil = Date.now() + 10 * 60_000
    } catch {
      current.validUntil = Date.now() + 60_000
    } finally {
      current.loading = undefined
    }
  })()
  await current.loading
}
