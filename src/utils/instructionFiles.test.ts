import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  findInstructionFile,
  getInstructionFileAliases,
  getInstructionFileName,
  getInstructionFilePath,
  getInstructionStarterContent,
  getProjectInstructionFiles,
  getProjectInstructionWritePath,
  isInstructionFilePath,
} from './instructionFiles.js'

let directory: string
let oldFileName: string | undefined

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'nexus-instruction-files-'))
  oldFileName = process.env.NEXUS_INSTRUCTIONS_FILE
  delete process.env.NEXUS_INSTRUCTIONS_FILE
})

afterEach(() => {
  if (oldFileName === undefined) delete process.env.NEXUS_INSTRUCTIONS_FILE
  else process.env.NEXUS_INSTRUCTIONS_FILE = oldFileName
  rmSync(directory, { recursive: true, force: true })
})

test('a legacy file is still read while the write target is canonical', () => {
  const canonical = join(directory, 'AGENT.md')
  const legacy = join(directory, 'NEXUS.md')
  expect(findInstructionFile(directory)).toBeUndefined()
  expect(getProjectInstructionWritePath(directory)).toBe(canonical)
  writeFileSync(legacy, 'Legacy project instructions')
  expect(getProjectInstructionFiles(directory)).toEqual([legacy])
  expect(getProjectInstructionWritePath(directory)).toBe(canonical)
  expect(getInstructionStarterContent(directory, true)).toBe('@./NEXUS.md\n')
  writeFileSync(canonical, '')
  expect(getProjectInstructionFiles(directory)).toEqual([canonical])
  expect(getInstructionStarterContent(directory, true)).toBe('')
})

test('a deployment name selects the project and private variants with compatibility fallbacks', () => {
  process.env.NEXUS_INSTRUCTIONS_FILE = 'TEAM-AGENT.md'
  const hidden = join(directory, '.nexus')
  mkdirSync(hidden)
  writeFileSync(join(hidden, 'AGENT.md'), 'Standard hidden instructions')
  expect(getProjectInstructionFiles(directory)).toEqual([join(hidden, 'AGENT.md')])
  writeFileSync(join(hidden, 'TEAM-AGENT.md'), 'Team instructions')
  expect(getProjectInstructionFiles(directory)).toEqual([join(hidden, 'TEAM-AGENT.md')])
  expect(getProjectInstructionWritePath(directory)).toBe(join(hidden, 'TEAM-AGENT.md'))

  expect(getInstructionFilePath(directory, 'local')).toBe(join(directory, 'TEAM-AGENT.local.md'))
  writeFileSync(join(directory, 'NEXUS.local.md'), 'Old local instructions')
  expect(getInstructionFilePath(directory, 'local')).toBe(join(directory, 'NEXUS.local.md'))
  expect(getInstructionFileAliases(join(directory, 'TEAM-AGENT.local.md'))).toEqual([
    join(directory, 'TEAM-AGENT.local.md'), join(directory, 'AGENT.local.md'), join(directory, 'NEXUS.local.md'),
  ])
  expect(isInstructionFilePath(join(directory, 'AGENTS.md'))).toBe(true)
})

test('compatible project files are read in priority order and never selected as the write target', () => {
  mkdirSync(join(directory, '.claude'))
  const candidates = ['AGENTS.md', 'CLAUDE.md', '.claude/CLAUDE.md', 'GEMINI.md']
  for (const candidate of candidates) writeFileSync(join(directory, candidate), 'Compatibility instructions')
  expect(getProjectInstructionFiles(directory, false)).toEqual([])
  for (const candidate of candidates) {
    expect(getProjectInstructionFiles(directory)).toEqual([join(directory, candidate)])
    expect(getProjectInstructionWritePath(directory)).toBe(join(directory, 'AGENT.md'))
    expect(getInstructionStarterContent(directory, true)).toBe(`@./${candidate}\n`)
    rmSync(join(directory, candidate))
  }
})

test('compatibility discovery does not follow a brand-directory link outside the project', () => {
  const project = join(directory, 'repo')
  const external = join(directory, 'external')
  mkdirSync(project)
  mkdirSync(external)
  writeFileSync(join(external, 'CLAUDE.md'), 'Instructions outside the project')
  symlinkSync(external, join(project, '.claude'), process.platform === 'win32' ? 'junction' : 'dir')
  expect(getProjectInstructionFiles(project)).toEqual([])
})

test('unportable filenames cannot change discovery outside the instruction slot', () => {
  for (const name of ['../OTHER.md', '..\\OTHER.md', 'C:\\OTHER.md', '/OTHER.md', 'NUL.md', 'TEAM.local.md']) {
    process.env.NEXUS_INSTRUCTIONS_FILE = name
    expect(getInstructionFileName()).toBe('AGENT.md')
    expect(getInstructionFileName('local')).toBe('AGENT.local.md')
  }
})
