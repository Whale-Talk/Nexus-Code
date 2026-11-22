import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getEditableModelCatalog } from './catalog.js'
import { applyChannelCredential, findCredentialOriginConflict, getCredentialTarget } from './channelCredentials.js'

const variable = 'NEXUS_TEMP_CHANNEL_TEST_KEY'
const relay = { protocol: 'openai-compatible', baseURL: 'https://relay.test/v1', apiKeyEnv: variable, models: [{ id: 'm' }] }
const config = {
  roles: { quark: 'primary::m', atom: 'primary::m', electron: 'primary::m' },
  channels: { primary: relay, alternate: { ...relay, baseURL: 'https://relay.test/second' } },
}

function temporaryProfile(run: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'nexus-credentials-'))
  const oldDirectory = process.env.NEXUS_CONFIG_DIR
  const oldValue = process.env[variable]
  process.env.NEXUS_CONFIG_DIR = directory
  delete process.env[variable]
  try {
    writeFileSync(join(directory, 'models.json'), JSON.stringify(config))
    run(directory)
  } finally {
    if (oldDirectory === undefined) delete process.env.NEXUS_CONFIG_DIR
    else process.env.NEXUS_CONFIG_DIR = oldDirectory
    if (oldValue === undefined) delete process.env[variable]
    else process.env[variable] = oldValue
    rmSync(directory, { recursive: true, force: true })
  }
}

test('reading credential targets is read-only and session-only updates never create files', () => {
  temporaryProfile(dir => {
    const target = getCredentialTarget(getEditableModelCatalog(), 'primary')
    expect(target.shared.map(item => item.id)).toEqual(['alternate', 'primary'])
    expect(target.multipleOrigins).toBe(false)
    expect(process.env[variable]).toBeUndefined()
    expect(existsSync(join(dir, 'settings.json'))).toBe(false)
    applyChannelCredential(target, 'test-session-secret', 'session')
    expect(process.env[variable]).toBe('test-session-secret')
    expect(existsSync(join(dir, 'settings.json'))).toBe(false)
    expect(readFileSync(join(dir, 'models.json'), 'utf8')).not.toContain('test-session-secret')
  })
})

test('saving a credential changes only its variable, preserves unknown fields and protects invalid files', () => {
  temporaryProfile(dir => {
    const filename = join(dir, 'settings.json')
    const initial = { custom: { x: 1 }, env: { OTHER: 'value' }, nested: [1, 'thing'] }
    writeFileSync(filename, JSON.stringify(initial))
    const target = getCredentialTarget(getEditableModelCatalog(), 'primary')
    applyChannelCredential(target, 'test-user-secret', 'user')
    expect(process.env[variable]).toBe('test-user-secret')
    expect(JSON.parse(readFileSync(filename, 'utf8'))).toEqual({
      ...initial, env: { OTHER: 'value', [variable]: 'test-user-secret' },
    })
    writeFileSync(filename, '{invalid:')
    expect(() => applyChannelCredential(target, 'unused-test-secret', 'user')).toThrow(/有效的 JSON/)
    expect(readFileSync(filename, 'utf8')).toBe('{invalid:')
    expect(process.env[variable]).toBe('test-user-secret')
  })
})

test('cross-host variable sharing, stale selection and project profile persistence are rejected', () => {
  temporaryProfile(dir => {
    const target = getCredentialTarget(getEditableModelCatalog(), 'primary')
    const changed = { ...config, channels: { ...config.channels, alternate: { ...relay, baseURL: 'https://other.test/v1' } } }
    writeFileSync(join(dir, 'models.json'), JSON.stringify(changed))
    expect(() => applyChannelCredential(target, 'unused', 'session')).toThrow(/已变更/)
    const latest = getEditableModelCatalog()
    expect(findCredentialOriginConflict(latest, variable, relay.baseURL)?.id).toBe('alternate')
    expect(() => applyChannelCredential(getCredentialTarget(latest, 'primary'), 'unused', 'session')).toThrow(/不同服务/)
    writeFileSync(join(dir, 'models.json'), JSON.stringify(config))
    mkdirSync(join(dir, '.git'))
    expect(() => applyChannelCredential(target, 'unused', 'user')).toThrow(/项目/)
    expect(process.env[variable]).toBeUndefined()
    expect(existsSync(join(dir, 'settings.json'))).toBe(false)
  })
})
