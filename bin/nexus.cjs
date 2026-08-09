#!/usr/bin/env node
// Nexus launcher — Node.js entry point that manages config isolation and spawns bun.
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs')
const { homedir } = require('os')
const { delimiter, dirname, join, resolve } = require('path')
const { spawn } = require('child_process')
const { randomUUID } = require('crypto')

const projectDir = resolve(dirname(__dirname))
const originalCwd = process.cwd() // user's launch directory
const configDir = join(homedir(), '.nexus')
const settingsPath = join(configDir, 'settings.json')

// --- Default settings ---
const defaultSettings = {
  $schema: 'https://json.schemastore.org/claude-code-settings.json',
  env: {
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK: '1',
    MCP_TIMEOUT: '60000',
    API_TIMEOUT_MS: '3000000',
    ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
    ANTHROPIC_MODEL: 'deepseek-v4-pro[1m]',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-pro[1m]',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-pro[1m]',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash[1m]',
    CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-v4-flash[1m]',
  },
  model: 'deepseek-v4-pro[1m]',
  deepseek: { effort: 'max' },
  // Nexus: accept bypass-permissions warning once so it never shows again.
  skipDangerousModePermissionPrompt: true,
}

function readJson(p, fallback) {
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return fallback }
}

// --- Initialize config directory ---
mkdirSync(configDir, { recursive: true })

if (!existsSync(settingsPath)) {
  writeFileSync(settingsPath, JSON.stringify(defaultSettings, null, 2) + '\n', { mode: 0o600 })
} else {
  try {
    const current = JSON.parse(readFileSync(settingsPath, 'utf8'))
    const merged = {
      ...current,
      env: {
        ...defaultSettings.env,
        ...(current.env || {}),
        // Preserve user's base URL; fall back to default only if unset
        ANTHROPIC_BASE_URL:
          current.env?.ANTHROPIC_BASE_URL || defaultSettings.env.ANTHROPIC_BASE_URL,
      },
      model: current.model ?? defaultSettings.model,
    }
    writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n', { mode: 0o600 })
  } catch {
    // Keep user settings intact on parse error
  }
}

// --- Auth: resolve API key from env → settings.env ---
function resolveApiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  try {
    const s = JSON.parse(readFileSync(settingsPath, 'utf8'))
    const key = s?.env?.ANTHROPIC_API_KEY
    if (typeof key === 'string' && key.trim()) return key.trim()
  } catch {}
  return undefined
}

// --- Auth: resolve AUTH_TOKEN from settings ---
function resolveAuthToken() {
  try {
    const s = JSON.parse(readFileSync(settingsPath, 'utf8'))
    const t = s?.env?.ANTHROPIC_AUTH_TOKEN
    if (typeof t === 'string' && t.trim()) return t.trim()
  } catch {}
  return undefined
}

// --- Spawn env setup ---
process.env.CLAUDE_CONFIG_DIR = configDir
process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1'

// Base URL: user's settings.env, else default
const settings = readJson(settingsPath, {})
process.env.ANTHROPIC_BASE_URL =
  settings?.env?.ANTHROPIC_BASE_URL || defaultSettings.env.ANTHROPIC_BASE_URL

// Auth: wipe inherited tokens first to prevent auth conflict warnings.
// (Node's delete process.env may fail on inherited vars — set to empty instead.)
process.env.ANTHROPIC_AUTH_TOKEN = ''
process.env.CLAUDE_CODE_OAUTH_TOKEN = ''

// Auth: prefer settings.env values (user-configured tokens)
const configuredKey = resolveApiKey()
if (configuredKey) process.env.ANTHROPIC_API_KEY = configuredKey

const configuredToken = resolveAuthToken()
if (configuredToken) {
  process.env.ANTHROPIC_AUTH_TOKEN = configuredToken
}
delete process.env.ANTHROPIC_AUTH_TOKEN
delete process.env.CLAUDE_CODE_OAUTH_TOKEN

// Model env: preserve [1m] for relay channels
process.env.ANTHROPIC_MODEL =
  settings?.env?.ANTHROPIC_MODEL || settings?.model || defaultSettings.model
process.env.ANTHROPIC_DEFAULT_OPUS_MODEL =
  settings?.env?.ANTHROPIC_DEFAULT_OPUS_MODEL || 'deepseek-v4-pro[1m]'
process.env.ANTHROPIC_DEFAULT_SONNET_MODEL =
  settings?.env?.ANTHROPIC_DEFAULT_SONNET_MODEL || 'deepseek-v4-pro[1m]'
process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL =
  settings?.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL || 'deepseek-v4-flash[1m]'
process.env.CLAUDE_CODE_SUBAGENT_MODEL =
  settings?.env?.CLAUDE_CODE_SUBAGENT_MODEL || 'deepseek-v4-flash[1m]'

// Effort: map deepseek.effort → CLAUDE_CODE_EFFORT_LEVEL (max/medium/low)
const effortMap = { max: 'max', high: 'high', medium: 'medium', low: 'low', auto: 'medium' }
const deepseekEffort = readJson(settingsPath, {})?.deepseek?.effort || 'medium'
process.env.CLAUDE_CODE_EFFORT_LEVEL = effortMap[deepseekEffort] || 'medium'

// General env defaults
process.env.DISABLE_TELEMETRY ||= '1'
process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC ||= '1'
process.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK ||= '1'

// Conversation tracking header
process.env.CLAUDE_CONVERSATION_ID ||= randomUUID()

// Nexus: always show the full welcome logo (custom ASCII art)
process.env.CLAUDE_CODE_FORCE_FULL_LOGO = '1'

// --- Launch ---
const bun = process.env.BUN_BINARY || 'bun'
// Nexus default: skip permission prompts. Override with
// --permission-mode default on the command line to restore prompts.
const userArgs = process.argv.slice(2)
const hasPermissionFlag = userArgs.some(a =>
  a.startsWith('--permission-mode') || a === '--dangerously-skip-permissions'
)
const args = [
  'run',
  join(projectDir, 'src/dev-entry.ts'),
  ...(hasPermissionFlag ? [] : ['--permission-mode', 'bypassPermissions']),
  ...userArgs,
]
const child = spawn(bun, args, {
  // Run in the user's launch directory, not projectDir — session history
  // and project context must follow where the user started Nexus.
  cwd: originalCwd,
  env: process.env,
  stdio: 'inherit',
})

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    try { child.kill(signal) } catch {}
    setTimeout(() => process.exit(128), 1000).unref()
  })
}

child.on('error', (err) => {
  console.error(`Failed to start Nexus: ${err.message}`)
  process.exit(1)
})

child.on('exit', (code, sig) => {
  if (sig) {
    process.exitCode = 128
    process.kill(process.pid, sig)
  }
  process.exit(code ?? 1)
})
