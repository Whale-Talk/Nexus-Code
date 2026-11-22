import { lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { getNexusConfigHomeDir } from '../envUtils.js'
import { findGitRoot } from '../git.js'
import { updateUserJsonAtomically } from './atomicUserJson.js'
import { markInternalWrite } from './internalWrites.js'
import { resetSettingsCache } from './settingsCache.js'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function userSettingsEnvPath(): string {
  return join(resolve(getNexusConfigHomeDir()), 'settings.json')
}

/** Only the user profile is eligible. A profile redirected into a project cannot receive secrets. */
export function saveUserSettingsEnv(values: Record<string, string>): void {
  const directory = resolve(getNexusConfigHomeDir())
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const realDirectory = realpathSync(directory)
  const fromProject = relative(realpathSync(getOriginalCwd()), realDirectory)
  const inProject = fromProject === '' || (!isAbsolute(fromProject) && fromProject !== '..' && !fromProject.startsWith(`..${sep}`))
  const personalDefault = relative(join(realpathSync(homedir()), '.nexus'), realDirectory) === ''
  const filename = userSettingsEnvPath()
  if ((!personalDefault && inProject) || findGitRoot(realDirectory) ||
      lstatSync(filename, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error('此设置位置位于项目中或通过文件链接重定向。请使用独立的用户配置目录，或仅用于本次运行。')
  }
  updateUserJsonAtomically(filename, () => {
    let current: unknown = {}
    try {
      const text = readFileSync(filename, 'utf8')
      try { current = JSON.parse(text.replace(/^\uFEFF/, '')) } catch {
        throw new Error('用户 settings.json 不是有效的 JSON，已保留原文件')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (!record(current) || (current.env !== undefined && !record(current.env))) {
      throw new Error('用户 settings.json 的 env 配置无效，已保留原文件')
    }
    const env = record(current.env) ? { ...current.env } : {}
    if (process.platform === 'win32') {
      // Windows treats API_KEY and api_key as the same process variable.
      const insensitive = new Set(Object.keys(values).map(key => key.toUpperCase()))
      for (const key of Object.keys(env)) if (insensitive.has(key.toUpperCase())) delete env[key]
    }
    return { ...current, env: { ...env, ...values } }
  })
  markInternalWrite(filename)
  resetSettingsCache()
}
