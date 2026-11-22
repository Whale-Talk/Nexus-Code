import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { lockSync } from '../lockfile.js'

/** Reread and merge under one writer lock. Never fall back to truncating the original file. */
export function updateUserJsonAtomically<T>(filename: string, build: () => T): T {
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 })
  const target = lstatSync(filename, { throwIfNoEntry: false })?.isSymbolicLink()
    ? realpathSync(filename)
    : filename
  let release: () => void
  try {
    release = lockSync(target, { realpath: false, retries: 0 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ELOCKED') {
      throw new Error('另一个 Nexus 窗口正在保存配置，请稍后重试')
    }
    throw error
  }
  try {
    const value = build()
    const temporary = `${target}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600, flush: true })
      renameSync(temporary, target)
    } finally {
      rmSync(temporary, { force: true })
    }
    return value
  } finally {
    release()
  }
}
