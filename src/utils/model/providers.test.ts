import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getAPIProvider,
  getAPIProviderForStatsig,
  isFirstPartyAnthropicBaseUrl,
} from './providers.js'

// All environment variables read by providers.ts (directly or transitively).
const ENV_KEYS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'NEXUS_BASE_URL',
  'USER_TYPE',
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
    expect(getAPIProvider()).toBe('firstParty')
  })

  test('returns bedrock when CLAUDE_CODE_USE_BEDROCK is truthy, firstParty when falsy', () => {
    for (const truthy of ['1', 'true', 'TRUE', ' yes ', 'on', 'On']) {
      setEnv('CLAUDE_CODE_USE_BEDROCK', truthy)
      expect(getAPIProvider()).toBe('bedrock')
    }
    for (const falsy of ['0', 'false', 'no', 'off', '2', '']) {
      setEnv('CLAUDE_CODE_USE_BEDROCK', falsy)
      expect(getAPIProvider()).toBe('firstParty')
    }
  })

  test('returns vertex when only CLAUDE_CODE_USE_VERTEX is truthy', () => {
    setEnv('CLAUDE_CODE_USE_VERTEX', 'true')
    expect(getAPIProvider()).toBe('vertex')
  })

  test('returns foundry when only CLAUDE_CODE_USE_FOUNDRY is truthy', () => {
    setEnv('CLAUDE_CODE_USE_FOUNDRY', '1')
    expect(getAPIProvider()).toBe('foundry')
  })

  test('applies precedence bedrock > vertex > foundry when multiple are set', () => {
    setEnv('CLAUDE_CODE_USE_BEDROCK', '1')
    setEnv('CLAUDE_CODE_USE_VERTEX', '1')
    setEnv('CLAUDE_CODE_USE_FOUNDRY', '1')
    expect(getAPIProvider()).toBe('bedrock')
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    expect(getAPIProvider()).toBe('vertex')
    delete process.env.CLAUDE_CODE_USE_VERTEX
    expect(getAPIProvider()).toBe('foundry')
  })
})

describe('getAPIProviderForStatsig', () => {
  test('mirrors getAPIProvider for the same environment', () => {
    // The declared return type is intentionally `never` (trap type in
    // providers.ts), but the runtime value is the provider string, so
    // compare through a test-local string bridge.
    const toProvider = (): string => getAPIProviderForStatsig() as unknown as string
    expect(toProvider()).toBe(getAPIProvider())
    expect(toProvider()).toBe('firstParty')
    setEnv('CLAUDE_CODE_USE_FOUNDRY', 'yes')
    expect(toProvider()).toBe(getAPIProvider())
    expect(toProvider()).toBe('foundry')
  })
})

describe('isFirstPartyAnthropicBaseUrl', () => {
  test('returns true when ANTHROPIC_BASE_URL is unset', () => {
    expect(isFirstPartyAnthropicBaseUrl()).toBe(true)
  })

  test('accepts api.anthropic.com regardless of scheme, port, or path', () => {
    for (const url of [
      'https://api.anthropic.com',
      'https://api.anthropic.com/v1',
      'http://api.anthropic.com',
      'https://api.anthropic.com:443',
    ]) {
      setEnv('NEXUS_BASE_URL', url)
      expect(isFirstPartyAnthropicBaseUrl()).toBe(true)
    }
  })

  test('allows api-staging.anthropic.com only for ant users', () => {
    setEnv('NEXUS_BASE_URL', 'https://api-staging.anthropic.com')
    setEnv('USER_TYPE', 'ant')
    expect(isFirstPartyAnthropicBaseUrl()).toBe(true)
    delete process.env.USER_TYPE
    expect(isFirstPartyAnthropicBaseUrl()).toBe(false)
    setEnv('USER_TYPE', 'employee')
    expect(isFirstPartyAnthropicBaseUrl()).toBe(false)
  })

  test('rejects third-party hosts and malformed URLs', () => {
    for (const url of [
      'https://example.com',
      'https://api.anthropic.com.evil.com',
      'not-a-url',
      'https://',
    ]) {
      setEnv('NEXUS_BASE_URL', url)
      expect(isFirstPartyAnthropicBaseUrl()).toBe(false)
    }
  })
})
