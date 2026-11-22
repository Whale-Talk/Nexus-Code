import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const launcher = join(import.meta.dir, 'nexus.cjs')
const captureLaunch = `
  const { EventEmitter } = require('node:events')
  require('node:os').homedir = () => process.env.NEXUS_TEST_PROFILE
  require('node:child_process').spawn = (_runtime, args) => {
    console.log(JSON.stringify(args.slice(2)))
    return new EventEmitter()
  }
  require(process.argv[1])
`

function launchWithFreshSettings(args: string[], existing?: object) {
  const profile = mkdtempSync(join(tmpdir(), 'nexus-launcher-test-'))
  try {
    if (existing) {
      mkdirSync(join(profile, '.nexus'))
      writeFileSync(join(profile, '.nexus', 'settings.json'), JSON.stringify(existing))
    }
    const result = Bun.spawnSync(['node', '-e', captureLaunch, '--', launcher, ...args], {
      env: { ...process.env, NEXUS_CONFIG_DIR: join(profile, '.nexus'), BUN_BINARY: process.execPath, NEXUS_TEST_PROFILE: profile },
    })
    if (result.exitCode !== 0) throw new Error(result.stderr.toString())
    return {
      args: JSON.parse(result.stdout.toString()),
      settings: JSON.parse(readFileSync(join(profile, '.nexus', 'settings.json'), 'utf8')),
    }
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
}

test('a fresh launch does not select bypass mode or pre-accept its warning', () => {
  const result = launchWithFreshSettings([])
  expect(result.args).toEqual([])
  expect(result.settings.permissions?.defaultMode).toBeUndefined()
  expect(result.settings.skipDangerousModePermissionPrompt).toBeUndefined()
})

test('upgrading a single-channel profile preserves its configured provider model', () => {
  const saved = { model: 'local-coder', env: { NEXUS_PROVIDER: 'openai-compatible', NEXUS_BASE_URL: 'http://localhost:11434/v1' } }
  const { settings } = launchWithFreshSettings([], saved)
  expect(settings.env.NEXUS_MODEL).toBe('local-coder')
  expect(settings.model).toBe(saved.model)
})

test.each([
  ['--permission-mode', 'bypassPermissions'],
  ['--permission-mode=plan'],
  ['--dangerously-skip-permissions'],
])('the launcher forwards explicit permission arguments (%s)', (...args) => {
  expect(launchWithFreshSettings(args).args).toEqual(args)
})
