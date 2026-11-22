import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getAuthHeaders } from '../http.js'
import {
  getAPIProvider,
  getAPIProviderForTelemetry,
  hasHostedAccountService,
} from './providers.js'

// All environment variables read by providers.ts (directly or transitively).
const ENV_KEYS = [
  'NEXUS_USE_BEDROCK',
  'NEXUS_USE_VERTEX',
  'NEXUS_USE_FOUNDRY',
  'NEXUS_BASE_URL',
  'NEXUS_BUILD_FLAVOR',
] as const

// Snapshot ambient values once, restore them in afterEach to avoid leaking
// into other test files running in the same process.
const originalValues: Record<string, string | undefined> = {}
for (const key of ENV_KEYS) {
  originalValues[key] = process.env[key]
}

function setEnv(key: string, value: string): void {
  process.env[key] = value
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = originalValues[key]
    if (original === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = original
    }
  }
})

describe('getAPIProvider', () => {
  test('defaults to firstParty when no provider env vars are set', () => {
    expect(getAPIProvider()).toBe('channel')
  })

  test('returns bedrock when NEXUS_USE_BEDROCK is truthy, firstParty when falsy', () => {
    for (const truthy of ['1', 'true', 'TRUE', ' yes ', 'on', 'On']) {
      setEnv('NEXUS_USE_BEDROCK', truthy)
      expect(getAPIProvider()).toBe('bedrock')
    }
    for (const falsy of ['0', 'false', 'no', 'off', '2', '']) {
      setEnv('NEXUS_USE_BEDROCK', falsy)
      expect(getAPIProvider()).toBe('channel')
    }
  })

  test('returns vertex when only NEXUS_USE_VERTEX is truthy', () => {
    setEnv('NEXUS_USE_VERTEX', 'true')
    expect(getAPIProvider()).toBe('vertex')
  })

  test('returns foundry when only NEXUS_USE_FOUNDRY is truthy', () => {
    setEnv('NEXUS_USE_FOUNDRY', '1')
    expect(getAPIProvider()).toBe('foundry')
  })

  test('applies precedence bedrock > vertex > foundry when multiple are set', () => {
    setEnv('NEXUS_USE_BEDROCK', '1')
    setEnv('NEXUS_USE_VERTEX', '1')
    setEnv('NEXUS_USE_FOUNDRY', '1')
    expect(getAPIProvider()).toBe('bedrock')
    delete process.env.NEXUS_USE_BEDROCK
    expect(getAPIProvider()).toBe('vertex')
    delete process.env.NEXUS_USE_VERTEX
    expect(getAPIProvider()).toBe('foundry')
  })
})

describe('getAPIProviderForTelemetry', () => {
  test('mirrors getAPIProvider for the same environment', () => {
    // The declared return type is intentionally `never` (trap type in
    // providers.ts), but the runtime value is the provider string, so
    // compare through a test-local string bridge.
    const toProvider = (): string => getAPIProviderForTelemetry() as unknown as string
    expect(toProvider()).toBe(getAPIProvider())
    expect(toProvider()).toBe('channel')
    setEnv('NEXUS_USE_FOUNDRY', 'yes')
    expect(toProvider()).toBe(getAPIProvider())
    expect(toProvider()).toBe('foundry')
  })
})

test('model credentials never enable hosted account services', () => {
  expect(hasHostedAccountService()).toBe(false)
  expect(getAuthHeaders().headers).toEqual({})
})
