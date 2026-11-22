import { getCatalogModel, getModelCatalog } from '../../services/api/provider/catalog.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import { isModelSelection } from './roles.js'
import { parseUserSpecifiedModel } from './model.js'

/** Roles authorize their current binding. A qualified entry is restricted to that channel. */
export function isModelAllowed(model: string): boolean {
  const allowed = getSettings_DEPRECATED()?.availableModels
  if (!allowed) return true
  const requested = model.trim()
  const resolved = parseUserSpecifiedModel(requested)
  const catalog = getModelCatalog()
  const options = getCatalogModel(resolved)
  return allowed.some(value => {
    const rule = value.trim()
    if (!rule) return false
    if (isModelSelection(rule)) {
      return parseUserSpecifiedModel(rule) === resolved
    }
    if (rule.includes('::')) return rule === resolved
    const id = options?.id ?? resolved
    // Explicit IDs can include a version suffix, but should never grant a similarly named channel.
    if (rule === id || id.startsWith(rule + '-')) return true
    return !catalog && requested === rule
  })
}
