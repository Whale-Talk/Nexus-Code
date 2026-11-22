import { getInitialMainLoopModel } from '../../bootstrap/state.js'
import { getCatalogModel, getLegacyDeepSeekModelIds, getModelCatalog } from '../../services/api/provider/catalog.js'
import { capitalize } from '../stringUtils.js'
import { MODEL_ROLES, type ModelRole } from './roles.js'
import {
  getDefaultMainLoopModelSetting, getModelForRole, getUserSpecifiedModelSetting,
  renderDefaultModelSetting, renderModelName, type ModelSetting,
} from './model.js'
import { isModelAllowed } from './modelAllowlist.js'

export type ModelOption = {
  value: ModelSetting
  role?: ModelRole
  label: string
  description: string
  descriptionForModel?: string
}

export function getDefaultOptionForUser(): ModelOption {
  return { value: null, label: '跟随默认模型',
    description: renderDefaultModelSetting(getDefaultMainLoopModelSetting()) }
}

function roleOption(role: ModelRole): ModelOption {
  const bound = getModelForRole(role)
  const entry = getCatalogModel(bound)
  return {
    value: role, role, label: capitalize(role),
    description: entry ? `${entry.channel} / ${entry.name ?? entry.id}` : bound,
  }
}

export function getQuarkPlanOption(): ModelOption {
  return { value: 'quarkplan', label: 'Quark Plan', description: '规划时使用 Quark，执行时使用 Atom' }
}

export function getModelOptions(_fastMode = false): ModelOption[] {
  const options: ModelOption[] = [getDefaultOptionForUser(), ...MODEL_ROLES.map(roleOption)]
  const catalog = getModelCatalog()
  if (catalog) {
    for (const model of catalog.models.values()) {
      options.push({
        value: model.value,
        label: model.name ?? model.id,
        description: model.name ? `${model.channel} / ${model.id}` : `渠道 ${model.channel}`,
      })
    }
  } else {
    const custom = process.env.NEXUS_CUSTOM_MODEL_OPTION
    if (custom) {
      options.push({ value: custom, label: process.env.NEXUS_CUSTOM_MODEL_OPTION_NAME ?? custom,
        description: process.env.NEXUS_CUSTOM_MODEL_OPTION_DESCRIPTION ?? custom })
    }
    for (const model of getLegacyDeepSeekModelIds()) {
      if (model !== custom) options.push({ value: model, label: model, description: 'DeepSeek 官方渠道' })
    }
  }
  const current = getUserSpecifiedModelSetting() ?? getInitialMainLoopModel()
  if (current && !options.some(option => option.value === current)) {
    if (current === 'quarkplan') options.push(getQuarkPlanOption())
    else options.push({ value: current, label: renderModelName(current), description: '当前选择的模型' })
  }
  return options.filter(option => option.value === null || isModelAllowed(option.value))
}
