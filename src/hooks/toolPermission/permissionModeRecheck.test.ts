import { expect, test } from 'bun:test'
import z from 'zod/v4'
import type { ToolUseConfirm } from '../../components/permissions/PermissionRequest.js'
import {
  buildTool,
  getEmptyToolPermissionContext,
  type ToolUseContext,
} from '../../Tool.js'
import { createAssistantMessage } from '../../utils/messages.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { handleInteractivePermission } from './handlers/interactiveHandler.js'
import { createPermissionContext } from './PermissionContext.js'

const tool = buildTool({
  name: 'ModeFixture',
  inputSchema: z.object({ path: z.string() }),
  description: async () => '',
  prompt: async () => '',
  maxResultSizeChars: 256,
  async checkPermissions() {
    return { behavior: 'ask' as const, message: 'fixture approval' }
  },
  async call() {
    return { data: '' }
  },
  mapToolResultToToolResultBlockParam(content: string, toolUseID: string) {
    return { type: 'tool_result' as const, content, tool_use_id: toolUseID }
  },
  renderToolUseMessage: () => null,
})

function fixture() {
  const state = { toolPermissionContext: getEmptyToolPermissionContext() }
  const queue = new Map<string, ToolUseConfirm>()
  const toolUseContext = {
    abortController: new AbortController(),
    getAppState: () => state,
  } as unknown as ToolUseContext
  const ctx = createPermissionContext(
    tool,
    { path: 'fixture.txt' },
    toolUseContext,
    createAssistantMessage({ content: 'fixture' }),
    'fixture',
    next => { state.toolPermissionContext = next },
    {
      push: item => { queue.set(item.toolUseID, item) },
      remove: id => { queue.delete(id) },
      update: () => {},
    },
  )
  return { ctx, queue, state }
}

test('a pending approval closes with the current no-prompt denial or bypass reason', async () => {
  for (const mode of ['dontAsk', 'bypassPermissions'] as const) {
    const { ctx, queue, state } = fixture()
    const result = new Promise<PermissionDecision>(resolve => {
      handleInteractivePermission(
        {
          ctx,
          description: 'fixture',
          result: { behavior: 'ask', message: 'fixture approval' },
          awaitAutomatedChecksBeforeDialog: true,
        },
        resolve,
      )
    })
    const pending = queue.get(ctx.toolUseID)!
    state.toolPermissionContext = { ...state.toolPermissionContext, mode }
    await pending.recheckPermission()
    expect(queue.size).toBe(0)
    expect(await result).toMatchObject({
      behavior: mode === 'dontAsk' ? 'deny' : 'allow',
      decisionReason: { type: 'mode', mode },
    })
  }
})

test('a hook can add a rule without being able to enable bypass for the user', async () => {
  const { ctx, state } = fixture()
  const bypass = {
    type: 'setMode',
    mode: 'bypassPermissions',
    destination: 'session',
  } as const
  const decision = await ctx.handleHookAllow(ctx.input, [
    bypass,
    {
      type: 'addRules',
      rules: [{ toolName: tool.name }],
      behavior: 'allow',
      destination: 'session',
    },
  ])
  expect(decision.behavior).toBe('allow')
  expect(state.toolPermissionContext.mode).toBe('default')
  expect(state.toolPermissionContext.alwaysAllowRules.session).toContain(tool.name)
  await ctx.handleUserAllow(ctx.input, [bypass])
  expect(state.toolPermissionContext.mode).toBe('bypassPermissions')
})

test('an isolation override requires one-shot approval and preserves its reason', async () => {
  const { ctx, queue, state } = fixture()
  let hookRuns = 0
  const overrideReason = {
    type: 'sandboxOverride',
    reason: 'dangerouslyDisableSandbox',
  } as const
  const result = new Promise<PermissionDecision>(resolve => {
    handleInteractivePermission(
      {
        ctx: {
          ...ctx,
          async runHooks() {
            hookRuns++
            return null
          },
        },
        description: 'fixture command',
        result: {
          behavior: 'ask',
          message: 'isolation override',
          decisionReason: overrideReason,
        },
        awaitAutomatedChecksBeforeDialog: false,
      },
      resolve,
    )
  })
  const pending = queue.get(ctx.toolUseID)!
  await pending.onAllow(ctx.input, [
    { type: 'setMode', mode: 'bypassPermissions', destination: 'session' },
  ])
  expect(hookRuns).toBe(0)
  expect(state.toolPermissionContext.mode).toBe('default')
  expect(await result).toMatchObject({ behavior: 'allow', decisionReason: overrideReason })
})
