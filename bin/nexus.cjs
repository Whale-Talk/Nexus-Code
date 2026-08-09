#!/usr/bin/env node
// Nexus launcher — Node.js entry point that manages config isolation and spawns bun.
//   Settings use NEXUS_* keys. The launcher bridges: NEXUS_* env vars for our code,
//   ANTHROPIC_* for SDK internals (@ai-sdk/anthropic, claude-agent-sdk).
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs')
const { homedir } = require('os')
const { delimiter, dirname, join, resolve } = require('path')
const { spawn } = require('child_process')
const { randomUUID } = require('crypto')

const projectDir = resolve(dirname(__dirname))
const originalCwd = process.cwd() // user's launch directory
const configDir = join(homedir(), '.nexus')
const settingsPath = join(configDir, 'settings.json')

// --- Default settings (NEXUS_* keys) ---
const defaultSettings = {
  $schema: 'https://json.schemastore.org/claude-code-settings.json',
  env: {
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK: '1',
    MCP_TIMEOUT: '60000',
    API_TIMEOUT_MS: '3000000',
    NEXUS_BASE_URL: 'https://api.deepseek.com/anthropic',
    NEXUS_MODEL: 'deepseek-v4-pro[1m]',
    NEXUS_QUARK_MODEL: 'deepseek-v4-pro[1m]',
    NEXUS_ATOM_MODEL: 'deepseek-v4-pro[1m]',
    NEXUS_ELECTRON_MODEL: 'deepseek-v4-flash[1m]',
    CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-v4-flash[1m]',
  },
  model: 'deepseek-v4-pro[1m]',
  deepseek: { effort: 'max' },
  // Nexus: accept bypass-permissions warning once so it never shows again.
  skipDangerousModePermissionPrompt: true,
}

// Backward compat: also accept old ANTHROPIC_* keys
function resolveEnvKey(settings, newKey, oldKey) {
  let env = settings?.env || {}
  return env[newKey] || env[oldKey]
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
        NEXUS_BASE_URL:
          current.env?.NEXUS_BASE_URL || current.env?.ANTHROPIC_BASE_URL || defaultSettings.env.NEXUS_BASE_URL,
      },
      model: current.model ?? defaultSettings.model,
    }
    writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n', { mode: 0o600 })
  } catch {
    // Keep user settings intact on parse error
  }
}

// --- Auth: resolve API key (NEXUS_API_KEY, with backward compat) ---
function resolveApiKey() {
  try {
    const s = JSON.parse(readFileSync(settingsPath, 'utf8'))
    const key = s?.env?.NEXUS_API_KEY || s?.env?.ANTHROPIC_API_KEY
    if (typeof key === 'string' && key.trim()) return key.trim()
  } catch {}
  return undefined
}

// --- Spawn env setup ---
process.env.CLAUDE_CONFIG_DIR = configDir
process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1'

const settings = readJson(settingsPath, {})

// Bridge: set NEXUS_* for our code
process.env.NEXUS_BASE_URL =
  resolveEnvKey(settings, 'NEXUS_BASE_URL', 'ANTHROPIC_BASE_URL') || defaultSettings.env.NEXUS_BASE_URL
process.env.NEXUS_MODEL =
  resolveEnvKey(settings, 'NEXUS_MODEL', 'ANTHROPIC_MODEL') || settings?.model || defaultSettings.model
process.env.NEXUS_QUARK_MODEL =
  resolveEnvKey(settings, 'NEXUS_QUARK_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL') || 'deepseek-v4-pro[1m]'
process.env.NEXUS_ATOM_MODEL =
  resolveEnvKey(settings, 'NEXUS_ATOM_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL') || 'deepseek-v4-pro[1m]'
process.env.NEXUS_ELECTRON_MODEL =
  resolveEnvKey(settings, 'NEXUS_ELECTRON_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL') || 'deepseek-v4-flash[1m]'

// Bridge: also set ANTHROPIC_* for SDK internals (@ai-sdk/anthropic, claude-agent-sdk)
process.env.ANTHROPIC_BASE_URL = process.env.NEXUS_BASE_URL
process.env.ANTHROPIC_MODEL = process.env.NEXUS_MODEL
process.env.ANTHROPIC_DEFAULT_OPUS_MODEL = process.env.NEXUS_QUARK_MODEL
process.env.ANTHROPIC_DEFAULT_SONNET_MODEL = process.env.NEXUS_ATOM_MODEL
process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = process.env.NEXUS_ELECTRON_MODEL
process.env.CLAUDE_CODE_SUBAGENT_MODEL =
  settings?.env?.CLAUDE_CODE_SUBAGENT_MODEL || 'deepseek-v4-flash[1m]'

// Auth: wipe inherited tokens, set NEXUS_API_KEY + bridge to ANTHROPIC_API_KEY
process.env.ANTHROPIC_AUTH_TOKEN = ''
process.env.CLAUDE_CODE_OAUTH_TOKEN = ''
delete process.env.ANTHROPIC_AUTH_TOKEN
delete process.env.CLAUDE_CODE_OAUTH_TOKEN

const configuredKey = resolveApiKey()
if (configuredKey) {
  process.env.NEXUS_API_KEY = configuredKey
  process.env.ANTHROPIC_API_KEY = configuredKey   // bridge for SDK internals
}

// Effort
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
