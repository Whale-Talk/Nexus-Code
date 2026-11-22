import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getContextWindowForModel, getModelMaxOutputTokens } from './context.js'
import { modelSupportsEffort, modelSupportsMaxEffort } from './effort.js'
import { isFastModeSupportedByModel } from './fastMode.js'
import { calculateCostFromTokens, getModelPricingString } from './modelCost.js'
import { modelSupportsAdaptiveThinking, modelSupportsThinking } from './thinking.js'
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
