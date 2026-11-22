import { saveUserSettingsEnv } from '../../../utils/settings/userSettingsEnv.js'
import {
  findCredentialOriginConflict, getChannelsUsingCredential, getEditableModelCatalog,
  getLegacyModelCatalog, getModelCatalog, type CatalogConfig,
} from './catalog.js'
export { findCredentialOriginConflict } from './catalog.js'

export type CredentialScope = 'session' | 'user'
export type CredentialTarget = ReturnType<typeof getCredentialTarget>

export function getCredentialTarget(config: CatalogConfig, id: string) {
  const channel = Object.hasOwn(config.channels, id) && config.channels[id]
  if (!channel) throw new Error('渠道配置已变更，请返回重新选择')
  const variable = channel.apiKeyEnv
  const shared = variable ? getChannelsUsingCredential(config, variable) : []
  return {
    id, baseURL: channel.baseURL, variable, shared,
    multipleOrigins: new Set(shared.map(item => new URL(item.baseURL).origin)).size > 1,
  }
}

export function applyChannelCredential(target: CredentialTarget, value: string, scope: CredentialScope): void {
  // Confirm the editor still describes all destinations for this variable at the time of applying it.
  const latest = getCredentialTarget(getEditableModelCatalog(), target.id)
  if (JSON.stringify(latest) !== JSON.stringify(target)) throw new Error('渠道配置已变更，请返回重新确认地址和变量名')
  if (!latest.variable) throw new Error('此渠道没有设置密钥环境变量')
  if (latest.multipleOrigins) throw new Error('同一变量指向不同服务地址，请先为各服务配置独立的密钥变量')
  const active = getModelCatalog()?.config ?? getLegacyModelCatalog()
  if (findCredentialOriginConflict(active, latest.variable, latest.baseURL)) {
    throw new Error('其他窗口已调整此变量的渠道地址，请重新启动 Nexus 后再更换密钥')
  }
  const key = value.trim()
  if (!key || /[^\x21-\x7e]/.test(key)) throw new Error('请输入有效的单行 API 密钥')
  if (scope === 'user') saveUserSettingsEnv({ [latest.variable]: key })
  process.env[latest.variable] = key
}
