import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import memoize from 'lodash-es/memoize.js'
import { z } from 'zod/v4'
import { getNexusConfigHomeDir } from '../../../utils/envUtils.js'
import { MODEL_ROLES as roles, type ModelRole } from '../../../utils/model/roles.js'
import { updateUserJsonAtomically } from '../../../utils/settings/atomicUserJson.js'
import { getOfficialModelService } from './officialChannels.js'
import { reasoningDialects } from './reasoning.js'

const protocolSchema = z.enum(['messages', 'openai-compatible'])
export type ProviderKind = z.infer<typeof protocolSchema>

const capabilitySchema = z.looseObject({
  thinking: z.boolean().optional(),
  adaptiveThinking: z.boolean().optional(),
  alwaysOnThinking: z.boolean().optional(),
  effort: z.boolean().optional(),
  maxEffort: z.boolean().optional(),
  fastMode: z.boolean().optional(),
  structuredOutputs: z.boolean().optional(),
  contextManagement: z.boolean().optional(),
  autoMode: z.boolean().optional(),
  interleavedThinking: z.boolean().optional(),
  webSearch: z.boolean().optional(),
  advisor: z.boolean().optional(),
  pdf: z.boolean().optional(),
  toolReference: z.boolean().optional(),
})
export type ModelCapability = keyof typeof capabilitySchema.shape

const price = z.number().nonnegative()
const pricingSchema = z.looseObject({
  inputTokens: price,
  outputTokens: price,
  promptCacheWriteTokens: price.optional(),
  promptCacheReadTokens: price.optional(),
  webSearchRequests: price.optional(),
})

export const channelIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
const unsafeTerminalText = /[\p{Cc}\u2028\u2029]/u
const modelLabelSchema = z.string()
  .refine(value => !unsafeTerminalText.test(value), '模型名称不能包含控制字符或换行')
  .pipe(z.string().trim().min(1))
const tokenLimit = z.int().positive().optional()
const modelBudgetOverridesSchema = z.object({ contextWindow: tokenLimit, outputBudget: tokenLimit })
export type ModelBudgetOverrides = z.infer<typeof modelBudgetOverridesSchema>

export const channelSchema = z.looseObject({
  protocol: protocolSchema,
  baseURL: z.string().trim().refine(value => {
    try {
      const url = new URL(value)
      return /^https?:\/\//i.test(value) && !unsafeTerminalText.test(value) &&
        !url.username && !url.password && !url.search && !url.hash
    } catch {
      return false
    }
  }, 'expected an HTTP(S) base URL without credentials, query, or fragment'),
  apiKeyEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
  models: z.array(z.looseObject({
    id: modelLabelSchema,
    name: modelLabelSchema.optional(),
    ...modelBudgetOverridesSchema.shape,
    discoveredContextWindow: tokenLimit,
    maxOutputTokens: tokenLimit,
    discoveredMaxOutputTokens: tokenLimit,
    capabilities: capabilitySchema.optional(),
    reasoningDialect: z.enum(reasoningDialects).optional(),
    pricing: pricingSchema.optional(),
  })).min(1),
})

const catalogSchema = z.looseObject({
  roles: z.looseObject({
    quark: z.string(),
    atom: z.string(),
    electron: z.string(),
  }),
  channels: z.record(channelIdSchema, channelSchema),
})

export type CatalogConfig = z.infer<typeof catalogSchema>
export type ModelChannel = z.infer<typeof channelSchema>
export type ChannelConnection = Pick<ModelChannel, 'protocol' | 'baseURL' | 'apiKeyEnv'>
export type { ModelRole }
export type CatalogModel = ModelChannel['models'][number] & {
  channel: string
  value: string
}

// The wire model ID alone is ambiguous when multiple channels offer the same model.
function indexCatalog(value: unknown, filename: string) {
  const parsed = catalogSchema.safeParse(value)
  if (!parsed.success) {
    const fields = parsed.error.issues.map(issue => issue.path.join('.') || '(根对象)')
    throw new Error(`模型配置 ${filename} 含无效字段 ${[...new Set(fields)].join(', ')}`)
  }
  const config = parsed.data
  const models = new Map<string, CatalogModel>()
  const byId = new Map<string, CatalogModel[]>()
  for (const [channel, settings] of Object.entries(config.channels)) {
    for (const model of settings.models) {
      const value = `${channel}::${model.id}`
      if (models.has(value)) throw new Error(`渠道 ${channel} 内的模型 ID 重复`)
      const entry = { ...model, channel, value }
      models.set(value, entry)
      const matches = byId.get(model.id) ?? []
      matches.push(entry)
      byId.set(model.id, matches)
    }
  }
  for (const role of roles) {
    if (!models.has(config.roles[role])) {
      throw new Error(`模型配置中的 ${role} 必须指向已配置的 channel::model`)
    }
  }
  return { config, models, byId }
}

function readModelCatalog(configDir: string) {
  const filename = join(configDir, 'models.json')
  let text: string
  try {
    text = readFileSync(filename, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error(`无法读取模型配置 ${filename}`, { cause: error })
  }

  let value: unknown
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error(`模型配置 ${filename} 不是有效的 JSON`)
  }
  return indexCatalog(value, filename)
}

export const getModelCatalog = memoize(
  (configDir = getNexusConfigHomeDir()) => readModelCatalog(configDir),
  (configDir = getNexusConfigHomeDir()) => configDir,
)

const deepSeekOfficialModelIds = ['deepseek-v4-pro', 'deepseek-flash'] as const

/** Discover the built-in choices for the official single-channel connection. */
export function getLegacyDeepSeekModelIds(): readonly string[] {
  const baseURL = process.env.NEXUS_BASE_URL?.trim()
  if (!baseURL || !/^https:\/\//i.test(baseURL) || unsafeTerminalText.test(baseURL)) return []
  if (!protocolSchema.safeParse(process.env.NEXUS_PROVIDER ?? 'messages').success) return []
  try {
    const url = new URL(baseURL)
    if (url.origin === 'https://api.deepseek.com' && !url.username && !url.password &&
        !url.search && !url.hash) return deepSeekOfficialModelIds
  } catch {
    // Only valid, exact official URLs have built-in choices.
  }
  return []
}

export function getLegacyModelCatalog(): CatalogConfig {
  const baseURL = process.env.NEXUS_BASE_URL?.trim()
  const model = process.env.NEXUS_MODEL?.trim()
  const quark = process.env.NEXUS_QUARK_MODEL?.trim() || model
  const atom = process.env.NEXUS_ATOM_MODEL?.trim() || model
  const electron = process.env.NEXUS_ELECTRON_MODEL?.trim() || model
  if (!baseURL || !quark || !atom || !electron) {
    return { roles: { quark: '', atom: '', electron: '' }, channels: {} }
  }
  const protocol = protocolSchema.safeParse(process.env.NEXUS_PROVIDER ?? 'messages')
  if (!protocol.success) throw new Error('NEXUS_PROVIDER 只支持 messages 或 openai-compatible')
  let channel = 'current'
  try {
    if (new URL(baseURL).hostname === 'api.deepseek.com') channel = 'deepseek'
  } catch {
    throw new Error('NEXUS_BASE_URL 不是有效的服务地址')
  }
  // Preserve the single-provider adapter's credential precedence. Never copy the secret.
  const apiKeyEnv = protocol.data === 'messages' ? 'NEXUS_API_KEY'
    : process.env.NEXUS_AUTH_TOKEN?.trim() ? 'NEXUS_AUTH_TOKEN'
    : process.env.NEXUS_API_KEY?.trim() ? 'NEXUS_API_KEY'
    : undefined
  const ids = new Set([quark, atom, electron])
  if (model) ids.add(model)
  for (const id of getLegacyDeepSeekModelIds()) ids.add(id)
  return indexCatalog({
    roles: { quark: `${channel}::${quark}`, atom: `${channel}::${atom}`, electron: `${channel}::${electron}` },
    channels: { [channel]: { protocol: protocol.data, baseURL, apiKeyEnv, models: [...ids].map(id => ({ id })) } },
  }, 'settings.json').config
}

// Opening or cancelling the editor must never migrate/write existing settings.
export function getEditableModelCatalog(): CatalogConfig {
  return readModelCatalog(getNexusConfigHomeDir())?.config ?? getLegacyModelCatalog()
}

const catalogListeners = new Set<() => void>()

export function subscribeModelCatalog(onChange: () => void): () => void {
  catalogListeners.add(onChange)
  return () => { catalogListeners.delete(onChange) }
}

function updateCatalog(edit: (config: CatalogConfig, persisted: boolean) => void): CatalogConfig {
  const directory = getNexusConfigHomeDir()
  const filename = join(directory, 'models.json')
  const saved = updateUserJsonAtomically(filename, () => {
    // Merge only the requested change with the latest disk state, including future schema fields.
    const persisted = readModelCatalog(directory)
    const config = persisted?.config ?? getLegacyModelCatalog()
    edit(config, persisted !== undefined)
    return indexCatalog(config, filename).config
  })
  getModelCatalog.cache.delete?.(directory)
  for (const notify of catalogListeners) notify()
  return saved
}

export function saveRoleBinding(role: ModelRole, value: string): CatalogConfig {
  return updateCatalog(config => {
    if (!roles.includes(role)) throw new Error('未知的模型角色')
    config.roles[role] = value
  })
}

export function getChannelsUsingCredential(config: CatalogConfig, variable: string) {
  const normalize = (name?: string) => process.platform === 'win32' ? name?.toUpperCase() : name
  return Object.entries(config.channels)
    .filter(([, other]) => normalize(other.apiKeyEnv) === normalize(variable))
    .map(([name, other]) => ({ id: name, baseURL: other.baseURL }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

export function findCredentialOriginConflict(config: CatalogConfig, variable: string, baseURL: string) {
  const origin = new URL(baseURL).origin
  return getChannelsUsingCredential(config, variable).find(channel => new URL(channel.baseURL).origin !== origin)
}

function validateCredentialOrigin(config: CatalogConfig, connection: ChannelConnection): void {
  if (connection.apiKeyEnv && findCredentialOriginConflict(config, connection.apiKeyEnv, connection.baseURL)) {
    throw new Error('此密钥变量已用于其他服务地址，请为新地址指定独立变量')
  }
}

function isUnconfiguredCatalog(config: CatalogConfig, persisted: boolean): boolean {
  const entries = Object.entries(config.channels)
  if (!entries.length) return roles.every(role => !config.roles[role])
  if (persisted || entries.length !== 1) return false

  const [channelId, channel] = entries[0]!
  if (channelId !== 'deepseek' || getOfficialModelService(channel.protocol, channel.baseURL) !== 'deepseek') return false
  if (channel.apiKeyEnv && process.env[channel.apiKeyEnv]?.trim()) return false

  const quark = config.roles.quark
  return (quark === 'deepseek::deepseek-v4-pro' || quark === 'deepseek::deepseek-v4-pro[1m]') &&
    roles.every(role => config.roles[role] === quark) &&
    channel.models.every(({ id }) => id === 'deepseek-v4-pro[1m]' || deepSeekOfficialModelIds.some(known => known === id))
}

export function isUnconfiguredModelCatalog(config: CatalogConfig): boolean {
  return isUnconfiguredCatalog(config, existsSync(join(getNexusConfigHomeDir(), 'models.json')))
}

export function addModelChannel(
  id: string,
  channel: ModelChannel,
  { initializeRoles = false }: { initializeRoles?: boolean } = {},
): CatalogConfig {
  return updateCatalog((config, persisted) => {
    if (!channelIdSchema.safeParse(id).success) {
      throw new Error('渠道名称须以字母或数字开头，可以包含点、横线或下划线')
    }
    if (initializeRoles) {
      if (!isUnconfiguredCatalog(config, persisted)) throw new Error('模型角色或渠道已配置，请返回渠道列表确认')
      config.channels = {}
    }
    if (Object.hasOwn(config.channels, id)) throw new Error(`渠道 ${id} 已存在`)
    validateCredentialOrigin(config, channel)
    const firstChannel = Object.keys(config.channels).length === 0
    config.channels[id] = channel
    if (firstChannel && channel.models[0]) {
      const first = `${id}::${channel.models[0].id.trim()}`
      config.roles = { ...config.roles, quark: first, atom: first, electron: first }
    }
  })
}

export function updateModelChannelConnection(id: string, expected: ChannelConnection, next: ChannelConnection): CatalogConfig {
  return updateCatalog(config => {
    const channel = Object.hasOwn(config.channels, id) && config.channels[id]
    if (!channel || channel.protocol !== expected.protocol || channel.baseURL !== expected.baseURL ||
        channel.apiKeyEnv !== expected.apiKeyEnv) {
      throw new Error('渠道连接已变更，请返回渠道列表重新打开')
    }
    const parsed = channelSchema.pick({ protocol: true, baseURL: true, apiKeyEnv: true }).safeParse(next)
    if (!parsed.success) throw new Error('渠道协议、地址或密钥变量名无效')
    if (next.protocol === 'messages' && !next.apiKeyEnv) throw new Error('此协议需要密钥环境变量')
    // Include the channel's previous address here. Replacing the origin cannot transfer its old key.
    validateCredentialOrigin(config, parsed.data)
    if (channel.protocol !== parsed.data.protocol || channel.baseURL !== parsed.data.baseURL ||
        channel.apiKeyEnv !== parsed.data.apiKeyEnv) {
      for (const model of channel.models) {
        delete model.discoveredContextWindow
        delete model.discoveredMaxOutputTokens
      }
    }
    channel.protocol = parsed.data.protocol
    channel.baseURL = parsed.data.baseURL
    if (parsed.data.apiKeyEnv) channel.apiKeyEnv = parsed.data.apiKeyEnv
    else delete channel.apiKeyEnv
  })
}

export function addChannelModels(channelId: string, modelIds: string[]): CatalogConfig {
  return updateCatalog(config => {
    const channel = Object.hasOwn(config.channels, channelId) && config.channels[channelId]
    if (!channel) throw new Error(`找不到渠道 ${channelId}`)
    if (!modelIds.length) throw new Error('请输入模型 ID')
    channel.models.push(...modelIds.map(id => ({ id })))
  })
}

export function saveDiscoveredChannelModel(
  channelId: string,
  expected: ChannelConnection,
  entry: { id: string; contextWindow?: number; maxOutputTokens?: number },
): CatalogConfig {
  return updateCatalog(config => {
    const channel = Object.hasOwn(config.channels, channelId) && config.channels[channelId]
    if (!channel || channel.protocol !== expected.protocol || channel.baseURL !== expected.baseURL ||
        channel.apiKeyEnv !== expected.apiKeyEnv) {
      throw new Error('渠道连接已变更，请返回渠道列表重新打开')
    }
    const existing = channel.models.find(model => model.id === entry.id)
    if (existing && entry.contextWindow === undefined && entry.maxOutputTokens === undefined) {
      throw new Error('该渠道已包含此模型')
    }
    const model: ModelChannel['models'][number] = existing ?? { id: entry.id }
    if (entry.contextWindow !== undefined) model.discoveredContextWindow = entry.contextWindow
    if (entry.maxOutputTokens !== undefined) model.discoveredMaxOutputTokens = entry.maxOutputTokens
    if (!existing) channel.models.push(model)
  })
}

export function saveModelBudgetSettings(
  channelId: string,
  modelId: string,
  expected: ChannelConnection,
  original: ModelBudgetOverrides,
  next: ModelBudgetOverrides,
): CatalogConfig {
  const budgets = modelBudgetOverridesSchema.safeParse(next)
  if (!budgets.success) throw new Error('上下文窗口和输出预算须为有效的正整数')

  return updateCatalog(config => {
    const channel = Object.hasOwn(config.channels, channelId) && config.channels[channelId]
    if (!channel || channel.protocol !== expected.protocol || channel.baseURL !== expected.baseURL ||
        channel.apiKeyEnv !== expected.apiKeyEnv) {
      throw new Error('渠道连接已变更，请返回渠道列表重新打开')
    }
    const model = channel.models.find(entry => entry.id === modelId)
    if (!model || model.contextWindow !== original.contextWindow || model.outputBudget !== original.outputBudget) {
      throw new Error('模型预算已变更，请返回模型列表重新打开')
    }

    const { contextWindow, outputBudget } = budgets.data
    if (contextWindow === undefined) delete model.contextWindow
    else model.contextWindow = contextWindow
    if (outputBudget === undefined) delete model.outputBudget
    else model.outputBudget = outputBudget
  })
}

export function getCatalogModel(value: string): CatalogModel | undefined {
  const catalog = getModelCatalog()
  const exact = catalog?.models.get(value)
  if (exact) return exact
  const matches = catalog?.byId.get(value)
  return matches?.length === 1 ? matches[0] : undefined
}

export function requireCatalogModel(value: string): CatalogModel {
  const model = getCatalogModel(value)
  if (model) return model
  const matches = getModelCatalog()?.byId.get(value)
  if (matches && matches.length > 1) {
    throw new Error(`模型 ${value} 存在于多个渠道，请选择 ${matches.map(entry => entry.value).join(' 或 ')}`)
  }
  throw new Error(`模型 ${value} 未在 models.json 中配置`)
}

export function getCatalogDefault(role: ModelRole = 'quark'): string | undefined {
  return getModelCatalog()?.config.roles[role]
}
