import { getCatalogDefault } from '../../services/api/provider/catalog.js'
import type { PermissionMode } from '../permissions/PermissionMode.js'
import { capitalize } from '../stringUtils.js'
import { MODEL_SELECTIONS, type ModelRole, type ModelSelection } from './roles.js'
import { getRuntimeMainLoopModel, getSelectedModelRole, parseUserSpecifiedModel } from './model.js'

export const AGENT_MODEL_OPTIONS = [...MODEL_SELECTIONS, 'inherit'] as const
export type AgentModelSelection = (typeof AGENT_MODEL_OPTIONS)[number]

export type AgentModelOption = {
  value: AgentModelSelection
  label: string
  description: string
}

/**
 * A subagent with no explicit model inherits the parent model.
 */
export function getDefaultSubagentModel(): string {
  return 'inherit'
}

function getSingleChannelAgentModelOverride(): string | undefined {
  return getCatalogDefault() ? undefined : process.env.NEXUS_SUBAGENT_MODEL || undefined
}

export function getAgentModel(
  agentModel: string | undefined,
  parentModel: string,
  toolSpecifiedModel?: ModelSelection,
  permissionMode?: PermissionMode,
): string {
  // An explicit single-channel override remains opt-in. Multi-channel agents use their own bindings.
  const override = getSingleChannelAgentModelOverride()
  if (override) return parseUserSpecifiedModel(override)
  const selected = toolSpecifiedModel ?? agentModel ?? getDefaultSubagentModel()
  if (selected === 'inherit') {
    return getRuntimeMainLoopModel({ permissionMode: permissionMode ?? 'default', mainLoopModel: parentModel })
  }
  return parseUserSpecifiedModel(selected)
}

export function getAgentModelRole(agentModel: string | undefined, toolSpecifiedModel?: ModelSelection): ModelRole | undefined {
  return getSelectedModelRole(getSingleChannelAgentModelOverride() ?? toolSpecifiedModel ?? agentModel)
}

export function getAgentModelDisplay(model: string | undefined): string {
  if (!model) return 'Inherit from parent (default)'
  if (model === 'inherit') return 'Inherit from parent'
  return capitalize(model)
}

/**
 * Get available model options for agents
 */
export function getAgentModelOptions(): AgentModelOption[] {
  return [
    {
      value: 'atom',
      label: 'Atom',
      description: 'Balanced performance - best for most agents',
    },
    {
      value: 'quark',
      label: 'Quark',
      description: 'Most capable for complex reasoning tasks',
    },
    {
      value: 'electron',
      label: 'Electron',
      description: 'Fast and efficient for simple tasks',
    },
    {
      value: 'inherit',
      label: 'Inherit from parent',
      description: 'Use the same model as the main conversation',
    },
  ]
}
