import { expect, spyOn, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addChannelModels, addModelChannel, getCatalogDefault, getEditableModelCatalog,
  getModelCatalog, requireCatalogModel, saveRoleBinding, subscribeModelCatalog, updateModelChannelConnection,
} from './catalog.js'
import { resolveProviderRoute } from './index.js'

const config = {
  roles: { quark: 'deepseek::shared[1m]', atom: 'work::shared[1m]', electron: 'work::fast' },
  channels: {
    deepseek: {
      protocol: 'messages', baseURL: 'https://deepseek.test/anthropic',
      apiKeyEnv: 'NEXUS_TEST_DEEPSEEK_KEY', models: [{ id: 'shared[1m]', contextWindow: 1_000_000 }],
    },
    work: {
      protocol: 'openai-compatible', baseURL: 'https://work.test/api/v4',
      apiKeyEnv: 'NEXUS_TEST_WORK_KEY', models: [{ id: 'shared[1m]' }, { id: 'fast' }],
    },
  },
}

async function withCatalog(value: object | undefined, run: (dir: string) => void | Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'nexus-catalog-test-'))
  const previous = process.env.NEXUS_CONFIG_DIR
  process.env.NEXUS_CONFIG_DIR = directory
  try {
    if (value) writeFileSync(join(directory, 'models.json'), JSON.stringify(value))
    await run(directory)
  } finally {
    if (previous === undefined) delete process.env.NEXUS_CONFIG_DIR
    else process.env.NEXUS_CONFIG_DIR = previous
    rmSync(directory, { recursive: true, force: true })
  }
}

test('the three roles resolve independently and duplicate model IDs require a channel', async () => {
  await withCatalog(config, async () => {
    const { parseUserSpecifiedModel, getDefaultMainLoopModel, getDefaultMainLoopModelSetting, getElectronModel } =
      await import('../../../utils/model/model.js')
    const { getAgentModel } = await import('../../../utils/model/agent.js')
    expect(getDefaultMainLoopModelSetting()).toBe('quark')
    expect(getDefaultMainLoopModel()).toBe(config.roles.quark)
    expect(getCatalogDefault('atom')).toBe(config.roles.atom)
    expect(getCatalogDefault('electron')).toBe(config.roles.electron)
    expect(getAgentModel(undefined, config.roles.quark)).toBe(config.roles.quark)
    expect(getAgentModel('atom', config.roles.quark)).toBe(config.roles.atom)
    expect(getAgentModel('electron', config.roles.quark)).toBe(config.roles.electron)
    expect(getAgentModel('inherit', config.roles.quark)).toBe(config.roles.quark)
    expect(getElectronModel()).toBe(config.roles.electron)
    expect(parseUserSpecifiedModel('fast')).toBe(config.roles.electron)
    expect(() => requireCatalogModel('shared[1m]')).toThrow(/存在于多个渠道/)
    expect(requireCatalogModel(config.roles.atom).channel).toBe('work')
  })
})

test('an upstream model named sonnet is a physical ID, independent of the native Atom role', async () => {
  const custom = structuredClone(config)
  custom.channels.work.models.push({ id: 'sonnet' })
  await withCatalog(custom, async () => {
    const { getAtomModel, parseUserSpecifiedModel } = await import('../../../utils/model/model.js')
    expect(getAtomModel()).toBe(config.roles.atom)
    expect(parseUserSpecifiedModel('sonnet')).toBe('work::sonnet')
    expect(parseUserSpecifiedModel('opus')).toBe('opus')
    expect(parseUserSpecifiedModel('haiku')).toBe('haiku')
  })
})

test('plan-mode role selection and parent inheritance use the configured channel references', async () => {
  await withCatalog(config, async () => {
    const { getMainLoopModelOverride, setMainLoopModelOverride } = await import('../../../bootstrap/state.js')
    const { getAgentModel } = await import('../../../utils/model/agent.js')
    const { parseUserSpecifiedModel } = await import('../../../utils/model/model.js')
    const original = getMainLoopModelOverride()
    try {
      setMainLoopModelOverride('quarkplan')
      expect(parseUserSpecifiedModel('quarkplan')).toBe(config.roles.atom)
      expect(getAgentModel('inherit', config.roles.atom, undefined, 'plan')).toBe(config.roles.quark)
      setMainLoopModelOverride('electron')
      expect(getAgentModel('inherit', config.roles.electron, undefined, 'plan')).toBe(config.roles.atom)
      expect(getAgentModel('inherit', config.roles.electron, undefined, 'default')).toBe(config.roles.electron)
    } finally {
      setMainLoopModelOverride(original)
    }
  })
})

test('every role must name a registered channel and model', async () => {
  const invalid = { ...config, roles: { ...config.roles, electron: 'missing::fast' } }
  await withCatalog(invalid, directory => {
    expect(() => getModelCatalog(directory)).toThrow(/electron.*channel::model/)
  })
})

test('the official DeepSeek endpoint accepts legacy context hints while relays keep their exact model IDs', async () => {
  const id = 'deepseek-v4-pro[1m]'
  await withCatalog({
    roles: { quark: 'official::' + id, atom: 'relay::' + id, electron: 'official::' + id },
    channels: {
      official: { protocol: 'openai-compatible', baseURL: 'https://api.deepseek.com', models: [{ id }] },
      relay: { protocol: 'openai-compatible', baseURL: 'https://relay.test/v1', models: [{ id }] },
    },
  }, () => {
    expect(resolveProviderRoute('official::' + id).model).toBe('deepseek-v4-pro')
    expect(resolveProviderRoute('relay::' + id).model).toBe(id)
  })
})

test('missing channel credentials fail before routing to any provider', async () => {
  await withCatalog(config, () => {
    expect(() => resolveProviderRoute(config.roles.quark)).toThrow(/NEXUS_TEST_DEEPSEEK_KEY/)
  })
})

test('each channel sends its own wire model and credentials', async () => {
  await withCatalog(config, async () => {
    const previousDeepseekKey = process.env.NEXUS_TEST_DEEPSEEK_KEY
    const previousWorkKey = process.env.NEXUS_TEST_WORK_KEY
    process.env.NEXUS_TEST_DEEPSEEK_KEY = 'synthetic-deepseek'
    process.env.NEXUS_TEST_WORK_KEY = 'synthetic-work'
    const seen: Array<{ url: string; key: string | null; model: string }> = []
    const intercept = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body))
      const headers = new Headers(init?.headers)
      seen.push({ url, key: headers.get('x-api-key') ?? headers.get('authorization'), model: body.model })
      if (url.endsWith('/messages')) {
        return Response.json({ id: 'msg_test', type: 'message', role: 'assistant', model: body.model,
          content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 } })
      }
      return Response.json({ id: 'chatcmpl_test', object: 'chat.completion', created: 1, model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
    }
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(intercept, { preconnect: globalThis.fetch.preconnect }),
    )
    try {
      for (const value of Object.values(config.roles)) {
        const route = resolveProviderRoute(value)
        await route.adapter.generateText({ model: route.model, messages: [{ role: 'user', content: 'test' }], maxOutputTokens: 2 })
      }
      expect(seen).toEqual([
        { url: 'https://deepseek.test/anthropic/v1/messages', key: 'synthetic-deepseek', model: 'shared[1m]' },
        { url: 'https://work.test/api/v4/chat/completions', key: 'Bearer synthetic-work', model: 'shared[1m]' },
        { url: 'https://work.test/api/v4/chat/completions', key: 'Bearer synthetic-work', model: 'fast' },
      ])
    } finally {
      fetch.mockRestore()
      if (previousDeepseekKey === undefined) delete process.env.NEXUS_TEST_DEEPSEEK_KEY
      else process.env.NEXUS_TEST_DEEPSEEK_KEY = previousDeepseekKey
      if (previousWorkKey === undefined) delete process.env.NEXUS_TEST_WORK_KEY
      else process.env.NEXUS_TEST_WORK_KEY = previousWorkKey
    }
  })
})

test('opening legacy roles is read-only, saving preserves the existing endpoint, models and credential precedence', async () => {
  const legacyEnv = {
    NEXUS_BASE_URL: 'https://custom.test/v3',
    NEXUS_PROVIDER: 'openai-compatible',
    NEXUS_MODEL: 'main',
    NEXUS_QUARK_MODEL: 'main',
    NEXUS_ATOM_MODEL: 'review',
    NEXUS_ELECTRON_MODEL: 'fast',
    NEXUS_API_KEY: 'synthetic-api-key',
    NEXUS_AUTH_TOKEN: 'synthetic-auth-token',
  }
  const previous = Object.fromEntries(Object.keys(legacyEnv).map(key => [key, process.env[key]]))
  Object.assign(process.env, legacyEnv)
  try {
    await withCatalog(undefined, directory => {
      const filename = join(directory, 'models.json')
      const current = getEditableModelCatalog()
      expect(current.channels.current?.apiKeyEnv).toBe('NEXUS_AUTH_TOKEN')
      expect(current.channels.current?.baseURL).toBe('https://custom.test/v3')
      expect(current.roles).toEqual({ quark: 'current::main', atom: 'current::review', electron: 'current::fast' })
      expect(existsSync(filename)).toBe(false)
      expect(getModelCatalog()).toBeUndefined()

      let notifications = 0
      const unsubscribe = subscribeModelCatalog(() => { notifications++ })
      try {
        addModelChannel('other', { protocol: 'openai-compatible', baseURL: 'https://other.test', models: [{ id: 'fast' }] })
        saveRoleBinding('atom', 'other::fast')
        expect(getCatalogDefault('atom')).toBe('other::fast')
        expect(getCatalogDefault('quark')).toBe('current::main')
        expect(getCatalogDefault('electron')).toBe('current::fast')
        expect(resolveProviderRoute('other::fast').model).toBe('fast')
        expect(getEditableModelCatalog().channels.other?.apiKeyEnv).toBeUndefined()
        expect(notifications).toBe(2)
        const saved = readFileSync(filename, 'utf8')
        expect(saved).toContain('NEXUS_AUTH_TOKEN')
        expect(saved).not.toContain('synthetic-')
      } finally {
        unsubscribe()
      }
    })
    process.env.NEXUS_PROVIDER = 'messages'
    process.env.NEXUS_BASE_URL = 'https://api.deepseek.com/anthropic'
    await withCatalog(undefined, async directory => {
      const preview = getEditableModelCatalog()
      expect(preview.channels.deepseek?.apiKeyEnv).toBe('NEXUS_API_KEY')
      expect(preview.channels.deepseek?.models.map(model => model.id)).toEqual([
        'main', 'review', 'fast', 'deepseek-v4-pro', 'deepseek-flash',
      ])
      expect(preview.roles).toEqual({ quark: 'deepseek::main', atom: 'deepseek::review', electron: 'deepseek::fast' })
      expect(existsSync(join(directory, 'models.json'))).toBe(false)

      const { validateModel } = await import('../../../utils/model/validateModel.js')
      const fetch = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Configured model selection must not make a request'))
      try {
        expect(await validateModel('deepseek-flash')).toEqual({ valid: true })
        expect(fetch).not.toHaveBeenCalled()
        expect(resolveProviderRoute('deepseek-flash').model).toBe('deepseek-flash')
      } finally {
        fetch.mockRestore()
      }

      saveRoleBinding('electron', 'deepseek::deepseek-flash')
      expect(getCatalogDefault('electron')).toBe('deepseek::deepseek-flash')
      expect(getCatalogDefault('quark')).toBe('deepseek::main')
      expect(getCatalogDefault('atom')).toBe('deepseek::review')
    })
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('role binding merges concurrent disk edits, preserves unknown fields and avoids partial writes', async () => {
  await withCatalog(config, directory => {
    const filename = join(directory, 'models.json')
    expect(getCatalogDefault('quark')).toBe(config.roles.quark)
    const newest = {
      ...config, futureField: { version: 4 },
      roles: { ...config.roles, quark: config.roles.atom, experimentalRole: 'future' },
      channels: { ...config.channels, work: {
        ...config.channels.work, description: 'special',
        models: [{ id: 'shared[1m]', extra: 7 }, { id: 'fast' }],
      } },
    }
    writeFileSync(filename, JSON.stringify(newest))
    saveRoleBinding('electron', config.roles.quark)
    expect(getCatalogDefault('quark')).toBe(config.roles.atom)
    expect(JSON.parse(readFileSync(filename, 'utf8'))).toEqual({
      ...newest, roles: { ...newest.roles, electron: config.roles.quark },
    })
    addChannelModels('work', ['r2', 'r3'])
    const valid = readFileSync(filename, 'utf8')
    expect(() => addChannelModels('work', ['r4', 'r2'])).toThrow(/重复/)
    expect(() => addChannelModels('work', ['bad\x1b[31m'])).toThrow(/无效字段/)
    expect(() => saveRoleBinding('atom', 'missing::x')).toThrow(/atom/)
    expect(() => addModelChannel('work', { protocol: 'messages', baseURL: 'https://another.test', models: [{ id: 'unused' }] })).toThrow(/已存在/)
    expect(readFileSync(filename, 'utf8')).toBe(valid)
    mkdirSync(filename + '.lock')
    expect(() => saveRoleBinding('quark', config.roles.quark)).toThrow(/正在保存/)
    expect(readFileSync(filename, 'utf8')).toBe(valid)
  })
})

test('an invalid external configuration is never overwritten by a stale editor', async () => {
  await withCatalog(config, directory => {
    expect(getEditableModelCatalog().roles.atom).toBe(config.roles.atom)
    const filename = join(directory, 'models.json')
    writeFileSync(filename, 'invalid')
    expect(() => saveRoleBinding('atom', config.roles.quark)).toThrow(/有效的 JSON/)
    expect(readFileSync(filename, 'utf8')).toBe('invalid')
  })
})

test('editing a channel updates only its connection and retains concurrent model additions and role bindings', async () => {
  await withCatalog(config, dir => {
    const filename = join(dir, 'models.json')
    const opened = getEditableModelCatalog().channels.work!
    const latest = { ...config, channels: { ...config.channels, work: {
      ...config.channels.work, labels: ['manual'], models: [...config.channels.work.models, { id: 'new', contextWindow: 92000, custom: true }],
    } } }
    writeFileSync(filename, JSON.stringify(latest))
    const updated = updateModelChannelConnection('work', opened, {
      protocol: 'messages', baseURL: 'https://new.test/relay', apiKeyEnv: 'NEW_CHANNEL_KEY',
    })
    expect(updated.roles).toEqual(config.roles)
    expect(updated.channels.deepseek).toEqual({ ...config.channels.deepseek, protocol: 'messages' })
    expect(updated.channels.work).toEqual({ ...latest.channels.work, protocol: 'messages', baseURL: 'https://new.test/relay', apiKeyEnv: 'NEW_CHANNEL_KEY' })
    expect(getModelCatalog()?.config.channels.work?.baseURL).toBe('https://new.test/relay')
    expect(() => updateModelChannelConnection('work', opened, opened)).toThrow(/已变更/)
    expect(JSON.parse(readFileSync(filename, 'utf8'))).toEqual(updated)
  })
})

test('a new origin cannot inherit an old key or borrow a key from a different channel', async () => {
  await withCatalog(config, dir => {
    const filename = join(dir, 'models.json')
    const before = readFileSync(filename, 'utf8')
    const channel = getEditableModelCatalog().channels.work!
    expect(() => updateModelChannelConnection('work', channel, { ...channel, baseURL: 'https://elsewhere.test/v1' })).toThrow(/独立变量/)
    expect(() => updateModelChannelConnection('work', channel, { ...channel, apiKeyEnv: config.channels.deepseek.apiKeyEnv })).toThrow(/独立变量/)
    expect(() => addModelChannel('bad', { ...channel, baseURL: 'https://third.test/v1' })).toThrow(/独立变量/)
    expect(readFileSync(filename, 'utf8')).toBe(before)
    const sameOrigin = updateModelChannelConnection('work', channel, { ...channel, baseURL: 'https://work.test/next' })
    expect(sameOrigin.channels.work?.apiKeyEnv).toBe(channel.apiKeyEnv)
    const withoutKey = updateModelChannelConnection('work', sameOrigin.channels.work!, { protocol: 'openai-compatible', baseURL: 'http://localhost:7333/v1' })
    expect(withoutKey.channels.work?.apiKeyEnv).toBeUndefined()
  })
})

test('adding the first channel to an empty profile initializes the three roles together', async () => {
  const previous = process.env.NEXUS_BASE_URL
  delete process.env.NEXUS_BASE_URL
  try {
    await withCatalog(undefined, () => {
      expect(getEditableModelCatalog().channels).toEqual({})
      const newConfig = addModelChannel('local', {
        protocol: 'openai-compatible', baseURL: 'http://localhost:1234/v1', models: [{ id: 'starter' }],
      })
      expect(newConfig.roles).toEqual({ quark: 'local::starter', atom: 'local::starter', electron: 'local::starter' })
      expect(getCatalogDefault()).toBe('local::starter')
    })
  } finally {
    if (previous === undefined) delete process.env.NEXUS_BASE_URL
    else process.env.NEXUS_BASE_URL = previous
  }
})
