import { expect, spyOn, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDefaultAppState, type AppState } from '../../state/AppStateStore.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { call } from './model.js'

async function withProfile(run: (profile: string, invoke: (arg: string) => Promise<void>, read: () => AppState, notice: () => string) => Promise<void>) {
  const profile = mkdtempSync(join(tmpdir(), 'nexus-model-command-'))
  const previousProfile = process.env.NEXUS_CONFIG_DIR
  const fetch = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Role selection must stay local'))
  try {
    process.env.NEXUS_CONFIG_DIR = profile
    resetSettingsCache()
    writeFileSync(join(profile, 'settings.json'), JSON.stringify({ model: 'quark', effortLevel: 'high' }))
    writeFileSync(join(profile, 'models.json'), JSON.stringify({
      roles: { quark: 'work::Large', atom: 'work::Mid', electron: 'work::Small' },
      channels: { work: { protocol: 'openai-compatible', baseURL: 'http://127.0.0.1:9/v1', models: [
        { id: 'Large' }, { id: 'Mid' }, { id: 'Small' },
      ] } },
    }))

    let state: AppState = { ...getDefaultAppState(), mainLoopModel: 'quark', mainLoopModelForSession: 'electron' }
    let message = ''
    const context = {
      getAppState: () => state,
      setAppState: (update: (previous: AppState) => AppState) => { state = update(state) },
    } as Parameters<typeof call>[1]
    const invoke = async (arg: string) => { await call(text => { message = text ?? '' }, context, arg) }
    await run(profile, invoke, context.getAppState, () => message)
    expect(fetch).not.toHaveBeenCalled()
  } finally {
    fetch.mockRestore()
    if (previousProfile === undefined) delete process.env.NEXUS_CONFIG_DIR
    else process.env.NEXUS_CONFIG_DIR = previousProfile
    resetSettingsCache()
    rmSync(profile, { recursive: true, force: true })
  }
}

test('model switches the active role with normalized input and leaves both settings files intact', async () => {
  await withProfile(async (profile, invoke, read, notice) => {
    const paths = ['settings.json', 'models.json'].map(path => join(profile, path))
    const before = paths.map(path => readFileSync(path, 'utf8'))
    await invoke('  ATOM  ')
    expect(read().mainLoopModel).toBe('atom')
    expect(read().mainLoopModelForSession).toBeNull()
    expect(notice()).toContain('Atom · Mid (work)')
    expect(paths.map(path => readFileSync(path, 'utf8'))).toEqual(before)
  })
})

test('model sends physical IDs and legacy configuration arguments to settings', async () => {
  await withProfile(async (_profile, invoke, read, notice) => {
    for (const arg of ['work::Mid', 'deepseek-flash', 'roles', 'quarkplan', 'default']) {
      await invoke(arg)
      expect(read().mainLoopModel).toBe('quark')
      expect(notice()).toContain('Ctrl+P → 模型 → 角色绑定')
    }
  })
})

test('model refuses a role whose binding is denied by the model policy', async () => {
  await withProfile(async (profile, invoke, read, notice) => {
    writeFileSync(join(profile, 'settings.json'), JSON.stringify({ availableModels: ['work::Large'] }))
    resetSettingsCache()
    await invoke('atom')
    expect(read().mainLoopModel).toBe('quark')
    expect(notice()).toContain('受模型使用策略限制')
  })
})
