import { getCatalogModel, getModelCatalog, type ModelCapability } from '../../services/api/provider/catalog.js'
import { getReasoningProfile } from '../../services/api/provider/reasoning.js'
import { MODEL_ROLES } from './roles.js'

function getModelReasoningConnection(model: string) {
  const entry = getCatalogModel(model)
  const catalog = getModelCatalog()
  if (catalog) {
    if (!entry) return undefined
    const channel = catalog.config.channels[entry.channel]!
    return { protocol: channel.protocol, baseURL: channel.baseURL, id: entry.id, dialect: entry.reasoningDialect }
  }
  const protocol = process.env.NEXUS_PROVIDER ?? 'messages'
  if (protocol !== 'messages' && protocol !== 'openai-compatible') return undefined
  return { protocol, baseURL: process.env.NEXUS_BASE_URL ?? '', id: model, dialect: undefined } as const
}

export function getModelReasoningProfile(model: string) {
  const connection = getModelReasoningConnection(model)
  if (connection) {
    const { protocol, baseURL, id, dialect } = connection
    return getReasoningProfile(protocol, baseURL, id, dialect)
  }
}

export function hasModelThinkingToggle(model: string): boolean {
  const profile = getModelReasoningProfile(model)
  return profile?.thinking === 'toggle' || getModelReasoningConnection(model)?.protocol === 'messages'
}

export function getModelCapabilityOverride(model: string, capability: ModelCapability): boolean | undefined {
  const entry = getCatalogModel(model)
  const configured = entry?.capabilities?.[capability]
  if (configured !== undefined) return configured

  if (!getModelCatalog()) {
    for (const role of MODEL_ROLES) {
      const prefix = `NEXUS_${role.toUpperCase()}_MODEL`
      const pinned = process.env[prefix] || process.env.NEXUS_MODEL
      const available = process.env[`${prefix}_SUPPORTED_CAPABILITIES`]
      if (pinned === model && available !== undefined) {
        const names = available.toLowerCase().split(',').map(name => name.trim().replaceAll('_', ''))
        return names.includes(capability.toLowerCase())
      }
    }
  }

  if (capability === 'thinking' || capability === 'alwaysOnThinking' ||
      capability === 'effort' || capability === 'maxEffort') {
    const profile = getModelReasoningProfile(model)
    if (!profile) return undefined
    if (capability === 'thinking') return true
    if (capability === 'alwaysOnThinking') return profile.thinking === 'always'
    if (capability === 'effort') return Boolean(profile.effortLevels?.length)
    return profile.effortLevels?.includes('max') ?? false
  }
  return undefined
}
