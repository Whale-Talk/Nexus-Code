import React from 'react'
import { useIsModalOverlayActive } from '../context/overlayContext.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { Box, Text } from '../ink.js'
import { stringWidth } from '../ink/stringWidth.js'
import { useOptionalKeybindingContext } from '../keybindings/KeybindingContext.js'
import { getCatalogModel, getModelCatalog } from '../services/api/provider/catalog.js'
import { truncateToWidth } from '../utils/format.js'
import { isModelRole, type ModelRole } from '../utils/model/roles.js'
import { getModeColor, type PermissionMode } from '../utils/permissions/PermissionMode.js'

const roleLabels: Record<ModelRole, string> = {
  quark: 'Quark',
  atom: 'Atom',
  electron: 'Electron',
}

export function roleLabel(role: string | null | undefined): string | undefined {
  const name = role?.toLowerCase().replace(/\[1m\]$/, '')
  return name && isModelRole(name) ? roleLabels[name] : undefined
}

export function modelRouteLabel(model: string | undefined): string | undefined {
  if (!model) return undefined
  const entry = getCatalogModel(model)
  // Older single-channel configurations may not have a catalog. Only show the
  // hostname, since a user-supplied URL may contain credentials or a query.
  let channel = entry?.channel
  if (!channel && !getModelCatalog() && process.env.NEXUS_BASE_URL) {
    try { channel = new URL(process.env.NEXUS_BASE_URL).hostname } catch {}
  }
  const id = (entry?.id ?? model).replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, '')
  return channel ? `${channel}/${id}` : id
}

const permissionLabels: Record<PermissionMode, string> = {
  default: '显式审批',
  plan: '计划模式',
  acceptEdits: '接受编辑',
  bypassPermissions: '绕过权限',
  dontAsk: '不询问',
  auto: '自动审批',
  bubble: '受限模式',
}

type RuntimeStatus = {
  permission: PermissionMode
  route?: string
  role?: string
  loading: boolean
  tasks: number
  approvals: number
  remote: boolean
}

export function formatRuntimeStatus({ permission, route, role, loading, tasks, approvals, remote }: RuntimeStatus, width: number, cycleShortcut?: string) {
  const info = [
    remote ? '远程会话' : `权限：${permissionLabels[permission]}`,
    approvals > 0 ? `待审批 ${approvals}` : undefined,
  ].filter(Boolean).join(' · ')
  const shortcutHint = !remote && cycleShortcut
    ? [`${cycleShortcut} 切换`, cycleShortcut].find(hint => stringWidth(`${info} · ${hint}`) <= width)
    : undefined
  return truncateToWidth([
    info,
    shortcutHint,
    tasks > 0 ? `任务 ${tasks}` : undefined,
    !remote && route ? [role, route].filter(Boolean).join(' · ') : undefined,
    loading && !approvals ? '运行中' : undefined,
  ].filter(Boolean).join(' · '), width)
}

export function RuntimeStatusLine({ canCyclePermissionMode, ...props }: RuntimeStatus & { canCyclePermissionMode: boolean }) {
  const { columns } = useTerminalSize()
  const keybindings = useOptionalKeybindingContext()
  const modalActive = useIsModalOverlayActive()
  const paddingX = columns < 50 ? 0 : 2
  const width = columns - paddingX * 2
  if (width < 1) return null
  const color = props.approvals > 0 ? 'warning' : props.remote ? 'text' : getModeColor(props.permission)
  const cycleShortcut = canCyclePermissionMode && !modalActive
    ? keybindings?.getDisplayText('chat:cycleMode', 'Chat')
    : undefined
  const status = formatRuntimeStatus(props, width, cycleShortcut)
  return <Box height={1} paddingX={paddingX}>
    <Text color={color} dimColor={color === 'text'}>{status}</Text>
  </Box>
}

export function ApprovalRequester({ agent, role }: { agent?: string; role?: string }) {
  const { columns } = useTerminalSize()
  const label = [agent, role].filter(Boolean).join(' · ')
  return <Box paddingX={2} height={1}>
    <Text bold color="permission">{truncateToWidth(label ? `审批请求 · ${label}` : '审批请求', Math.max(1, columns - 4))}</Text>
  </Box>
}
