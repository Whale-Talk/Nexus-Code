import figures from 'figures'
import type { Command } from '../../commands.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'

const command = {
  name: 'sandbox',
  get description() {
    const currentlyEnabled = SandboxManager.isSandboxingEnabled()
    const autoAllow = SandboxManager.isAutoAllowBashIfSandboxedEnabled()
    const allowUnsandboxed = SandboxManager.areUnsandboxedCommandsAllowed()
    const isLocked = SandboxManager.areSandboxSettingsLockedByPolicy()
    const hasDeps = SandboxManager.checkDependencies().errors.length === 0

    // Show warning icon if dependencies missing, otherwise enabled/disabled status
    let icon: string
    if (!hasDeps) {
      icon = figures.warning
    } else {
      icon = currentlyEnabled ? figures.tick : figures.circle
    }

    let statusText = '命令沙箱已关闭'
    if (currentlyEnabled) {
      statusText = autoAllow
        ? '命令沙箱已开启（自动允许沙箱内的命令）'
        : '命令沙箱已开启'

      // Add unsandboxed fallback status
      statusText += allowUnsandboxed ? '，允许回退到沙箱外执行' : ''
    }

    if (isLocked) {
      statusText += '（由组织策略管理）'
    }

    return `${icon} ${statusText}，按回车配置`
  },
  argumentHint: 'exclude "command pattern"',
  get isHidden() {
    return (
      !SandboxManager.isSupportedPlatform() ||
      !SandboxManager.isPlatformInEnabledList()
    )
  },
  immediate: true,
  type: 'local-jsx',
  load: () => import('./sandbox-toggle.js'),
} satisfies Command

export default command
