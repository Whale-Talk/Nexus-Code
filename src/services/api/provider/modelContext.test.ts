import { expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getContextWindowForModel, getModelMaxOutputTokens, modelSupports1M } from '../../../utils/context.js'
import { getAutoCompactThreshold } from '../../compact/autoCompact.js'
import { parseUserSpecifiedModel } from '../../../utils/model/model.js'
import { loadAccountContextWindow, getWireContextModelId } from './modelContext.js'
import type { CatalogConfig, ProviderKind } from './catalog.js'

const envKeys = ['NEXUS_CONFIG_DIR', 'NEXUS_PROVIDER', 'NEXUS_BASE_URL', 'NEXUS_MODEL', 'NEXUS_QUARK_MODEL',
  'NEXUS_AUTH_TOKEN', 'NEXUS_API_KEY', 'NEXUS_DISABLE_1M_CONTEXT', 'NEXUS_MAX_CONTEXT_TOKENS',
  'NEXUS_AUTO_COMPACT_WINDOW', 'NEXUS_AUTOCOMPACT_PCT_OVERRIDE'] as const

async function withProfile(config: CatalogConfig | undefined, run: () => void | Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'nexus-context-'))
  const previous = envKeys.map(key => process.env[key])
  for (const key of envKeys) delete process.env[key]
  process.env.NEXUS_CONFIG_DIR = directory
  try {
    if (config) writeFileSync(join(directory, 'models.json'), JSON.stringify(config))
    await run()
  } finally {
    envKeys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key]
      else process.env[key] = previous[index]!
    })
    rmSync(directory, { recursive: true, force: true })
  }
}

test('official channels use their documented context limits without a model suffix', async () => {
  await withProfile(undefined, () => {
    const cases: [ProviderKind, string, string, number][] = [
      ['messages', 'https://api.deepseek.com/anthropic', 'deepseek-v4-pro', 1_000_000],
      ['openai-compatible', 'https://api.deepseek.com/v1', 'deepseek-flash', 1_000_000],
      ['messages', 'https://open.bigmodel.cn/api/anthropic', 'glm-5.3', 1_000_000],
      ['openai-compatible', 'https://api.z.ai/api/paas/v4', 'glm-5.2', 1_000_000],
      ['openai-compatible', 'https://api.z.ai/api/paas/v4', 'glm-5.3-flashx', 1_000_000],
      ['openai-compatible', 'https://api.z.ai/api/paas/v4', 'glm-5.1', 200_000],
      ['openai-compatible', 'https://api.z.ai/api/paas/v4', 'glm-4.5', 128_000],
      ['messages', 'https://api.moonshot.ai/anthropic', 'kimi-k3', 1_048_576],
      ['openai-compatible', 'https://api.moonshot.cn/v1', 'kimi-k2.6', 262_144],
      ['openai-compatible', 'https://api.kimi.com/coding/v1', 'k3-256k', 262_144],
      ['openai-compatible', 'https://api.kimi.com/coding/v1', 'kimi-for-coding', 1_048_576],
      ['openai-compatible', 'https://api.xiaomimimo.com/v1', 'mimo-v2.6-pro', 1_048_576],
      ['messages', 'https://token-plan-sgp.xiaomimimo.com/anthropic', 'mimo-v2.6-pro-ultraspeed', 1_048_576],
    ]
    for (const [protocol, baseURL, model, expected] of cases) {
      process.env.NEXUS_PROVIDER = protocol
      process.env.NEXUS_BASE_URL = baseURL
      process.env.NEXUS_MODEL = model
      expect(getContextWindowForModel(model)).toBe(expected)
      expect(getContextWindowForModel(model + '[1m]')).toBe(expected)
      expect(parseUserSpecifiedModel('quark[1m]')).toBe(model)
      expect(getWireContextModelId({ protocol, baseURL }, model + '[1m]')).toBe(model)
    }
  })
})

test('same model names on a relay keep the configured cap and preserve literal wire IDs', async () => {
  await withProfile({
    roles: { quark: 'official::deepseek-flash', atom: 'relay::deepseek-flash', electron: 'relay::local-small' },
    channels: {
      official: { protocol: 'messages', baseURL: 'https://api.deepseek.com/anthropic', models: [{ id: 'deepseek-flash' }] },
      relay: { protocol: 'openai-compatible', baseURL: 'https://api.deepseek.com.relay.test/v1', models: [
        { id: 'deepseek-flash', contextWindow: 97_000, discoveredContextWindow: 121_000 },
        { id: 'local-small', discoveredContextWindow: 4_096 },
        { id: 'kimi-k3' }, { id: 'deepseek-flash[1m]' },
      ] },
    },
  }, () => {
    expect(getContextWindowForModel('official::deepseek-flash')).toBe(1_000_000)
    expect(getContextWindowForModel('relay::deepseek-flash')).toBe(97_000)
    expect(getContextWindowForModel('relay::kimi-k3')).toBe(200_000)
    expect(getContextWindowForModel('relay::local-small')).toBe(4_096)
    expect(getModelMaxOutputTokens('relay::local-small')).toEqual({ default: 1_024, upperLimit: 4_095 })
    expect(getAutoCompactThreshold('relay::local-small')).toBeGreaterThan(0)
    expect(getAutoCompactThreshold('relay::local-small')).toBeLessThan(4_096)
    expect(getWireContextModelId({ protocol: 'openai-compatible', baseURL: 'https://api.deepseek.com.relay.test/v1' },
      'deepseek-flash[1m]')).toBe('deepseek-flash[1m]')
    process.env.NEXUS_MAX_CONTEXT_TOKENS = '140000'
    expect(getContextWindowForModel('official::deepseek-flash')).toBe(140_000)
    expect(modelSupports1M('official::deepseek-flash')).toBe(false)
    delete process.env.NEXUS_MAX_CONTEXT_TOKENS
    process.env.NEXUS_DISABLE_1M_CONTEXT = '1'
    expect(getContextWindowForModel('official::deepseek-flash')).toBe(200_000)
    expect(getContextWindowForModel('relay::local-small')).toBe(4_096)
  })
})

test('Kimi Code resolves account-specific limits once per credential without switching models', async () => {
  await withProfile(undefined, async () => {
    process.env.NEXUS_BASE_URL = 'https://api.kimi.com/coding'
    process.env.NEXUS_PROVIDER = 'messages'
    process.env.NEXUS_API_KEY = 'lower-plan-fixture'
    const calls: [string, string | null][] = []
    const intercept = async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = new Headers(init?.headers).get('authorization')
      calls.push([String(input), key])
      const context = key === 'Bearer higher-plan-fixture' ? 1_048_576 : 262_144
      return Response.json({ data: [{ id: 'k3', limit: { context } }, { id: 'k3.1-pro', limit: { context } }] })
    }
    const mock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(intercept, { preconnect: fetch.preconnect }))
    const signal = new AbortController().signal
    try {
      expect(getContextWindowForModel('k3')).toBe(262_144)
      await Promise.all([loadAccountContextWindow('k3', signal), loadAccountContextWindow('k3.1-pro', signal)])
      expect(calls).toEqual([['https://api.kimi.com/coding/v1/models', 'Bearer lower-plan-fixture']])
      expect(getContextWindowForModel('k3')).toBe(262_144)
      process.env.NEXUS_API_KEY = 'higher-plan-fixture'
      expect(getContextWindowForModel('k3')).toBe(262_144)
      await loadAccountContextWindow('k3', signal)
      await loadAccountContextWindow('k3-256k', signal)
      expect(getContextWindowForModel('k3')).toBe(1_048_576)
      expect(getContextWindowForModel('k3.1-pro')).toBe(1_048_576)
      expect(getContextWindowForModel('k3-256k')).toBe(262_144)
      expect(calls).toHaveLength(2)
    } finally {
      mock.mockRestore()
    }
  })
})

test('a Kimi Code account lookup failure cannot revive a prior account window', async () => {
  await withProfile({
    roles: { quark: 'kimi::k3', atom: 'kimi::k3', electron: 'kimi::k3' },
    channels: { kimi: {
      protocol: 'openai-compatible', baseURL: 'https://api.kimi.ai/coding/v1', apiKeyEnv: 'NEXUS_API_KEY',
      models: [{ id: 'k3', discoveredContextWindow: 1_048_576 }, { id: 'k3.1-pro', contextWindow: 200_000 }],
    } },
  }, async () => {
    process.env.NEXUS_API_KEY = 'changed-plan-fixture'
    const mock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async () =>
      new Response(null, { status: 503 }), { preconnect: fetch.preconnect }))
    const signal = new AbortController().signal
    try {
      await loadAccountContextWindow('kimi::k3.1-pro', signal)
      expect(mock).not.toHaveBeenCalled()
      expect(getContextWindowForModel('kimi::k3.1-pro')).toBe(200_000)
      await loadAccountContextWindow('kimi::k3', signal)
      expect(mock).toHaveBeenCalledTimes(1)
      expect(getContextWindowForModel('kimi::k3')).toBe(262_144)
    } finally {
      mock.mockRestore()
    }
  })
})
