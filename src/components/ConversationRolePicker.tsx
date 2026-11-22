import React from 'react'
import { useModalOrTerminalSize } from '../context/modalContext.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { Box, Text } from '../ink.js'
import { truncateToWidth } from '../utils/format.js'
import { ROLE_BINDING_HINT } from '../utils/model/conversationRole.js'
import { getDefaultMainLoopModelSetting, renderDefaultModelSetting, type ModelSetting } from '../utils/model/model.js'
import { isModelAllowed } from '../utils/model/modelAllowlist.js'
import { MODEL_ROLES, type ModelRole } from '../utils/model/roles.js'
import { capitalize } from '../utils/stringUtils.js'
import { Select } from './CustomSelect/index.js'
import { Pane } from './design-system/Pane.js'

type Props = {
  initial: ModelSetting
  onSelect: (role: ModelRole) => void
  onCancel: () => void
}

export function ConversationRolePicker({ initial, onSelect, onCancel }: Props) {
  const { columns } = useModalOrTerminalSize(useTerminalSize())
  const options = MODEL_ROLES.map(role => {
    const allowed = isModelAllowed(role)
    return {
      value: role,
      label: capitalize(role),
      description: truncateToWidth(
        allowed ? renderDefaultModelSetting(role) : '受模型使用策略限制',
        Math.max(1, columns - 22),
      ),
      disabled: !allowed,
    }
  })
  const current = options.find(option => option.value === (initial ?? getDefaultMainLoopModelSetting()))
  const defaultFocus = current && !current.disabled ? current : options.find(option => !option.disabled)
  return <Pane color="permission">
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold color="remember">切换对话角色</Text>
        <Text dimColor>仅影响当前对话。{ROLE_BINDING_HINT}</Text>
      </Box>
      <Select clickToSelect options={options} defaultValue={current?.value} defaultFocusValue={defaultFocus?.value}
        onChange={onSelect} onCancel={onCancel} />
      <Text dimColor wrap="truncate-end">↑↓ 移动 · Enter 切换 · Esc 返回</Text>
    </Box>
  </Pane>
}
