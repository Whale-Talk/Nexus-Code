import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWithCwdOverride } from './cwd.js'
import { fetchGitDiff, fetchWorkingTreeDiffPreview, parseGitNumstat, readUntrackedDiffPreview } from './gitDiff.js'
import { gitExe } from './git.js'

let fixture: string
let root: string
const tracked = '中文 [a].txt'
const untracked = '新文件 😀.txt'

function git(...args: string[]) {
  const result = Bun.spawnSync([gitExe(), ...args], { cwd: root })
  expect(result.exitCode).toBe(0)
  return result.stdout.toString()
}

beforeAll(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'nexus-diff-test-'))
  root = join(fixture, 'repo')
  await mkdir(root)
  git('init', '--template=', '--quiet')
  git('config', 'core.autocrlf', 'false')
  await writeFile(join(root, tracked), 'original\n')
  git('add', '--', tracked)
  git('-c', 'user.name=Nexus Test', '-c', 'user.email=test@example.invalid', '-c',
    'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture')
  await writeFile(join(root, tracked), 'staged\n')
  git('add', '--', tracked)
  const lines = Array.from({ length: 700 }, (_, index) => '内容 ' + (index + 1))
  await writeFile(join(root, tracked), '++++literal\n----literal\n' + lines.join('\n') + '\n')
  await writeFile(join(root, untracked), '未跟踪文本\r\n头尾\r\n')
  await writeFile(join(root, 'binary.dat'), Buffer.from([13, 0, 235]))
  await writeFile(join(root, 'large.txt'), Buffer.alloc(1_000_001, 65))
  await mkdir(join(root, 'nested'))
  await mkdir(join(fixture, 'outside'))
  await writeFile(join(fixture, 'outside', 'hidden.txt'), 'outside text')
  await symlink(join(fixture, 'outside'), join(root, 'external'),
    process.platform === 'win32' ? 'junction' : 'dir')
})

afterAll(async () => {
  if (fixture) await rm(fixture, { recursive: true, force: true })
})

test('preserves literal Unicode filenames and tabs in NUL-delimited Git stats', () => {
  const result = parseGitNumstat('17\t1\t文件\tpath.ts\0-\t-\tbinary.png\0')
  expect(result.stats).toEqual({ filesCount: 2, linesAdded: 17, linesRemoved: 1 })
  expect(result.perFileStats.get('文件\tpath.ts')).toEqual({ added: 17, removed: 1, isBinary: false })
  expect(result.perFileStats.get('binary.png')?.isBinary).toBe(true)
})

test('lists the worktree from a subdirectory and parses only the selected patch against HEAD', async () => {
  const { signal } = new AbortController()
  const result = await runWithCwdOverride(join(root, 'nested'), () => fetchGitDiff(signal))
  expect(result?.perFileStats.get(tracked)).toEqual({ added: 702, removed: 1, isBinary: false })
  expect(result?.perFileStats.get(untracked)?.isUntracked).toBe(true)

  const preview = await fetchWorkingTreeDiffPreview(root, tracked, false, signal)
  expect(preview.kind).toBe('patch')
  if (preview.kind !== 'patch') return
  const lines = preview.hunks.flatMap(hunk => hunk.lines)
  expect(lines).toContain('-original')
  expect(lines).not.toContain('-staged')
  expect(lines).toContain('+++++literal')
  expect(lines).toContain('+----literal')
  expect(lines).toContain('+内容 700')
})

test('previews untracked text without writing or staging it', async () => {
  const index = await readFile(join(root, '.git', 'index'))
  const preview = await fetchWorkingTreeDiffPreview(root, untracked, true)
  expect(preview).toEqual({
    kind: 'patch',
    hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+未跟踪文本', '+头尾'] }],
  })
  expect(await readFile(join(root, '.git', 'index'))).toEqual(index)
})

test('rejects binary, oversized, traversal and symlink preview targets', async () => {
  expect(await readUntrackedDiffPreview(root, 'binary.dat')).toEqual({ kind: 'binary' })
  expect(await readUntrackedDiffPreview(root, 'large.txt')).toEqual({ kind: 'too-large' })
  expect(await readUntrackedDiffPreview(root, '../outside/hidden.txt')).toEqual({ kind: 'unavailable' })
  expect(await readUntrackedDiffPreview(root, 'external/hidden.txt')).toEqual({ kind: 'unavailable' })
})
