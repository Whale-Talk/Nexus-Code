#!/usr/bin/env node
// Nexus launcher — manages config isolation and spawns the main Nexus Code process.
//   Settings use NEXUS_* keys. The launcher bridges: NEXUS_* env vars for our code,
//   ANTHROPIC_* for SDK internals (@ai-sdk/anthropic, claude-agent-sdk).
//
//   Runs on Node.js (npm-installed bin always has node); the actual runtime is
//   bun >= 1.3.5 — if bun is missing we print install guidance below instead of
//   dying with an opaque OS error.
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs')
const { homedir } = require('os')
const { delimiter, dirname, isAbsolute, join, resolve } = require('path')
const { spawn } = require('child_process')
const { randomUUID } = require('crypto')

// --- Pre-flight: locate a spawnable bun binary ---
// Windows (npm-installed bun) notes:
//   - real binary is node_modules/bun/bin/bun.exe (NOT on PATH)
//   - npm dir contains an extensionless shell shim named `bun` — existsSync
//     finds it but spawn cannot execute it
//   - so on win32 executable extensions come FIRST (.exe > .cmd) and the bare
//     name LAST — otherwise the shim shadows the real binary whenever
//     %APPDATA%\npm precedes node_modules\bun\bin on PATH (the default).
function bunCandidateNames(base) {
  if (process.platform === 'win32') {
    return [`${base}.exe`, `${base}.cmd`, base]
  }
  return [base]
}

function bunSearchDirs() {
  const dirs = (process.env.PATH || '').split(delimiter).filter(Boolean)
  const home = homedir()
  // Common install locations outside PATH (npm-installed bun on Windows,
  // bun.sh installer on POSIX)
  dirs.push(
    join(home, '.bun', 'bin'),
    join(home, 'AppData', 'Roaming', 'npm', 'node_modules', 'bun', 'bin'),
    join(home, 'AppData', 'Roaming', 'npm'),
  )
  return dirs
}

/**
 * Resolve the bun executable to an absolute path spawnable via child_process.
 * BUN_BINARY semantics: absolute path → used as-is; bare name → resolved via
 * PATH + common install dirs with platform-appropriate extensions.
 *
 * Loop order is candidates-outer × dirs-inner: a bun.exe in ANY directory
 * beats a bun.cmd in an EARLIER PATH directory. (v1.0.7's dirs-outer order
 * let %APPDATA%\npm\bun.cmd shadow node_modules\bun\bin\bun.exe → spawn EINVAL.)
 * Returns null when no executable is found.
 */
function resolveBunBinary() {
  const configured = process.env.BUN_BINARY || 'bun'
  if (isAbsolute(configured)) {
    try { return existsSync(configured) ? configured : null } catch { return null }
  }
  const dirs = bunSearchDirs()
  for (const base of bunCandidateNames(configured)) {
    for (const dir of dirs) {
      const candidate = join(dir, base)
      try {
        if (existsSync(candidate)) return candidate
      } catch {}
    }
  }
  return null
}

const bunBinaryPath = resolveBunBinary()

if (bunBinaryPath === null) {
  const win32 = process.platform === 'win32'
  console.error([
    '',
    '\x1b[1;31m❌ bun is not installed or not in PATH.\x1b[0m',
    '',
    'Nexus Code requires bun >= 1.3.5 as its runtime.',
    '',
    'Install bun:',
    win32
      ? '  \x1b[1mnpm install -g bun\x1b[0m   (Windows)\n  \x1b[1mpowershell -c "irm bun.sh/install.ps1 | iex"\x1b[0m'
      : '  \x1b[1mcurl -fsSL https://bun.sh/install | bash\x1b[0m',
    '',
    win32
      ? [
          'If bun is installed but not found, add these to your PATH (Settings → System → Environment Variables):',
          `  \x1b[1m%USERPROFILE%\\.bun\\bin\x1b[0m`,
          `  \x1b[1m%APPDATA%\\npm\\node_modules\\bun\\bin\x1b[0m`,
          '',
          'Then restart your terminal and try again.',
        ].join('\n')
      : [
          'After installation, restart your terminal or run:',
          '  \x1b[1msource ~/.bashrc\x1b[0m  (bash)',
          '  \x1b[1msource ~/.zshrc\x1b[0m   (zsh)',
        ].join('\n'),
    '',
    'Then try: \x1b[1mnexus\x1b[0m',
    '',
  ].join('\n'))
  process.exit(1)
}

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
    // 注意: 不写 NEXUS_SUBAGENT_MODEL 默认值到 settings.json —
    // launcher 缺省时跟随 NEXUS_MODEL，保证非 DeepSeek 厂商子代理可用。
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
      // 写入 deepseek.effort 默认值，与回退逻辑一致，避免升级前后 effort 静默变化
      deepseek: {
        ...defaultSettings.deepseek,
        ...(current.deepseek || {}),
      },
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
// 通用透传: 用户配置的 NEXUS_PROVIDER + 三角色模型 ID（任意厂商均可）。
// 兼容只配一个模型: 角色缺省时跟随 NEXUS_MODEL; 都不配才用 DeepSeek 默认。
process.env.NEXUS_PROVIDER = settings?.env?.NEXUS_PROVIDER || 'anthropic'
process.env.NEXUS_MODEL = process.env.NEXUS_MODEL || defaultSettings.model
// 三角色: 只读 NEXUS_*_MODEL (不再回退 ANTHROPIC_DEFAULT_* — 旧键会绕过 NEXUS_MODEL 兜底)
process.env.NEXUS_QUARK_MODEL =
  settings?.env?.NEXUS_QUARK_MODEL || process.env.NEXUS_MODEL
process.env.NEXUS_ATOM_MODEL =
  settings?.env?.NEXUS_ATOM_MODEL || process.env.NEXUS_MODEL
process.env.NEXUS_ELECTRON_MODEL =
  settings?.env?.NEXUS_ELECTRON_MODEL || process.env.NEXUS_MODEL

// 子代理模型: NEXUS_SUBAGENT_MODEL (新) + CLAUDE_CODE_SUBAGENT_MODEL (旧键兼容)。
// 缺省时跟随 NEXUS_MODEL（与三角色一致），保证非 DeepSeek 厂商（如 GLM）子代理可用。
process.env.NEXUS_SUBAGENT_MODEL =
  settings?.env?.NEXUS_SUBAGENT_MODEL ||
  settings?.env?.CLAUDE_CODE_SUBAGENT_MODEL ||
  process.env.NEXUS_MODEL
process.env.CLAUDE_CODE_SUBAGENT_MODEL = process.env.NEXUS_SUBAGENT_MODEL

// Auth: wipe inherited tokens (conflict warnings), set NEXUS_API_KEY.
// @ai-sdk/anthropic takes apiKey explicitly (adapter passes NEXUS_API_KEY),
// so no ANTHROPIC_* bridge is needed for our request path. Cloud backends
// (Bedrock/Foundry/Vertex) in client.ts keep their own SDK env vars.
process.env.ANTHROPIC_AUTH_TOKEN = ''
process.env.CLAUDE_CODE_OAUTH_TOKEN = ''
delete process.env.ANTHROPIC_AUTH_TOKEN
delete process.env.CLAUDE_CODE_OAUTH_TOKEN

const configuredKey = resolveApiKey()
if (configuredKey) {
  process.env.NEXUS_API_KEY = configuredKey
}

// Effort
const effortMap = { max: 'max', high: 'high', medium: 'medium', low: 'low', auto: 'medium' }
// 回退与 defaultSettings.deepseek.effort 一致，避免同一机器升级前后 effort 静默变化
const deepseekEffort = readJson(settingsPath, {})?.deepseek?.effort || defaultSettings.deepseek.effort
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
// spawn the resolved absolute path — never a bare name, so Windows
// npm-shim (extensionless shell script) can't be picked up by mistake
// and .exe/.cmd resolution doesn't depend on PATH ordering.
const bun = bunBinaryPath
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
  // .cmd shim 兜底: Windows 上 CreateProcess 无法直接执行 .cmd，
  // 需要经 cmd.exe 包装（Node 的 shell 模式会自动转义参数）。
  // 循环反转后 .cmd 只在完全没有 bun.exe 时才命中，属最后手段。
  shell: process.platform === 'win32' && /\.cmd$/i.test(bun),
})

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    try { child.kill(signal) } catch {}
    setTimeout(() => process.exit(128), 1000).unref()
  })
}

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    const win32 = process.platform === 'win32'
    // 区分两种情况：解析到的路径是裸名（无扩展名 shim，spawn 无法执行）
    // 还是 bun 真的不存在。裸名命中通常意味着 PATH 里只有 npm shim，
    // 需要把 bun.exe 所在目录加入 PATH 或设置 BUN_BINARY。
    const isBareName =
      win32 && !/\.(exe|cmd)$/i.test(bunBinaryPath || '')
    console.error([
      '',
      '\x1b[1;31m❌ Failed to launch bun runtime.\x1b[0m',
      '',
      `Reason: ${err.message}`,
      isBareName
        ? `Located '${bunBinaryPath}', but Windows cannot execute extensionless shims.`
        : 'bun was not found or was removed after Nexus was installed.',
      '',
      isBareName
        ? [
            'Fix options:',
            '  1. Add the real binary dir to PATH:',
            '     \x1b[1m%APPDATA%\\npm\\node_modules\\bun\\bin\x1b[0m',
            '  2. Or set BUN_BINARY to the absolute path:',
            '     \x1b[1msetx BUN_BINARY "%APPDATA%\\npm\\node_modules\\bun\\bin\\bun.exe"\x1b[0m',
          ].join('\n')
        : win32
          ? 'Reinstall bun: \x1b[1mnpm install -g bun\x1b[0m  (Windows)'
          : 'Reinstall bun: \x1b[1mcurl -fsSL https://bun.sh/install | bash\x1b[0m',
      '',
    ].join('\n'))
  } else {
    console.error(`Failed to start Nexus: ${err.message}`)
  }
  process.exit(1)
})

child.on('exit', (code, sig) => {
  if (sig) {
    process.exitCode = 128
    process.kill(process.pid, sig)
  }
  process.exit(code ?? 1)
})
