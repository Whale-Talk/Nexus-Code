import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { getErrnoCode } from './errors.js'
import { getFsImplementation } from './fsOperations.js'

export const DEFAULT_INSTRUCTION_FILE = 'AGENT.md'
const LEGACY_INSTRUCTION_FILE = 'NEXUS.md'
export const PROJECT_INSTRUCTION_FALLBACKS = ['AGENTS.md', 'CLAUDE.md', '.claude/CLAUDE.md', 'GEMINI.md'] as const
type InstructionScope = 'shared' | 'local'

function fileNameForScope(name: string, scope: InstructionScope): string {
  return scope === 'local' ? `${name.slice(0, -3)}.local.md` : name
}

export function getInstructionFileName(scope: InstructionScope = 'shared'): string {
  const name = process.env.NEXUS_INSTRUCTIONS_FILE?.trim()
  // Only accept a portable Markdown basename. Discovery must stay inside its directory.
  const valid = name && /^[a-z0-9][a-z0-9_-]{0,63}\.md$/i.test(name) &&
    !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])\.md$/i.test(name)
  return fileNameForScope(valid ? name : DEFAULT_INSTRUCTION_FILE, scope)
}

function getInstructionFileNames(scope: InstructionScope): string[] {
  const names = [getInstructionFileName(scope), fileNameForScope(DEFAULT_INSTRUCTION_FILE, scope),
    fileNameForScope(LEGACY_INSTRUCTION_FILE, scope)]
  return Array.from(new Set(names))
}

export function findInstructionFile(directory: string, scope: InstructionScope = 'shared'): string | undefined {
  const fs = getFsImplementation()
  for (const name of getInstructionFileNames(scope)) {
    const path = join(directory, name)
    try {
      const stat = fs.lstatSync(path)
      // An existing primary entry claims this slot, including an empty file.
      // Fall back only when it is missing, not when it is excluded or unreadable.
      return stat.isFile() || stat.isSymbolicLink() ? path : undefined
    } catch (error) {
      const code = getErrnoCode(error)
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return undefined
    }
  }
}

export function getInstructionFilePath(directory: string, scope: InstructionScope = 'shared'): string {
  return findInstructionFile(directory, scope) ?? getInstructionWritePath(directory, scope)
}

export function getInstructionWritePath(directory: string, scope: InstructionScope = 'shared'): string {
  return join(directory, getInstructionFileName(scope))
}

function findCompatibleProjectInstructions(directory: string): string | undefined {
  const fs = getFsImplementation()
  for (const name of PROJECT_INSTRUCTION_FALLBACKS) {
    const file = join(directory, name)
    try {
      if (!fs.statSync(file).isFile()) continue
      const offset = relative(fs.realpathSync(directory), fs.realpathSync(file))
      // Compatibility discovery should not follow a file or directory link outside the project.
      if (!isAbsolute(offset) && offset !== '..' && !offset.startsWith(`..${sep}`)) return file
    } catch (error) {
      const code = getErrnoCode(error)
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return undefined
    }
  }
}

export function getProjectInstructionFiles(directory: string, includeCompatibility = true): string[] {
  const native = [findInstructionFile(directory), findInstructionFile(join(directory, '.nexus'))]
    .filter((file): file is string => file !== undefined)
  if (native.length || !includeCompatibility) return native
  const compatible = findCompatibleProjectInstructions(directory)
  return compatible ? [compatible] : []
}

export function getProjectInstructionWritePath(directory: string): string {
  const file = getInstructionWritePath(directory)
  if (getFsImplementation().existsSync(file)) return file
  const hiddenDirectory = join(directory, '.nexus')
  const hidden = getInstructionWritePath(hiddenDirectory)
  return findInstructionFile(hiddenDirectory) === hidden ? hidden : file
}

export function getInstructionStarterContent(directory: string, project: boolean): string {
  // Creating a root project file shadows the root fallback, not the independent
  // .nexus instruction slot. Import the fallback so its instructions survive.
  const source = project
    ? getProjectInstructionFiles(directory).find(file => dirname(file) !== join(directory, '.nexus'))
    : findInstructionFile(directory)
  if (!source) return ''
  const target = project ? getProjectInstructionWritePath(directory) : getInstructionWritePath(directory)
  if (source === target) return ''
  return `@./${relative(dirname(target), source).replaceAll('\\', '/')}\n`
}

export function isInstructionFilePath(path: string): boolean {
  const name = basename(path)
  return getInstructionFileAliases(path).length > 0 ||
    PROJECT_INSTRUCTION_FALLBACKS.some(candidate => equalName(basename(candidate), name))
}

export function getInstructionFileAliases(path: string): string[] {
  const name = basename(path)
  for (const scope of ['shared', 'local'] as const) {
    const names = getInstructionFileNames(scope)
    const matches = names.some(candidate => equalName(candidate, name))
    if (matches) return names.map(candidate => join(dirname(path), candidate))
  }
  return []
}

function equalName(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}
