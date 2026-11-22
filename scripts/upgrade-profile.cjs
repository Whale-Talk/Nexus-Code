// Offline migration of files previously written by Nexus. Old role names are never interpreted.
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const lockfile = require('proper-lockfile')

function readJson(file) {
  try {
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    return JSON.parse(text)
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return undefined
    throw error
  }
}

function upgradedSettings(settings, credentialNames) {
  if (!settings?.env && !settings?.$schema) return settings
  const next = { ...settings }
  if (typeof next.$schema === 'string' && next.$schema.includes('/claude-code-settings.json')) delete next.$schema
  if (!settings.env || typeof settings.env !== 'object' || Array.isArray(settings.env)) return next
  const env = { ...settings.env }
  const oldConnection = {
    ANTHROPIC_API_KEY: 'NEXUS_API_KEY',
    ANTHROPIC_BASE_URL: 'NEXUS_BASE_URL',
    ANTHROPIC_MODEL: 'NEXUS_MODEL',
    NEXUS_SMALL_FAST_MODEL: 'NEXUS_ELECTRON_MODEL',
  }
  for (const [key, value] of Object.entries(settings.env)) {
    const replacement = Object.hasOwn(oldConnection, key) ? oldConnection[key]
      : key.startsWith('CLAUDE_CODE_') ? 'NEXUS_' + key.slice('CLAUDE_CODE_'.length) : undefined
    if (!replacement || credentialNames.has(key.toUpperCase())) continue
    if (key === 'ANTHROPIC_API_KEY' && !env.NEXUS_API_KEY && settings.env.ANTHROPIC_BASE_URL && settings.env.NEXUS_BASE_URL) {
      let sameOrigin = false
      try {
        sameOrigin = new URL(settings.env.ANTHROPIC_BASE_URL).origin === new URL(settings.env.NEXUS_BASE_URL).origin
      } catch { /* A missing or malformed origin cannot authorize a key transfer. */ }
      if (!sameOrigin) {
        throw new Error('旧连接地址与当前 Nexus 渠道不同。请为当前地址明确设置 NEXUS_API_KEY。')
      }
    }
    if (!Object.hasOwn(env, replacement)) env[replacement] = value
    delete env[key]
  }
  if (env.NEXUS_PROVIDER === 'anthropic') env.NEXUS_PROVIDER = 'messages'
  return { ...next, env }
}

function plannedWrites(directory) {
  const writes = []
  const settingsFile = path.join(directory, 'settings.json')
  const catalogFile = path.join(directory, 'models.json')
  const catalog = readJson(catalogFile)
  const credentialNames = new Set()
  if (catalog?.channels && typeof catalog.channels === 'object' && !Array.isArray(catalog.channels)) {
    let upgraded = false
    for (const channel of Object.values(catalog.channels)) {
      if (typeof channel?.apiKeyEnv === 'string') credentialNames.add(channel.apiKeyEnv.toUpperCase())
      if (channel?.protocol === 'anthropic') { channel.protocol = 'messages'; upgraded = true }
    }
    if (upgraded) writes.push([catalogFile, catalog])
  }
  const settings = readJson(settingsFile)
  const next = upgradedSettings(settings, credentialNames)
  if (JSON.stringify(next) !== JSON.stringify(settings)) writes.push([settingsFile, next])
  const profile = path.join(directory, 'profile.json')
  if (!fs.existsSync(profile)) {
    const previous = readJson(path.join(directory, '.config.json')) ?? readJson(path.join(directory, '.claude.json'))
    if (previous && typeof previous === 'object' && !Array.isArray(previous)) writes.push([profile, previous])
  }
  return writes
}

function upgradeProfile(directory) {
  if (!fs.existsSync(directory) || path.basename(directory).toLowerCase() === '.claude') return
  const migrated = path.join(directory, '.native-profile-v1')
  if (fs.existsSync(migrated)) return
  if (!plannedWrites(directory).length) return
  let release
  const deadline = Date.now() + 5000
  for (;;) {
    try {
      release = lockfile.lockSync(directory, { lockfilePath: path.join(directory, '.profile-upgrade.lock') })
      break
    } catch (error) {
      if (error.code !== 'ELOCKED' || Date.now() >= deadline) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
    }
  }
  try {
    if (fs.existsSync(migrated)) return
    for (const [file] of plannedWrites(directory)) {
      if (fs.lstatSync(file, { throwIfNoEntry: false })?.isSymbolicLink()) {
        throw new Error(`请先手动升级符号链接指向的配置：${file}`)
      }
      // The catalog and credential editors lock the target file when saving.
      const unlockFile = lockfile.lockSync(file, { realpath: false, retries: 0 })
      const temp = path.join(directory, '.upgrade-' + randomUUID())
      try {
        const pending = plannedWrites(directory).find(([name]) => name === file)
        if (!pending) continue
        const value = pending[1]
        fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600, flush: true })
        fs.renameSync(temp, file)
      } finally {
        fs.rmSync(temp, { force: true })
        unlockFile()
      }
    }
    fs.writeFileSync(migrated, '1\n', { mode: 0o600 })
  } finally {
    release()
  }
}

module.exports = { upgradeProfile }
