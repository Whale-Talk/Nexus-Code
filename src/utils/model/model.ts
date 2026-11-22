import { getMainLoopModelOverride } from '../../bootstrap/state.js'
import { getCatalogDefault, getCatalogModel } from '../../services/api/provider/catalog.js'
import { getDisplayContextModelId, getKnownContextWindow } from '../../services/api/provider/modelContext.js'
import { has1mContext, is1mContextDisabled, modelSupports1M } from '../context.js'
import type { PermissionMode } from '../permissions/PermissionMode.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import { capitalize } from '../stringUtils.js'
import { isModelSelection, isModelRole, type ModelSelection, type ModelRole } from './roles.js'
import { isModelAllowed } from './modelAllowlist.js'

export type ModelShortName = string
export type ModelName = string
export type ModelSetting = ModelName | ModelSelection | null

// Also used by the single-channel launcher when it creates a new profile.
const defaultSingleChannelModel = 'deepseek-v4-pro'

export function getModelForRole(role: ModelRole): ModelName {
  const configured = getCatalogDefault(role) ?? (
    process.env[`NEXUS_${role.toUpperCase()}_MODEL`]?.trim() ||
    process.env.NEXUS_MODEL?.trim()
  )
  if (configured) return configured
  const saved = getSettings_DEPRECATED()?.model?.trim()
  return saved && !isModelSelection(saved) ? saved : defaultSingleChannelModel
}

export function getQuarkModel(): ModelName {
  return getModelForRole('quark')
}

export function getAtomModel(): ModelName {
  return getModelForRole('atom')
}

export function getElectronModel(): ModelName {
  return getModelForRole('electron')
}

export function isQuarkModel(model: ModelName): boolean {
  return parseUserSpecifiedModel(model) === getQuarkModel()
}

export function getUserSpecifiedModelSetting(): ModelSetting | undefined {
  const override = getMainLoopModelOverride()
  let selected = override
  if (selected === undefined) {
    selected = getCatalogDefault() || process.env.NEXUS_QUARK_MODEL || process.env.NEXUS_MODEL
      ? 'quark' : getSettings_DEPRECATED()?.model || undefined
  }
  return selected && !isModelAllowed(selected) ? undefined : selected
}

export function getDefaultMainLoopModelSetting(): ModelName {
  return 'quark'
}

export function getDefaultMainLoopModel(): ModelName {
  return getQuarkModel()
}

export function getMainLoopModel(): ModelName {
  return parseUserSpecifiedModel(getUserSpecifiedModelSetting() ?? getDefaultMainLoopModelSetting())
}

export function getRuntimeMainLoopModel({ permissionMode, mainLoopModel, exceeds200kTokens = false }: {
  permissionMode: PermissionMode
  mainLoopModel: string
  exceeds200kTokens?: boolean
}): ModelName {
  if (permissionMode === 'plan') {
    const selected = getUserSpecifiedModelSetting()?.trim().toLowerCase()
    if (selected === 'quarkplan' && !exceeds200kTokens) return getQuarkModel()
    if (selected === 'electron') return getAtomModel()
  }
  return mainLoopModel
}

export function parseUserSpecifiedModel(modelInput: string): ModelName {
  const value = modelInput.trim()
  const configured = getCatalogModel(value)
  // Qualified references always identify a physical model, even when its ID is a role name.
  if (configured && !isModelRole(value) && value !== 'quarkplan') return configured.value
  const normalized = value.toLowerCase()
  const extended = /\[1m\]$/.test(normalized)
  const role = extended ? normalized.slice(0, -4) : normalized
  if (isModelRole(role)) return resolveRoleContext(role, extended)
  if (role === 'quarkplan') return resolveRoleContext('atom', extended)

  return value
}

export function getSelectedModelRole(selection: string | undefined): ModelRole | undefined {
  const value = selection?.trim()
  if (!value) return undefined
  const normalized = value.toLowerCase().replace(/\[1m\]$/, '')
  // Match parseUserSpecifiedModel's catalog-first treatment of exact physical IDs.
  if (!isModelRole(value) && value !== 'quarkplan' && getCatalogModel(value)) return undefined
  if (normalized === 'quarkplan') return 'atom'
  return isModelRole(normalized) ? normalized : undefined
}

function resolveRoleContext(role: ModelRole, extended: boolean): string {
  const bound = getModelForRole(role)
  if (getCatalogDefault(role) || !extended || is1mContextDisabled() ||
      has1mContext(bound) || getKnownContextWindow(bound) !== undefined) return bound
  return bound + '[1m]'
}

export function hasQuarkExtendedContext(): boolean {
  return modelSupports1M(getQuarkModel())
}

export function hasAtomExtendedContext(): boolean {
  return modelSupports1M(getAtomModel())
}

// Normalization for capability/statistics lookups only. Request IDs remain case-sensitive.
export function getCanonicalName(model: ModelName): ModelShortName {
  return (getCatalogModel(model)?.id ?? model).toLowerCase()
}

export function normalizeModelStringForAPI(model: string): string {
  return model.trim()
}

export function getDefaultModelDescription(): string {
  return `默认模型：${renderDefaultModelSetting(getDefaultMainLoopModelSetting())}`
}

export function getPublicModelDisplayName(model: ModelName): string | null {
  return getCatalogModel(model)?.name ?? null
}

export function getMarketingNameForModel(model: ModelName): string | undefined {
  return getPublicModelDisplayName(model) ?? undefined
}

export function renderModelName(model: ModelName): string {
  const entry = getCatalogModel(model)
  const name = entry?.name ?? getDisplayContextModelId(model)
  return entry ? `${name} (${entry.channel})` : name
}

export function renderModelSetting(setting: ModelName): string {
  if (setting === 'quarkplan') return 'Quark Plan'
  return isModelSelection(setting) ? capitalize(setting) : renderModelName(setting)
}

export function renderDefaultModelSetting(setting: ModelName): string {
  return setting === 'quarkplan' ? '规划时使用 Quark，执行时使用 Atom' : renderModelName(parseUserSpecifiedModel(setting))
}

export function modelDisplayString(setting: ModelSetting): string {
  if (setting === null) return `默认（${renderDefaultModelSetting(getDefaultMainLoopModelSetting())}）`
  const model = parseUserSpecifiedModel(setting)
  return model === setting ? renderModelName(model) : `${setting} (${renderModelName(model)})`
}

export function getPublicModelName(model: ModelName): string {
  return `Nexus (${renderModelName(model)})`
}
