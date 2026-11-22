import { expect, spyOn, test } from 'bun:test'
import { resolveHookPermissionDecision } from '../../services/tools/toolHooks.js'
import { getEmptyToolPermissionContext, type Tool, type ToolPermissionContext, type ToolUseContext } from '../../Tool.js'
import { BashTool } from '../../tools/BashTool/BashTool.js'
import { PowerShellTool } from '../../tools/PowerShellTool/PowerShellTool.js'
import { createAssistantMessage } from '../messages.js'
import { SandboxManager } from '../sandbox/sandbox-adapter.js'
import type { PermissionMode } from './PermissionMode.js'
import { hasPermissionsToUseTool } from './permissions.js'

function toolContext(readMode: () => PermissionMode, rules: Partial<ToolPermissionContext> = {}): ToolUseContext {
  return {
    abortController: new AbortController(),
    getAppState: () => ({ toolPermissionContext: {
      ...getEmptyToolPermissionContext(), ...rules, mode: readMode(),
    } }),
  } as ToolUseContext
}

const assistant = createAssistantMessage({ content: 'local permission fixture' })
const command = { command: 'echo nexus-isolation-fixture' }

test('an asynchronous edit grant is recomputed after switching to dontAsk', async () => {
  let mode: PermissionMode = 'acceptEdits'
  let startCheck!: () => void
  let finishCheck!: () => void
  const started = new Promise<void>(resolve => { startCheck = resolve })
  const pending = new Promise<void>(resolve => { finishCheck = resolve })
  const tool: Tool = {
    ...BashTool,
    async checkPermissions(input, context) {
      const checkedMode = context.getAppState().toolPermissionContext.mode
      if (checkedMode !== 'acceptEdits') return { behavior: 'ask', message: 'Fixture needs approval' }
      startCheck()
      await pending
      return { behavior: 'allow', updatedInput: input, decisionReason: { type: 'mode', mode: checkedMode } }
    },
  }
  const decision = hasPermissionsToUseTool(tool, command, toolContext(() => mode), assistant, 'fixture')
  await started
  mode = 'dontAsk'
  finishCheck()
  expect(await decision).toMatchObject({ behavior: 'deny', decisionReason: { type: 'mode', mode: 'dontAsk' } })
})

test('sandbox auto-allow respects a tool-wide ask and dontAsk turns that request into a denial', async () => {
  const enabled = spyOn(SandboxManager, 'isSandboxingEnabled').mockReturnValue(true)
  const autoAllow = spyOn(SandboxManager, 'isAutoAllowBashIfSandboxedEnabled').mockReturnValue(true)
  try {
    const rules = { alwaysAskRules: { session: ['Bash'] } }
    const result = await hasPermissionsToUseTool(BashTool, command, toolContext(() => 'default', rules), assistant, 'bash')
    expect(result).toMatchObject({ behavior: 'ask', decisionReason: { type: 'rule' } })
    const denied = await hasPermissionsToUseTool(BashTool, command, toolContext(() => 'dontAsk', rules), assistant, 'bash')
    expect(denied).toMatchObject({ behavior: 'deny', decisionReason: { type: 'mode', mode: 'dontAsk' } })
  } finally {
    autoAllow.mockRestore()
    enabled.mockRestore()
  }
})

// The PowerShell parser can spend two five-second attempts on a cold runner.
test('an optional sandbox exit needs an explicit approval in bypass and across a hook approval', async () => {
  const enabled = spyOn(SandboxManager, 'isSandboxingEnabled').mockReturnValue(true)
  const escapeAllowed = spyOn(SandboxManager, 'areUnsandboxedCommandsAllowed').mockReturnValue(true)
  try {
    const bypass = toolContext(() => 'bypassPermissions')
    const input = { ...command, dangerouslyDisableSandbox: true }
    for (const tool of [BashTool, PowerShellTool]) {
      const decision = await hasPermissionsToUseTool(tool, input, bypass, assistant, 'shell')
      expect(decision).toMatchObject({ behavior: 'ask', decisionReason: { type: 'sandboxOverride' } })
      const hooked = await resolveHookPermissionDecision(
        { behavior: 'allow', updatedInput: input }, tool, command, bypass,
        hasPermissionsToUseTool, assistant, 'shell',
      )
      expect(hooked.decision).toMatchObject({ behavior: 'ask', decisionReason: { type: 'sandboxOverride' } })
      const dontAsk = await hasPermissionsToUseTool(tool, input, toolContext(() => 'dontAsk'), assistant, 'shell')
      expect(dontAsk.behavior).toBe('deny')
    }
  } finally {
    escapeAllowed.mockRestore()
    enabled.mockRestore()
  }
}, 20_000)
