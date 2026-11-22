import { getCatalogModel, getModelCatalog, type ModelCapability } from '../../services/api/provider/catalog.js'
import { MODEL_ROLES } from './roles.js'

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

  const id = (entry?.id ?? model).replace(/\[1m\]$/i, '')
  if (['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-flash'].includes(id)) {
    if (capability === 'thinking' || capability === 'effort' || capability === 'maxEffort') return true
  }
  return undefined
}
