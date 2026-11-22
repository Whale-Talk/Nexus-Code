import { parsePatch, type StructuredPatchHunk } from 'diff'
import { execa } from 'execa'
import { constants } from 'fs'
import { access, lstat, open, readFile, realpath } from 'fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { getCwd } from './cwd.js'
import { getCachedRepository } from './detectRepository.js'
import { execFileNoThrowWithCwd } from './execFileNoThrow.js'
import { isFileWithinReadSizeLimit } from './file.js'
import { findGitRoot, getDefaultBranch, getGitDir, gitExe } from './git.js'

export type GitDiffStats = {
  filesCount: number
  linesAdded: number
  linesRemoved: number
}

export type PerFileStats = {
  added: number
  removed: number
  isBinary: boolean
  isUntracked?: boolean
}

export type GitDiffResult = {
  root: string
  stats: GitDiffStats
  perFileStats: Map<string, PerFileStats>
}

const GIT_TIMEOUT_MS = 5000
const MAX_LIST_FILES = 2000
const MAX_LIST_BYTES = 4_000_000
const MAX_DIFF_SIZE_BYTES = 1_000_000
const readOnlyGitArgs = ['--no-optional-locks', '--no-pager', '--literal-pathspecs']
const safeDiffArgs = ['--no-ext-diff', '--no-textconv', '--no-color', '--no-renames']

/** Read the working-tree file list against HEAD without loading patches. */
export async function fetchGitDiff(signal?: AbortSignal): Promise<GitDiffResult | null> {
  const root = findGitRoot(getCwd())
  if (!root || await isInTransientGitState(root)) return null

  const options = {
    cwd: root,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_LIST_BYTES,
    cancelSignal: signal,
    reject: false,
  }
  const [tracked, untracked] = await Promise.all([
    execa(gitExe(),
      [...readOnlyGitArgs, 'diff', ...safeDiffArgs, '--numstat', '-z', 'HEAD', '--'], options),
    execa(gitExe(),
      [...readOnlyGitArgs, 'ls-files', '--others', '--exclude-standard', '-z'], options),
  ])
  if (tracked.failed || untracked.failed) return null

  const { stats, perFileStats } = parseGitNumstat(tracked.stdout)
  const untrackedPaths = untracked.stdout.split('\0').filter(Boolean)
  stats.filesCount += untrackedPaths.length
  for (const filePath of untrackedPaths.slice(0, MAX_LIST_FILES)) {
    perFileStats.set(filePath, { added: 0, removed: 0, isBinary: false, isUntracked: true })
  }
  return { root, stats, perFileStats }
}

/** Use NUL-delimited numstat so Unicode filenames and paths with tabs survive. */
export function parseGitNumstat(stdout: string): Pick<GitDiffResult, 'stats' | 'perFileStats'> {
  const stats = { filesCount: 0, linesAdded: 0, linesRemoved: 0 }
  const perFileStats = new Map<string, PerFileStats>()
  for (const row of stdout.split('\0')) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(row)
    if (!match) continue
    const [, added, removed, filePath] = match
    const isBinary = added === '-' || removed === '-'
    const fileAdded = isBinary ? 0 : Number(added)
    const fileRemoved = isBinary ? 0 : Number(removed)
    stats.filesCount++
    stats.linesAdded += fileAdded
    stats.linesRemoved += fileRemoved
    if (filePath && perFileStats.size < MAX_LIST_FILES) {
      perFileStats.set(filePath, { added: fileAdded, removed: fileRemoved, isBinary })
    }
  }
  return { stats, perFileStats }
}

/** Avoid making incoming merge or rebase changes look like direct workspace edits. */
async function isInTransientGitState(root: string): Promise<boolean> {
  const gitDir = await getGitDir(root)
  if (!gitDir) return false
  const results = await Promise.all(
    ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'].map(file =>
      access(join(gitDir, file)).then(() => true, () => false),
    ),
  )
  return results.some(Boolean)
}

export type GitDiffPreview =
  | { kind: 'patch'; hunks: StructuredPatchHunk[] }
  | { kind: 'binary' | 'too-large' | 'unavailable' }

function resolveWorktreeFile(root: string, filePath: string): string | undefined {
  if (!filePath || isAbsolute(filePath) || (process.platform === 'win32' && filePath.includes(':'))) return
  const file = resolve(root, filePath)
  const inside = relative(root, file)
  if (!inside || inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) return
  return file
}

/** Load the selected file's patch against HEAD without changing the index. */
export async function fetchWorkingTreeDiffPreview(
  root: string,
  filePath: string,
  untracked: boolean,
  signal?: AbortSignal,
): Promise<GitDiffPreview> {
  const absoluteFilePath = resolveWorktreeFile(root, filePath)
  if (!absoluteFilePath || await isInTransientGitState(root) || signal?.aborted) {
    return { kind: 'unavailable' }
  }
  if (untracked) return readUntrackedDiffPreview(root, filePath)

  const gitPath = relative(root, absoluteFilePath).split(sep).join('/')
  try {
    const result = await execa(gitExe(), [
      ...readOnlyGitArgs, '-c', 'core.quotePath=false', 'diff', ...safeDiffArgs,
      '--src-prefix=a/', '--dst-prefix=b/', 'HEAD', '--', gitPath,
    ], {
      cwd: root,
      maxBuffer: MAX_DIFF_SIZE_BYTES,
      timeout: GIT_TIMEOUT_MS,
      cancelSignal: signal,
      reject: false,
    })
    if (result.isMaxBuffer) return { kind: 'too-large' }
    if (result.failed) return { kind: 'unavailable' }

    const sections = parsePatch(result.stdout)
    const patch = sections.length === 1 ? sections[0] : sections.find(section =>
      section.oldFileName === 'a/' + gitPath || section.newFileName === 'b/' + gitPath,
    )
    return { kind: 'patch', hunks: patch?.hunks ?? [] }
  } catch {
    return { kind: 'unavailable' }
  }
}

/** Read a bounded preview of a regular untracked file. Do not follow links. */
export async function readUntrackedDiffPreview(
  root: string,
  filePath: string,
): Promise<GitDiffPreview> {
  try {
    const canonicalRoot = await realpath(root)
    const file = resolveWorktreeFile(canonicalRoot, filePath)
    if (!file || relative(file, await realpath(file)) !== '') return { kind: 'unavailable' }

    const entry = await lstat(file)
    if (!entry.isFile()) return { kind: 'unavailable' }
    if (entry.size > MAX_DIFF_SIZE_BYTES) return { kind: 'too-large' }

    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
    const handle = await open(file, flags)
    let content: Buffer
    try {
      const opened = await handle.stat()
      if (!opened.isFile() || opened.ino !== entry.ino || opened.dev !== entry.dev
        || relative(file, await realpath(file)) !== '') return { kind: 'unavailable' }
      if (opened.size > MAX_DIFF_SIZE_BYTES) return { kind: 'too-large' }

      const buffer = Buffer.alloc(opened.size + 1)
      let length = 0
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
        if (!bytesRead) break
        length += bytesRead
      }
      if (length > opened.size) {
        return { kind: length > MAX_DIFF_SIZE_BYTES ? 'too-large' : 'unavailable' }
      }
      content = buffer.subarray(0, length)
    } finally {
      await handle.close()
    }

    if (content.includes(0)) return { kind: 'binary' }
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(content)
    } catch {
      return { kind: 'binary' }
    }
    const lines = text === '' ? [] : text.split(/\r?\n/)
    if (lines.at(-1) === '') lines.pop()
    return {
      kind: 'patch',
      hunks: lines.length ? [{
        oldStart: 0,
        oldLines: 0,
        newStart: 1,
        newLines: lines.length,
        lines: lines.map(line => '+' + line),
      }] : [],
    }
  } catch {
    return { kind: 'unavailable' }
  }
}

const SINGLE_FILE_DIFF_TIMEOUT_MS = 3000

export type ToolUseDiff = {
  filename: string
  status: 'modified' | 'added'
  additions: number
  deletions: number
  changes: number
  patch: string
  /** GitHub "owner/repo" when available (null for non-github.com or unknown repos) */
  repository: string | null
}

/**
 * Fetch a structured diff for a single file against the merge base with the
 * default branch. This produces a PR-like diff showing all changes since
 * the branch diverged. Falls back to diffing against HEAD if the merge base
 * cannot be determined (e.g., on the default branch itself).
 * For untracked files, generates a synthetic diff showing all additions.
 * Returns null if not in a git repo or if git commands fail.
 */
export async function fetchSingleFileGitDiff(
  absoluteFilePath: string,
): Promise<ToolUseDiff | null> {
  const gitRoot = findGitRoot(dirname(absoluteFilePath))
  if (!gitRoot) return null

  const gitPath = relative(gitRoot, absoluteFilePath).split(sep).join('/')
  const repository = getCachedRepository()

  // Check if the file is tracked by git
  const { code: lsFilesCode } = await execFileNoThrowWithCwd(
    gitExe(),
    ['--no-optional-locks', 'ls-files', '--error-unmatch', gitPath],
    { cwd: gitRoot, timeout: SINGLE_FILE_DIFF_TIMEOUT_MS },
  )

  if (lsFilesCode === 0) {
    // File is tracked - diff against merge base for PR-like view
    const diffRef = await getDiffRef(gitRoot)
    const { stdout, code } = await execFileNoThrowWithCwd(
      gitExe(),
      ['--no-optional-locks', 'diff', diffRef, '--', gitPath],
      { cwd: gitRoot, timeout: SINGLE_FILE_DIFF_TIMEOUT_MS },
    )
    if (code !== 0) return null
    if (!stdout) return null
    return {
      ...parseRawDiffToToolUseDiff(gitPath, stdout, 'modified'),
      repository,
    }
  }

  // File is untracked - generate synthetic diff
  const syntheticDiff = await generateSyntheticDiff(gitPath, absoluteFilePath)
  if (!syntheticDiff) return null
  return { ...syntheticDiff, repository }
}

/**
 * Parse raw unified diff output into the structured ToolUseDiff format.
 * Extracts only the hunk content (starting from @@) as the patch,
 * and counts additions/deletions.
 */
function parseRawDiffToToolUseDiff(
  filename: string,
  rawDiff: string,
  status: 'modified' | 'added',
): Omit<ToolUseDiff, 'repository'> {
  const lines = rawDiff.split('\n')
  const patchLines: string[] = []
  let inHunks = false
  let additions = 0
  let deletions = 0

  for (const line of lines) {
    if (line.startsWith('@@')) {
      inHunks = true
    }
    if (inHunks) {
      patchLines.push(line)
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++
      }
    }
  }

  return {
    filename,
    status,
    additions,
    deletions,
    changes: additions + deletions,
    patch: patchLines.join('\n'),
  }
}

/**
 * Determine the best ref to diff against for a PR-like diff.
 * Priority:
 * 1. NEXUS_BASE_REF env var (set externally, e.g. by CCR managed containers)
 * 2. Merge base with the default branch (best guess)
 * 3. HEAD (fallback if merge-base fails)
 */
async function getDiffRef(gitRoot: string): Promise<string> {
  const baseBranch =
    process.env.NEXUS_BASE_REF || (await getDefaultBranch())
  const { stdout, code } = await execFileNoThrowWithCwd(
    gitExe(),
    ['--no-optional-locks', 'merge-base', 'HEAD', baseBranch],
    { cwd: gitRoot, timeout: SINGLE_FILE_DIFF_TIMEOUT_MS },
  )
  if (code === 0 && stdout.trim()) {
    return stdout.trim()
  }
  return 'HEAD'
}

async function generateSyntheticDiff(
  gitPath: string,
  absoluteFilePath: string,
): Promise<Omit<ToolUseDiff, 'repository'> | null> {
  try {
    if (!isFileWithinReadSizeLimit(absoluteFilePath, MAX_DIFF_SIZE_BYTES)) {
      return null
    }
    const content = await readFile(absoluteFilePath, 'utf-8')
    const lines = content.split('\n')
    // Remove trailing empty line from split if file ends with newline
    if (lines.length > 0 && lines.at(-1) === '') {
      lines.pop()
    }
    const lineCount = lines.length
    const addedLines = lines.map(line => `+${line}`).join('\n')
    const patch = `@@ -0,0 +1,${lineCount} @@\n${addedLines}`
    return {
      filename: gitPath,
      status: 'added',
      additions: lineCount,
      deletions: 0,
      changes: lineCount,
      patch,
    }
  } catch {
    return null
  }
}
