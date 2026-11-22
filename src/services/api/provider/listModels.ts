import { z } from 'zod/v4'
import { channelSchema, type ModelChannel } from './catalog.js'
import { normalizeMessagesBaseURL } from './implementations/messages.js'
import { normalizeOpenAICompatibleBaseURL } from './implementations/openai-compatible.js'
import { getOfficialModelService } from './officialChannels.js'

type ChannelConnection = Pick<ModelChannel, 'baseURL' | 'apiKeyEnv' | 'protocol'>
export type ModelDirectoryScope = 'glm-api' | 'glm-coding-plan'
export type ModelDirectoryEntry = { id: string; contextWindow?: number; maxOutputTokens?: number }

const connectionSchema = channelSchema.pick({ baseURL: true, apiKeyEnv: true, protocol: true })
const optionalTokenLimit = z.int().positive().optional().catch(undefined)
const pageSchema = z.object({
  data: z.array(z.object({
    id: channelSchema.shape.models.element.shape.id,
    context_window: optionalTokenLimit,
    context_length: optionalTokenLimit,
    max_output_tokens: optionalTokenLimit,
    limit: z.object({ context: optionalTokenLimit, output: optionalTokenLimit }).optional().catch(undefined),
    token_limits: z.object({
      context_window: optionalTokenLimit,
      max_output_token_length: optionalTokenLimit,
    }).optional().catch(undefined),
    task_type: z.array(z.string()).optional().catch(undefined),
  })),
  has_more: z.boolean().optional(),
  last_id: z.string().optional(),
})
const glmAuthCodeSchema = z.union([z.string(), z.number()])
const glmErrorSchema = z.object({
  code: glmAuthCodeSchema.optional(),
  error: z.object({ code: glmAuthCodeSchema }).optional(),
})
const glmAuthenticationCodes = new Set(['1000', '1001', '1003', '1005', '1220'])

function isGlmOrigin(origin: string) {
  return origin === 'https://open.bigmodel.cn' || origin === 'https://api.z.ai'
}

function messagesPrefix(base: URL) {
  return base.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')
}

export function requiresModelDirectoryScope(channel: ChannelConnection): boolean {
  if (channel.protocol !== 'messages' || !URL.canParse(channel.baseURL)) return false
  const base = new URL(channel.baseURL)
  return isGlmOrigin(base.origin) && messagesPrefix(base) === '/api/anthropic'
}

function officialMessagesModelList(base: URL, scope?: ModelDirectoryScope): string | undefined {
  const path = messagesPrefix(base)
  const { origin } = base
  if (path === '/api/anthropic' && isGlmOrigin(origin)) {
    // GLM shares this Messages base between standard and subscription keys.
    // Let the user choose the product instead of guessing or trying both.
    if (scope !== 'glm-api' && scope !== 'glm-coding-plan') {
      throw new Error('请先选择此 GLM 渠道的密钥类型：按量付费 API 或 Coding Plan')
    }
    return scope === 'glm-coding-plan' ? '/api/coding/paas/v4/models' : '/api/paas/v4/models'
  }
  if (path === '/coding' && (origin === 'https://api.kimi.com' || origin === 'https://api.kimi.ai')) {
    return '/coding/v1/models'
  }
  if (path !== '/anthropic') return undefined
  if (origin === 'https://api.deepseek.com') return '/models'
  // The directory is served by the other protocol on the same account endpoint.
  if (origin === 'https://api.moonshot.cn' || origin === 'https://api.moonshot.ai' ||
      origin === 'https://api.xiaomimimo.com' || origin === 'https://token-plan-cn.xiaomimimo.com' ||
      origin === 'https://token-plan-sgp.xiaomimimo.com' || origin === 'https://token-plan-ams.xiaomimimo.com') {
    return '/v1/models'
  }
  return undefined
}

function listRequest(channel: ChannelConnection, apiKeyOverride?: string, scope?: ModelDirectoryScope) {
  const parsed = connectionSchema.safeParse(channel)
  if (!parsed.success) throw new Error('渠道地址、协议或密钥变量名称无效')
  const { baseURL, protocol, apiKeyEnv } = parsed.data
  const key = apiKeyOverride !== undefined ? apiKeyOverride.trim()
    : apiKeyEnv ? process.env[apiKeyEnv]?.trim() : undefined
  if (apiKeyEnv && !key) throw new Error('此渠道的密钥环境变量未设置或为空')
  if (!key && protocol === 'messages') throw new Error('请先配置此渠道的密钥环境变量')
  if (key && /[^\x20-\x7e]/.test(key)) throw new Error('此渠道的密钥包含无效字符，请核对环境变量')
  const base = new URL(baseURL)
  const officialListPath = protocol === 'messages' ? officialMessagesModelList(base, scope) : undefined
  let endpoint: URL
  const headers = new Headers({ accept: 'application/json' })
  if (officialListPath) {
    // Match only known origins and paths. Never retry against another origin or product scope.
    endpoint = new URL(officialListPath, base.origin)
    headers.set('authorization', `Bearer ${key!}`)
  } else if (protocol === 'messages') {
    endpoint = new URL(`${normalizeMessagesBaseURL(base.href)}/models`)
    headers.set('anthropic-version', '2023-06-01')
    headers.set('x-api-key', key!)
  } else {
    endpoint = new URL(`${normalizeOpenAICompatibleBaseURL(base.href)}models`)
    if (key) headers.set('authorization', `Bearer ${key}`)
  }
  return { headers, endpoint }
}

function responseError(status: number) {
  if (status >= 300 && status < 400) return new Error('渠道返回了重定向，请填写模型服务的最终地址')
  if (status === 401 || status === 403) return new Error(`渠道拒绝访问（HTTP ${status}），请核对密钥和模型列表权限`)
  if (status === 404 || status === 405) return new Error(`渠道未提供模型列表（HTTP ${status}），可以手动填写模型 ID`)
  if (status === 429) return new Error('渠道请求过于频繁，请稍后重试')
  return new Error(`读取渠道模型列表失败（HTTP ${status}）`)
}

/** Reads only the configured channel directory. Discovery never writes a catalog. */
export async function fetchChannelModels(channel: ChannelConnection, signal: AbortSignal, apiKeyOverride?: string, scope?: ModelDirectoryScope): Promise<ModelDirectoryEntry[]> {
  const { headers, endpoint } = listRequest(channel, apiKeyOverride, scope)
  const isArk = getOfficialModelService(channel.protocol, channel.baseURL) === 'doubao'
  const timeout = AbortSignal.timeout(10_000)
  const deadline = AbortSignal.any([signal, timeout])
  const models = new Map<string, ModelDirectoryEntry>()
  const cursors = new Set<string>()
  for (;;) {
    let response: Response
    let json: unknown
    try {
      response = await fetch(endpoint, { headers, signal: deadline, redirect: 'manual', credentials: 'omit' })
      if (response.ok) json = await response.json()
    } catch (error) {
      if (signal.aborted) throw new Error('已取消读取模型列表')
      if (timeout.aborted) throw new Error('读取模型列表超时，请重试或手动填写模型 ID')
      if (error instanceof SyntaxError) throw new Error('渠道返回的模型列表不是有效的 JSON')
      throw new Error('无法连接到渠道的模型列表，请核对服务地址和网络连接')
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {})
      throw responseError(response.status)
    }
    // Some official GLM routes return an authentication error inside HTTP 200.
    if (isGlmOrigin(endpoint.origin)) {
      const body = glmErrorSchema.safeParse(json)
      const code = body.success ? String(body.data.error?.code ?? body.data.code) : ''
      if (glmAuthenticationCodes.has(code)) throw new Error(`渠道鉴权失败（代码 ${code}），请核对密钥类型和模型列表权限`)
    }
    const parsed = pageSchema.safeParse(json)
    if (!parsed.success) throw new Error('渠道返回的模型列表格式无效，可以手动填写模型 ID')
    for (const { id, limit, context_length, context_window, max_output_tokens, token_limits, task_type } of parsed.data.data) {
      if (isArk && task_type?.length && !task_type.includes('TextGeneration')) continue
      const arkLimits = isArk ? token_limits : undefined
      const model: ModelDirectoryEntry = models.get(id) ?? { id }
      const contextWindow = arkLimits?.context_window ?? limit?.context ?? context_length ?? context_window
      const maxOutputTokens = arkLimits?.max_output_token_length ?? limit?.output ?? max_output_tokens
      if (model.contextWindow === undefined && contextWindow !== undefined) model.contextWindow = contextWindow
      if (model.maxOutputTokens === undefined && maxOutputTokens !== undefined) model.maxOutputTokens = maxOutputTokens
      models.set(id, model)
    }
    if (!parsed.data.has_more) return [...models.values()]
    const cursor = parsed.data.last_id
    if (!cursor || cursors.has(cursor)) throw new Error('渠道返回的模型列表分页无效，可以手动填写模型 ID')
    cursors.add(cursor)
    // Only a cursor may come from the provider. Every page goes to the original endpoint.
    endpoint.searchParams.set('after_id', cursor)
  }
}

export async function fetchChannelModelIds(channel: ChannelConnection, signal: AbortSignal, apiKeyOverride?: string, scope?: ModelDirectoryScope): Promise<string[]> {
  return (await fetchChannelModels(channel, signal, apiKeyOverride, scope)).map(model => model.id)
}
