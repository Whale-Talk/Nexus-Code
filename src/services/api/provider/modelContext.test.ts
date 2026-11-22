import { expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import { enableConfigs } from '../../../utils/config.js'
import { createUserMessage } from '../../../utils/messages.js'
import { asSystemPrompt } from '../../../utils/systemPromptType.js'
import { queryModelWithStreaming } from '../inference.js'
import { getContextWindowForModel, getModelBudgetDetails, getModelMaxOutputTokens, modelSupports1M } from '../../../utils/context.js'
import { getAutoCompactThreshold } from '../../compact/autoCompact.js'
import { parseUserSpecifiedModel } from '../../../utils/model/model.js'
import { loadAccountContextWindow, getWireContextModelId } from './modelContext.js'
import type { CatalogConfig, ProviderKind } from './catalog.js'

const envKeys = ['NEXUS_CONFIG_DIR', 'NEXUS_PROVIDER', 'NEXUS_BASE_URL', 'NEXUS_MODEL', 'NEXUS_QUARK_MODEL',
  'NEXUS_AUTH_TOKEN', 'NEXUS_API_KEY', 'NEXUS_DISABLE_1M_CONTEXT', 'NEXUS_MAX_CONTEXT_TOKENS',
  'NEXUS_AUTO_COMPACT_WINDOW', 'NEXUS_AUTOCOMPACT_PCT_OVERRIDE', 'NEXUS_MAX_OUTPUT_TOKENS',
  'NEXUS_DISABLE_NONESSENTIAL_TRAFFIC', 'NODE_ENV', 'FORCE_VCR'] as const

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
      ['messages', 'https://api.minimax.cn/anthropic', 'MiniMax-M3.1-Flash', 1_000_000],
      ['openai-compatible', 'https://api.minimax.cn/v1', 'MiniMax-M3', 1_000_000],
      ['openai-compatible', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen4-max', 1_000_000],
      ['openai-compatible', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen3.8-flash', 1_000_000],
      ['openai-compatible', 'https://ark.cn-beijing.volces.com/api/v3', 'doubao-seed-2-1-pro-260915', 1_048_576],
      ['openai-compatible', 'https://ark.cn-beijing.volces.com/api/v3', 'doubao-seed-2-1-lite-260915', 1_048_576],
      ['openai-compatible', 'https://ark.cn-beijing.volces.com/api/v3', 'doubao-seed-2-1-turbo-260628', 262_144],
      ['openai-compatible', 'https://api.stepfun.com/v1', 'step-3.7-flash', 262_144],
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

test('model budget details identify the source and bound output without modifying the declared maximum', async () => {
  await withProfile({
    roles: { quark: 'local::manual', atom: 'local::discovered', electron: 'official::deepseek-flash' },
    channels: {
      official: { protocol: 'messages', baseURL: 'https://api.deepseek.com/anthropic', models: [{ id: 'deepseek-flash' }] },
      local: { protocol: 'openai-compatible', baseURL: 'https://work.test/v1', models: [
        { id: 'manual', contextWindow: 12_000, outputBudget: 20_000, maxOutputTokens: 7_000,
          discoveredContextWindow: 50_000, discoveredMaxOutputTokens: 5_000 },
        { id: 'discovered', discoveredContextWindow: 24_000, discoveredMaxOutputTokens: 4_096 },
        { id: 'unknown' },
      ] },
    },
  }, () => {
    expect(getModelBudgetDetails('local::manual')).toEqual({
      contextWindow: 12_000, contextSource: 'manual', outputBudget: 7_000, outputLimit: 7_000,
    })
    expect(getModelBudgetDetails('local::discovered')).toEqual({
      contextWindow: 24_000, contextSource: 'channel', outputBudget: 4_096, outputLimit: 4_096,
    })
    expect(getModelBudgetDetails('official::deepseek-flash')).toEqual({
      contextWindow: 1_000_000, contextSource: 'official', outputBudget: 32_000,
    })
    expect(getModelBudgetDetails('local::unknown')).toEqual({
      contextWindow: 200_000, contextSource: 'fallback', outputBudget: 32_000,
    })
    process.env.NEXUS_MAX_CONTEXT_TOKENS = '4096'
    expect(getModelBudgetDetails('local::manual')).toMatchObject({ contextWindow: 4_096, outputBudget: 4_095 })
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


test('a normal model request obeys the output budget and its estimated prompt headroom', async () => {
  const requested: { model: string; maxTokens: number }[] = []
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    expect(new URL(request.url).pathname).toBe('/v1/messages')
    const body = await request.json() as { model: string; max_tokens: number }
    requested.push({ model: body.model, maxTokens: body.max_tokens })
    const message = { type: 'message', id: 'budget-' + requested.length, role: 'assistant', model: body.model,
      content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 20, output_tokens: 1 } }
    const events = [
      { type: 'message_start', message },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
      { type: 'message_stop' },
    ]
    return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''), {
      headers: { 'content-type': 'text/event-stream' },
    })
  } })
  const hadMacro = Object.hasOwn(globalThis, 'MACRO')
  if (!hadMacro) Object.defineProperty(globalThis, 'MACRO', { configurable: true, value: { VERSION: 'fixture' } })
  try {
    await withProfile({
      roles: { quark: 'local::large', atom: 'local::small', electron: 'local::unconfigured' },
      channels: {
        local: { protocol: 'messages', baseURL: server.url.href, apiKeyEnv: 'NEXUS_API_KEY', models: [
          { id: 'large', contextWindow: 32_000, maxOutputTokens: 4_000, outputBudget: 6_000 },
          { id: 'small', contextWindow: 32_000, maxOutputTokens: 4_000, outputBudget: 1_200 },
          { id: 'unconfigured', contextWindow: 32_000, maxOutputTokens: 4_000 },
        ] },
      },
    }, async () => {
      process.env.NEXUS_API_KEY = 'budget-test-only'
      process.env.NEXUS_DISABLE_NONESSENTIAL_TRAFFIC = '1'
      // Exercise the connection directly instead of writing/replaying recordings.
      process.env.NODE_ENV = 'production'
      enableConfigs()
      const run = async (modelId: string, querySource: string, length: number, maxOutputTokensOverride?: number) => {
        const events = await Array.fromAsync(queryModelWithStreaming({
          messages: [createUserMessage({ content: 'f'.repeat(length) })],
          systemPrompt: asSystemPrompt(['s'.repeat(4_000)]),
          thinkingConfig: { type: 'disabled' },
          tools: [],
          signal: new AbortController().signal,
          options: {
            model: 'local::' + modelId,
            querySource,
            maxOutputTokensOverride,
            getToolPermissionContext: async () => getEmptyToolPermissionContext(),
            isNonInteractiveSession: true,
            agents: [],
            mcpTools: [],
            hasAppendSystemPrompt: false,
          },
        }))
        expect(events.some(event => event.type === 'assistant' && !event.isApiErrorMessage)).toBe(true)
        expect(requested.at(-1)?.model).toBe(modelId)
        return requested.at(-1)!.maxTokens
      }
      expect(await run('large', 'sdk', 20)).toBe(4_000)
      const nearLimit = await run('large', 'sdk', 122_000, 9_000)
      expect(nearLimit).toBeGreaterThan(0)
      expect(nearLimit).toBeLessThanOrEqual(500)
      expect(await run('small', 'sdk', 20, 6_000)).toBe(1_200)
      expect(await run('small', 'compact', 20, 3_000)).toBe(3_000)
      expect(await run('unconfigured', 'sdk', 122_000, 3_800)).toBe(3_800)
      process.env.NEXUS_MAX_OUTPUT_TOKENS = '900'
      expect(await run('small', 'sdk', 20)).toBe(900)
      expect(requested).toHaveLength(6)
    })
  } finally {
    server.stop(true)
    if (!hadMacro) Reflect.deleteProperty(globalThis, 'MACRO')
  }
})
