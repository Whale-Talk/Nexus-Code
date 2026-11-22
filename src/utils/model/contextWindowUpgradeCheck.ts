import { getCatalogModel } from '../../services/api/provider/catalog.js'
import { MODEL_ROLES } from './roles.js'
import { getMainLoopModel, getModelForRole } from './model.js'
import { isModelAllowed } from './modelAllowlist.js'

export function getUpgradeMessage(context: 'warning' | 'tip'): string | null {
  const currentWindow = getCatalogModel(getMainLoopModel())?.contextWindow
  if (!currentWindow) return null
  for (const role of MODEL_ROLES) {
    const target = getCatalogModel(getModelForRole(role))
    if (target?.contextWindow && target.contextWindow > currentWindow && isModelAllowed(role)) {
      return context === 'warning' ? `/model ${role}` :
        `/model ${role} 可使用 ${target.contextWindow.toLocaleString()} 个词元的上下文`
    }
  }
  return null
}
