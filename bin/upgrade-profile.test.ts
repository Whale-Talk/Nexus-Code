import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { upgradeProfile } from '../scripts/upgrade-profile.cjs'

test('upgrade an existing Nexus profile without changing a physical model, role binding or session', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexus-profile-upgrade-'))
  const read = (name: string) => readFileSync(join(directory, name), 'utf8')
  const write = (name: string, data: unknown) => writeFileSync(join(directory, name), JSON.stringify(data))
  try {
    const host = 'https://models.example/anthropic'
    const roles = { quark: 'work::Model-X', atom: 'work::sonnet', electron: 'work::Model-X' }
    write('models.json', { roles, channels: { work: { protocol: 'anthropic', baseURL: host,
      apiKeyEnv: 'TEAM_KEY', models: [{ id: 'Model-X' }, { id: 'sonnet' }] } } })
    write('settings.json', { env: { NEXUS_PROVIDER: 'anthropic', NEXUS_BASE_URL: host,
      CLAUDE_CODE_EFFORT_LEVEL: 'medium', NEXUS_EFFORT_LEVEL: 'high', TEAM_KEY: 'test-key' }, model: 'Model-X' })
    write('.claude.json', { hasCompletedOnboarding: true, projects: { demo: { hasTrustDialogAccepted: true } } })
    mkdirSync(join(directory, 'projects'))
    write('projects/conversation.jsonl', { role: 'assistant', model: 'sonnet', text: '原始会话' })
    const transcript = read('projects/conversation.jsonl')
    upgradeProfile(directory)
    expect(JSON.parse(read('models.json')).roles).toEqual(roles)
    expect(JSON.parse(read('models.json')).channels.work).toEqual({ protocol: 'messages', baseURL: host,
      apiKeyEnv: 'TEAM_KEY', models: [{ id: 'Model-X' }, { id: 'sonnet' }] })
    expect(JSON.parse(read('settings.json')).env).toEqual({ NEXUS_PROVIDER: 'messages', NEXUS_BASE_URL: host,
      NEXUS_EFFORT_LEVEL: 'high', TEAM_KEY: 'test-key' })
    expect(JSON.parse(read('profile.json'))).toEqual(JSON.parse(read('.claude.json')))
    const settings = read('settings.json')
    upgradeProfile(directory)
    expect(read('settings.json')).toBe(settings)
    expect(read('projects/conversation.jsonl')).toBe(transcript)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('an old credential is never transferred to a different provider during upgrade', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexus-profile-key-scope-'))
  const file = join(directory, 'settings.json')
  const previous = JSON.stringify({ env: { ANTHROPIC_API_KEY: 'test-only',
    ANTHROPIC_BASE_URL: 'https://old.example', NEXUS_BASE_URL: 'https://new.example' } })
  try {
    writeFileSync(file, previous)
    expect(() => upgradeProfile(directory)).toThrow(/NEXUS_API_KEY/)
    expect(readFileSync(file, 'utf8')).toBe(previous)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
