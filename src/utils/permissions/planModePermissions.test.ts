import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { resolveHookPermissionDecision } from '../../services/tools/toolHooks.js'
import { getEmptyToolPermissionContext, type ToolUseContext } from '../../Tool.js'
import { BashTool } from '../../tools/BashTool/BashTool.js'
import { FileWriteTool } from '../../tools/FileWriteTool/FileWriteTool.js'
import { PowerShellTool } from '../../tools/PowerShellTool/PowerShellTool.js'
import type { PermissionMode } from '../../types/permissions.js'
import { createAssistantMessage } from '../messages.js'
import { getPlanFilePath, getPlansDirectory } from '../plans.js'
import { hasPermissionsToUseTool } from './permissions.js'
import { checkPlanModePermission } from './planModePermissions.js'

function createContext(mode: PermissionMode, allow: string[] = []): ToolUseContext {
  return {
    abortController: new AbortController(),
    getAppState: () => ({ toolPermissionContext: {
      ...getEmptyToolPermissionContext(),
      mode,
      isBypassPermissionsModeAvailable: true,
      alwaysAllowRules: { session: allow },
    } }),
  } as unknown as ToolUseContext
}

test('bypass availability does not approve project writes in plan mode', async () => {
  const input = { file_path: 'nexus-plan-test-project-write.txt', content: 'fixture' }
  const assistant = createAssistantMessage({ content: 'fixture' })
  const plan = await hasPermissionsToUseTool(FileWriteTool, input, createContext('plan', ['Write']), assistant, 'write')
  expect(plan).toMatchObject({ behavior: 'deny', decisionReason: { type: 'mode', mode: 'plan' } })
  const ordinary = await hasPermissionsToUseTool(FileWriteTool, input, createContext('default'), assistant, 'write')
  expect(ordinary.behavior).toBe('ask')
  const bypass = await hasPermissionsToUseTool(FileWriteTool, input, createContext('bypassPermissions'), assistant, 'write')
  expect(bypass).toMatchObject({ behavior: 'allow', decisionReason: { type: 'mode', mode: 'bypassPermissions' } })
})

// The PowerShell parser can spend two five-second attempts on a cold runner.
test('plan accepts its exact plan file and read-only commands but blocks builds', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexus-plan-permissions-'))
  const previous = process.env.NEXUS_CONFIG_DIR
  process.env.NEXUS_CONFIG_DIR = directory
  getPlansDirectory.cache.clear?.()
  try {
    const plan = createContext('plan')
    const planFile = getPlanFilePath()
    expect(await checkPlanModePermission(FileWriteTool, { file_path: planFile, content: 'fixture' }, plan)).toBeNull()
    const otherFile = planFile.replace(/\.md$/, '-other.md')
    expect((await checkPlanModePermission(FileWriteTool, { file_path: otherFile, content: 'fixture' }, plan))?.behavior).toBe('deny')
    expect(await checkPlanModePermission(BashTool, { command: 'git status --short' }, plan)).toBeNull()
    expect((await checkPlanModePermission(BashTool, { command: 'bun run build' }, plan))?.behavior).toBe('deny')
    expect((await checkPlanModePermission(PowerShellTool, { command: 'npm run build' }, plan))?.behavior).toBe('deny')
  } finally {
    if (previous === undefined) delete process.env.NEXUS_CONFIG_DIR
    else process.env.NEXUS_CONFIG_DIR = previous
    getPlansDirectory.cache.clear?.()
    rmSync(directory, { recursive: true, force: true })
  }
}, 20_000)

test('hook approvals and forced prompts cannot override the plan restriction', async () => {
  const context = createContext('plan')
  const input = { command: 'git status --short' }
  const updatedInput = { command: 'npm run build' }
  const assistant = createAssistantMessage({ content: 'fixture' })
  for (const behavior of ['allow', 'ask'] as const) {
    const { decision } = await resolveHookPermissionDecision(
      { behavior, updatedInput, message: 'fixture hook' }, BashTool, input, context,
      async () => { throw new Error('Blocked tool must not go to the approval handler') },
      assistant, 'bash',
    )
    expect(decision).toMatchObject({ behavior: 'deny', decisionReason: { type: 'mode', mode: 'plan' } })
  }
})
