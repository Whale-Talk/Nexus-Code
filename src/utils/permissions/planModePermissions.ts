import { basename, dirname, join, relative } from 'path'
import type { Tool, ToolUseContext } from '../../Tool.js'
import { EXIT_PLAN_MODE_V2_TOOL_NAME } from '../../tools/ExitPlanModeTool/constants.js'
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '../../tools/FileWriteTool/prompt.js'
import { isReadOnlyCommand as isReadOnlyPowerShellCommand } from '../../tools/PowerShellTool/readOnlyValidation.js'
import { POWERSHELL_TOOL_NAME } from '../../tools/PowerShellTool/toolName.js'
import { getPathsForPermissionCheck } from '../fsOperations.js'
import { expandPath } from '../path.js'
import { getPlanFilePath } from '../plans.js'
import { parsePowerShellCommand } from '../powershell/parser.js'
import type { PermissionDenyDecision } from './PermissionResult.js'

function isCurrentPlanFile(path: string, context: ToolUseContext): boolean {
  const target = expandPath(path)
  const planFile = getPlanFilePath(context.agentId)
  if (relative(planFile, target) !== '') return false

  // Allow the plan directory's resolved aliases, but never a file link
  // pointing at other content.
  const planLocations = getPathsForPermissionCheck(dirname(planFile))
    .map(directory => join(directory, basename(planFile)))
  return getPathsForPermissionCheck(target).every(location =>
    planLocations.some(expected => relative(expected, location) === ''),
  )
}

/** Plan limits which actions can reach the normal tool approval policy. */
export async function checkPlanModePermission(
  tool: Tool,
  input: Record<string, unknown>,
  context: ToolUseContext,
): Promise<PermissionDenyDecision | null> {
  if (context.getAppState().toolPermissionContext.mode !== 'plan') return null
  if (tool.name === EXIT_PLAN_MODE_V2_TOOL_NAME) return null

  const isFileEdit = tool.name === FILE_EDIT_TOOL_NAME || tool.name === FILE_WRITE_TOOL_NAME
  if (isFileEdit) {
    if (typeof input.file_path === 'string' && isCurrentPlanFile(input.file_path, context)) return null
  } else {
    try {
      const parsed = tool.inputSchema.safeParse(input)
      if (parsed.success) {
        const command = parsed.data.command
        if (tool.name === POWERSHELL_TOOL_NAME && typeof command === 'string') {
          // The synchronous PowerShell predicate cannot verify commands without an AST.
          if (isReadOnlyPowerShellCommand(command, await parsePowerShellCommand(command))) return null
        } else if (tool.isReadOnly(parsed.data)) {
          return null
        }
      }
    } catch {
      // A tool that cannot be verified as read-only must wait until implementation.
    }
  }

  return {
    behavior: 'deny',
    message: '计划模式下只能执行只读操作、提问或编辑本会话的计划文件。请先请求用户批准方案并退出计划模式，再修改或构建项目。',
    decisionReason: { type: 'mode', mode: 'plan' },
  }
}
