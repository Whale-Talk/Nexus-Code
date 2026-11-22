import { feature } from 'bun:bundle'
import React from 'react'
import { useModalOrTerminalSize } from '../../context/modalContext.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { Box, Text } from '../../ink.js'
import { isKeybindingCustomizationEnabled } from '../../keybindings/loadUserBindings.js'
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js'
import { getFeatureValue } from '../../services/analytics/featureFlags.js'
import { isFastModeAvailable, isFastModeEnabled } from '../../utils/fastMode.js'
import { getPlatform } from '../../utils/platform.js'
import { getNewlineInstructions } from './utils.js'

export function PromptInputHelpMenu() {
  const { columns } = useModalOrTerminalSize(useTerminalSize())
  const settings = useShortcutDisplay('command:config', 'Chat', 'Ctrl+P')
  const model = useShortcutDisplay('chat:modelPicker', 'Chat', 'alt+p')
  const dismiss = useShortcutDisplay('help:dismiss', 'Help', 'esc')
  const mode = useShortcutDisplay('chat:cycleMode', 'Chat', 'shift+tab')
  const undo = useShortcutDisplay('chat:undo', 'Chat', 'ctrl+_')
  const transcript = useShortcutDisplay('app:toggleTranscript', 'Global', 'ctrl+o')
  const tasks = useShortcutDisplay('app:toggleTodos', 'Global', 'ctrl+t')
  const stash = useShortcutDisplay('chat:stash', 'Chat', 'ctrl+s')
  const editor = useShortcutDisplay('chat:externalEditor', 'Chat', 'ctrl+g')
  const image = useShortcutDisplay('chat:imagePaste', 'Chat', getPlatform() === 'windows' ? 'alt+v' : 'ctrl+v')
  const terminal = useShortcutDisplay('app:toggleTerminal', 'Global', 'meta+j')
  const fast = useShortcutDisplay('chat:fastMode', 'Chat', 'alt+o')

  const shortcuts = [
    [settings, '打开设置中心'], [model, '切换对话模型'], ['↑ / ↓', '输入历史'],
    ['/', '浏览命令'], ['@', '引用文件'], [mode, '切换审批模式'],
    [getNewlineInstructions(), '换行'], [undo, '撤销输入'], [image, '粘贴图片'],
    [transcript, '详细输出'], [tasks, '任务列表'], [stash, '暂存草稿'],
    [editor, '用编辑器修改'], ['Esc Esc', '清空输入'], ['!', '命令行模式'],
    ['&', '后台运行'], ['/btw', '旁支提问'],
  ]
  if (getPlatform() !== 'windows') shortcuts.push(['Ctrl+Z', '挂起进程'])
  if (isFastModeEnabled() && isFastModeAvailable()) shortcuts.push([fast, '切换快速模式'])
  if (feature('TERMINAL_PANEL') && getFeatureValue('nexus_terminal_panel', false)) {
    shortcuts.push([terminal, '打开终端面板'])
  }
  if (isKeybindingCustomizationEnabled()) shortcuts.push(['/keybindings', '自定义快捷键'])

  const width = Math.max(1, Math.min(columns, 108))
  const columnCount = width >= 84 ? 3 : width >= 54 ? 2 : 1
  const gap = 2
  const columnWidth = Math.floor((width - (columnCount - 1) * gap) / columnCount)

  return <Box flexDirection="column">
    <Box><Text bold color="suggestion">快捷键</Text><Text dimColor>　{dismiss.toUpperCase()} 关闭</Text></Box>
    <Box flexDirection="row" flexWrap="wrap" width={width} columnGap={gap}>
      {shortcuts.map(([key, action]) => <Box key={action} width={columnWidth}>
        <Text><Text color="suggestion">{key}</Text>　{action}</Text>
      </Box>)}
    </Box>
  </Box>
}
