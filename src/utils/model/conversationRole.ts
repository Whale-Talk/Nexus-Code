import type { ToolUseContext } from '../../Tool.js'
import { clearFastModeCooldown, isFastModeEnabled, isFastModeSupportedByModel } from '../fastMode.js'
import { capitalize } from '../stringUtils.js'
import { renderDefaultModelSetting } from './model.js'
import { isModelAllowed } from './modelAllowlist.js'
import type { ModelRole } from './roles.js'

export const ROLE_BINDING_HINT = '通过 Ctrl+P → 模型 → 角色绑定 配置角色使用的渠道和模型。'

export function switchConversationRole(
  role: ModelRole,
  { getAppState, setAppState }: Pick<ToolUseContext, 'getAppState' | 'setAppState'>,
): { changed: boolean; message: string } {
  const label = capitalize(role)
  if (!isModelAllowed(role)) {
    return { changed: false, message: `${label} 当前绑定的模型受模型使用策略限制。${ROLE_BINDING_HINT}` }
  }

  const fastModeEnabled = isFastModeEnabled()
  const disableFastMode = fastModeEnabled && !!getAppState().fastMode && !isFastModeSupportedByModel(role)
  if (fastModeEnabled) clearFastModeCooldown()
  setAppState(previous => ({
    ...previous,
    mainLoopModel: role,
    mainLoopModelForSession: null,
    ...(disableFastMode && { fastMode: false }),
  }))
  const status = disableFastMode ? ' · 快速模式已关闭' : ''
  return { changed: true, message: `当前对话已切换到 ${label} · ${renderDefaultModelSetting(role)}${status}` }
}
