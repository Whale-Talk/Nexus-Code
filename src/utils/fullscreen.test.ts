import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getIsInteractive, setIsInteractive } from '../bootstrap/state.js'
import {
  _resetForTesting,
  getTerminalDisplayPreference,
  getTerminalDisplayStatus,
} from './fullscreen.js'
import { updateSettingsForSource } from './settings/settings.js'
import { resetSettingsCache } from './settings/settingsCache.js'

type TerminalProbe = {
  platform?: NodeJS.Platform
  stdin?: boolean
  stdout?: boolean
  interactive?: boolean
  env?: Record<string, string>
}

function withTerminal(preference: string | undefined, probe: TerminalProbe, check: () => void) {
  const configDir = mkdtempSync(join(tmpdir(), 'nexus-display-'))
  const env = {
    NEXUS_CONFIG_DIR: configDir,
    NEXUS_NO_FLICKER: undefined,
    NEXUS_BUILD_FLAVOR: undefined,
    TERM: 'xterm-256color',
    TERM_PROGRAM: undefined,
    TMUX: undefined,
    STY: undefined,
    WT_SESSION: 'test',
    ...probe.env,
  }
  const environmentBefore = Object.keys(env).map(key => [key, process.env[key]] as const)
  const interactiveBefore = getIsInteractive()
  const properties = [
    [process, 'platform', probe.platform ?? 'win32'],
    [process.stdin, 'isTTY', probe.stdin ?? true],
    [process.stdout, 'isTTY', probe.stdout ?? true],
  ] as const
  const restoreProperties = properties.map(([object, key]) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    return () => {
      if (descriptor) Object.defineProperty(object, key, descriptor)
      else Reflect.deleteProperty(object, key)
    }
  })
  try {
    if (preference !== undefined) {
      writeFileSync(join(configDir, 'settings.json'), JSON.stringify({ terminalDisplayMode: preference }))
    }
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    for (const [object, key, value] of properties) {
      Object.defineProperty(object, key, { configurable: true, value })
    }
    setIsInteractive(probe.interactive ?? true)
    resetSettingsCache()
    _resetForTesting()
    check()
  } finally {
    for (const restore of restoreProperties) restore()
    for (const [key, value] of environmentBefore) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    setIsInteractive(interactiveBefore)
    resetSettingsCache()
    _resetForTesting()
    rmSync(configDir, { recursive: true, force: true })
  }
}

test('auto chooses fullscreen with native Windows Terminal and classic with embedded or other terminals', () => {
  withTerminal(undefined, {}, () => {
    expect(getTerminalDisplayStatus()).toEqual({ mode: 'fullscreen', source: 'auto' })
  })
  withTerminal('auto', { env: { TERM_PROGRAM: 'vscode' } }, () => {
    expect(getTerminalDisplayStatus()).toEqual({ mode: 'classic', source: 'auto' })
  })
  withTerminal('obsolete', { platform: 'linux' }, () => {
    expect(getTerminalDisplayPreference()).toBe('auto')
    expect(getTerminalDisplayStatus()).toEqual({ mode: 'classic', source: 'auto' })
  })
})

test('saved display settings take effect at launch and cannot change a mounted layout', () => {
  withTerminal('fullscreen', { env: { WT_SESSION: '' } }, () => {
    expect(getTerminalDisplayStatus()).toEqual({ mode: 'fullscreen', source: 'settings' })
  })
  withTerminal('classic', {}, () => {
    expect(getTerminalDisplayStatus()).toEqual({ mode: 'classic', source: 'settings' })
  })
  withTerminal('auto', {}, () => {
    expect(getTerminalDisplayStatus()).toEqual({ mode: 'fullscreen', source: 'auto' })
    expect(updateSettingsForSource('userSettings', { terminalDisplayMode: 'classic' }).error).toBeNull()
    expect(getTerminalDisplayPreference()).toBe('classic')
    expect(getTerminalDisplayStatus()).toEqual({ mode: 'fullscreen', source: 'auto' })
  })
})

test('explicit environment values take precedence over saved display settings', () => {
  withTerminal('fullscreen', { env: { NEXUS_NO_FLICKER: '0' } }, () => {
    expect(getTerminalDisplayStatus()).toEqual({ mode: 'classic', source: 'environment' })
  })
  withTerminal('classic', { env: { NEXUS_NO_FLICKER: 'YeS' } }, () => {
    expect(getTerminalDisplayStatus()).toEqual({ mode: 'fullscreen', source: 'environment' })
  })
})

test('saved fullscreen respects incompatible terminal modes and the existing environment escape hatch', () => {
  withTerminal('fullscreen', { env: { TERM: 'dumb' } }, () => {
    expect(getTerminalDisplayStatus()).toEqual({ mode: 'classic', source: 'dumb' })
  })
  const tmuxEnv = { TERM_PROGRAM: 'iTerm.app', TMUX: 'test' }
  withTerminal('fullscreen', { env: tmuxEnv }, () => {
    expect(getTerminalDisplayStatus()).toEqual({ mode: 'classic', source: 'tmux' })
  })
  withTerminal('classic', { env: { ...tmuxEnv, NEXUS_NO_FLICKER: '1' } }, () => {
    expect(getTerminalDisplayStatus()).toEqual({ mode: 'fullscreen', source: 'environment' })
  })
})

test.each([{ stdin: false }, { stdout: false }, { interactive: false }])(
  'non-interactive output does not use the alternate screen (%j)',
  probe => {
    withTerminal('fullscreen', { ...probe, env: { NEXUS_NO_FLICKER: '1' } }, () => {
      expect(getTerminalDisplayStatus()).toEqual({ mode: 'classic', source: 'non-interactive' })
    })
  },
)

test('a non-interactive startup probe leaves the display choice open for the REPL', () => {
  withTerminal('fullscreen', { interactive: false }, () => {
    expect(getTerminalDisplayStatus()).toEqual({ mode: 'classic', source: 'non-interactive' })
    setIsInteractive(true)
    expect(getTerminalDisplayStatus()).toEqual({ mode: 'fullscreen', source: 'settings' })
  })
})
