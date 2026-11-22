import { keyForRequestOrigin, type RequestRoute } from '../api/provider/index.js'
import { findCredentialOriginConflict, getModelCatalog } from '../api/provider/catalog.js'

export const DEEPSEEK_WEB_ORIGIN = 'https://api.deepseek.com'
type Operation = 'search' | 'fetch'

export function dedicatedDeepSeekWebKey(operation: Operation): string | undefined {
  const variable = operation === 'search' ? 'DEEPSEEK_SEARCH_API_KEY' : 'DEEPSEEK_FETCH_API_KEY'
  const selected = process.env[variable]?.trim() ? variable : 'DEEPSEEK_WEB_API_KEY'
  const key = process.env[selected]?.trim()
  const catalog = key ? getModelCatalog() : undefined
  if (catalog && findCredentialOriginConflict(catalog.config, selected, DEEPSEEK_WEB_ORIGIN)) {
    throw new Error(`${selected} 已绑定到其他服务地址。请为 DeepSeek 网页工具使用独立密钥变量。`)
  }
  return key || undefined
}

export async function requestDeepSeekWeb(
  operation: Operation,
  body: Record<string, unknown>,
  apiKey: string,
  parentSignal: AbortSignal,
): Promise<unknown> {
  const label = operation === 'search' ? '搜索' : '读取'
  const timeout = AbortSignal.timeout(operation === 'search' ? 25_000 : 60_000)
  const signal = AbortSignal.any([parentSignal, timeout])
  signal.throwIfAborted()
  let response: Response
  try {
    response = await fetch(DEEPSEEK_WEB_ORIGIN + '/v1/tools/' + operation, {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify(body),
    })
    if (response.ok) return await response.json()
  } catch {
    parentSignal.throwIfAborted()
    throw new Error(timeout.aborted ? `DeepSeek ${label}超时。` : `DeepSeek ${label}连接失败，或响应格式无效。`)
  }
  await response.body?.cancel().catch(() => {})
  throw new Error(`DeepSeek ${label}失败（HTTP ${response.status}）。`)
}

export function requireDeepSeekWebKey(operation: Operation, route?: RequestRoute): string {
  const key = dedicatedDeepSeekWebKey(operation) || keyForRequestOrigin(route, DEEPSEEK_WEB_ORIGIN)
  if (!key) {
    const label = operation === 'search' ? '搜索' : '读取'
    const variable = operation === 'search' ? 'DEEPSEEK_SEARCH_API_KEY' : 'DEEPSEEK_FETCH_API_KEY'
    throw new Error(`DeepSeek ${label}缺少可用密钥。请检查发起调用的官方渠道，或设置 ${variable}。`)
  }
  return key
}
