// Provider 注册表 — 工厂 + 多后端分发。
//
// 结构对齐 opencode packages/llm/src/providers/index.ts (注册表 + 按类型分发)
// 注意: Bedrock/Foundry/Vertex 保留 @anthropic-ai/sdk 路径, 不入此注册表。

export type { ModelRequest, StreamEvent, StreamResponse, ProviderAdapter, WithResponse } from './types.js'
export {
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  AuthenticationError,
  NotFoundError,
} from './errors.js'

/** Provider 分发键 — 当前仅直连 + relay 路径使用此抽象层 */
export type ProviderKind = 'anthropic' | 'openai-compatible'

/** 已注册 provider 的懒加载工厂 */
const registry = new Map<ProviderKind, () => Promise<{ adapter: import('./types.js').ProviderAdapter }>>()

export function registerProvider(kind: ProviderKind, factory: () => Promise<{ adapter: import('./types.js').ProviderAdapter }>): void {
  registry.set(kind, factory)
}

/** 获取已注册的 provider 适配器 (懒加载 + 缓存) */
const cache = new Map<ProviderKind, import('./types.js').ProviderAdapter>()

export async function getProvider(kind: ProviderKind): Promise<import('./types.js').ProviderAdapter> {
  const cached = cache.get(kind)
  if (cached) return cached
  const factory = registry.get(kind)
  if (!factory) throw new Error(`Provider "${kind}" not registered`)
  const { adapter } = await factory()
  cache.set(kind, adapter)
  return adapter
}
