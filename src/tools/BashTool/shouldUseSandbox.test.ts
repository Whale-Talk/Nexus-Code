import { expect, test } from 'bun:test'
import { SandboxManager as BaseSandboxManager } from '@anthropic-ai/sandbox-runtime'
import type { SandboxSettings } from '../../entrypoints/sandboxTypes.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import {
  getSessionSettingsCache,
  resetSettingsCache,
  setSessionSettingsCache,
} from '../../utils/settings/settingsCache.js'
import { exec } from '../../utils/Shell.js'
import { shouldUseSandbox } from './shouldUseSandbox.js'

function setSandboxSettings(sandbox: SandboxSettings): void {
  setSessionSettingsCache({ settings: { sandbox }, errors: [] })
}

function restoreSettings(previous: ReturnType<typeof getSessionSettingsCache>): void {
  if (previous) setSessionSettingsCache(previous)
  else resetSettingsCache()
}

test('strict policy forces isolation and exceptions never cover an unmatched command', () => {
  const previous = getSessionSettingsCache()
  const originalEnabled = SandboxManager.isSandboxingEnabled
  SandboxManager.isSandboxingEnabled = () => true
  try {
    const config = { enabled: true, excludedCommands: ['pwd', 'whoami'] }
    setSandboxSettings(config)
    expect(SandboxManager.isAutoAllowBashIfSandboxedEnabled()).toBe(false)
    expect(shouldUseSandbox({ command: 'pwd' })).toBe(false)
    expect(shouldUseSandbox({ command: 'pwd && whoami' })).toBe(false)
    expect(shouldUseSandbox({ command: 'pwd && printf sample' })).toBe(true)
    expect(shouldUseSandbox({ command: 'pwd > sample.txt' })).toBe(true)
    expect(shouldUseSandbox({ command: 'printf sample', dangerouslyDisableSandbox: true })).toBe(false)

    setSandboxSettings({ ...config, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: true })
    expect(SandboxManager.isAutoAllowBashIfSandboxedEnabled()).toBe(true)
    expect(shouldUseSandbox({ command: 'pwd', dangerouslyDisableSandbox: true })).toBe(true)
  } finally {
    SandboxManager.isSandboxingEnabled = originalEnabled
    restoreSettings(previous)
  }
})

test.skipIf(process.platform !== 'win32')('mandatory unavailable isolation blocks both native Windows shells', async () => {
  const previous = getSessionSettingsCache()
  try {
    setSandboxSettings({ enabled: true, allowUnsandboxedCommands: false })
    const blocked = SandboxManager.getShellSandboxBlockReason()
    expect(blocked).toContain('命令执行隔离不可用')
    const abort = new AbortController()
    for (const shell of ['bash', 'powershell'] as const) {
      const command = await exec('pwd', abort.signal, shell, { shouldUseSandbox: false })
      expect((await command.result).stderr).toBe(blocked)
    }
    setSandboxSettings({ enabled: true, allowUnsandboxedCommands: true })
    expect(SandboxManager.getShellSandboxBlockReason()).toBeUndefined()
    expect(SandboxManager.getShellSandboxBlockReason(true)).toContain('命令执行隔离不可用')
  } finally {
    restoreSettings(previous)
  }
})

test('a failed sandbox initialization never reaches the command wrapper', async () => {
  const previous = getSessionSettingsCache()
  const { isSupportedPlatform, checkDependencies, initialize, wrapWithSandbox } = BaseSandboxManager
  await SandboxManager.reset()
  BaseSandboxManager.isSupportedPlatform = () => true
  BaseSandboxManager.checkDependencies = () => ({ errors: [], warnings: [] })
  BaseSandboxManager.initialize = async () => { throw new Error('fixture initialization failed') }
  let wrapCalled = false
  BaseSandboxManager.wrapWithSandbox = async command => {
    wrapCalled = true
    return command
  }
  try {
    setSandboxSettings({ enabled: true, allowUnsandboxedCommands: false })
    const results = await Promise.allSettled([
      SandboxManager.initialize(), SandboxManager.wrapWithSandbox('pwd'),
    ])
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected'])
    expect(wrapCalled).toBe(false)
  } finally {
    Object.assign(BaseSandboxManager, { isSupportedPlatform, checkDependencies, initialize, wrapWithSandbox })
    restoreSettings(previous)
    await SandboxManager.reset()
  }
})
