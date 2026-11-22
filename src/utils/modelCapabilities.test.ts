import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getContextWindowForModel, getModelMaxOutputTokens } from './context.js'
import { getSupportedEffortLevels, modelSupportsEffort, modelSupportsMaxEffort } from './effort.js'
import { isFastModeSupportedByModel } from './fastMode.js'
import { calculateCostFromTokens, getModelPricingString } from './modelCost.js'
import { getThinkingAvailability, modelSupportsAdaptiveThinking, modelSupportsThinking } from './thinking.js'
import { SettingsSchema } from './settings/types.js'
import { modelSupportsToolReference } from './toolSearch.js'

test('two channels using the same model ID keep separate limits, capabilities and prices', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-capability-test-'))
  const previous = process.env.NEXUS_CONFIG_DIR
  const id = 'shared'
  const alpha = 'alpha::shared'
  const beta = 'beta::shared'
  const catalog = {
    roles: { quark: beta, atom: alpha, electron: alpha },
    channels: {
      alpha: { protocol: 'messages', baseURL: 'http://localhost/alpha', models: [{
        id, contextWindow: 1_000_000, maxOutputTokens: 4096,
        capabilities: { thinking: true, adaptiveThinking: false, effort: true, maxEffort: true, fastMode: true, toolReference: true },
        pricing: { inputTokens: 1, outputTokens: 2, promptCacheReadTokens: 0.2, promptCacheWriteTokens: 1.5 },
      }] },
      beta: { protocol: 'openai-compatible', baseURL: 'http://localhost/beta', models: [{
        id, contextWindow: 65536, maxOutputTokens: 2048,
        capabilities: { thinking: false, effort: false, fastMode: false, toolReference: false },
      }] },
      official: { protocol: 'openai-compatible', baseURL: 'https://api.z.ai/api/paas/v4',
        models: [{ id: 'glm-5.3' }, { id: 'glm-5.2' }] },
      relay: { protocol: 'openai-compatible', baseURL: 'https://relay.example/v1',
        models: [{ id: 'glm-5.3' }, { id: 'glm-5.2', reasoningDialect: 'glm' }] },
    },
  }
  try {
    process.env.NEXUS_CONFIG_DIR = dir
    writeFileSync(join(dir, 'models.json'), JSON.stringify(catalog))
    expect(getContextWindowForModel(alpha)).toBe(1_000_000)
    expect(getContextWindowForModel(beta)).toBe(65536)
    expect(getModelMaxOutputTokens(beta)).toEqual({ default: 2048, upperLimit: 2048 })
    expect(modelSupportsThinking(alpha)).toBe(true)
    expect(modelSupportsThinking(beta)).toBe(false)
    expect(modelSupportsAdaptiveThinking(alpha)).toBe(false)
    expect(modelSupportsMaxEffort(alpha)).toBe(true)
    expect(modelSupportsEffort(beta)).toBe(false)
    expect(getThinkingAvailability('official::glm-5.3')).toBe('always')
    expect(getSupportedEffortLevels('official::glm-5.3')).toEqual(['low', 'high', 'max'])
    expect(getThinkingAvailability('relay::glm-5.3')).toBe('unsupported')
    expect(getThinkingAvailability('relay::glm-5.2')).toBe('toggle')
    expect(getSupportedEffortLevels('relay::glm-5.2')).toEqual(['high', 'max'])
    expect(isFastModeSupportedByModel('quark')).toBe(false)
    expect(isFastModeSupportedByModel('atom')).toBe(true)
    expect(modelSupportsToolReference(alpha)).toBe(true)
    expect(modelSupportsToolReference(beta)).toBe(false)
    expect(getModelPricingString(beta)).toBeUndefined()
    const tokens = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadInputTokens: 1_000_000, cacheCreationInputTokens: 1_000_000 }
    expect(calculateCostFromTokens(alpha, tokens)).toBeCloseTo(4.7)
    expect(calculateCostFromTokens(beta, tokens)).toBe(0)
  } finally {
    if (previous === undefined) delete process.env.NEXUS_CONFIG_DIR
    else process.env.NEXUS_CONFIG_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  }
})

test('max effort is saved in production settings for models that offer it', () => {
  expect(SettingsSchema().parse({ effortLevel: 'max' }).effortLevel).toBe('max')
})
