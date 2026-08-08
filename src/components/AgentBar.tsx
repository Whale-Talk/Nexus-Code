// AgentBar — persistent agent status strip below the PromptInput.
// Shows running agents (yellow) and recently completed agents (green, 5s then gone).
// Click a line to open the AsyncAgentDetailDialog for that agent.

import * as React from 'react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Box, Text } from '../ink.js'
import { useAppStateStore } from '../state/AppState.js'
import { getRunningTasks } from '../utils/task/framework.js'
import type { TaskState } from '../tasks/types.js'

const COMPLETED_TTL_MS = 5000 // green dot lingers 5s before disappearing

type AgentLine = {
  id: string
  label: string
  status: 'running' | 'completed'
  completedAt: number | null
  data: TaskState
}

function useAgentLines(): AgentLine[] {
  const store = useAppStateStore()
  const appState = useSyncExternalStore(
    store.subscribe.bind(store),
    () => store.getState(),
  )
  const [completed, setCompleted] = useState<Map<string, number>>(new Map())
  const prevIdsRef = useRef<Set<string>>(new Set())

  const running = getRunningTasks(appState)

  // Track completed timestamps
  useEffect(() => {
    const allTasks = Object.values(appState.tasks ?? {})
    for (const task of allTasks) {
      if (task.status === 'completed' || task.status === 'failed') {
        setCompleted(prev => {
          if (!prev.has(task.id)) {
            const next = new Map(prev)
            next.set(task.id, Date.now())
            return next
          }
          return prev
        })
      }
    }
  }, [appState.tasks])

  // Expire completed lines
  useEffect(() => {
    if (completed.size === 0) return
    const timer = setInterval(() => {
      const now = Date.now()
      setCompleted(prev => {
        const next = new Map(prev)
        for (const [id, ts] of prev) {
          if (now - ts > COMPLETED_TTL_MS) next.delete(id)
        }
        return next.size !== prev.size ? next : prev
      })
    }, 500)
    return () => clearInterval(timer)
  }, [completed.size])

  const lines: AgentLine[] = []

  for (const task of running) {
    lines.push({
      id: task.id,
      label: taskLabel(task),
      status: 'running' as const,
      completedAt: null,
      data: task,
    })
  }

  const allTasks = Object.values(appState.tasks ?? {})
  for (const task of allTasks) {
    if (task.status !== 'completed' && task.status !== 'failed') continue
    if (!completed.has(task.id)) continue
    lines.push({
      id: task.id,
      label: taskLabel(task),
      status: 'completed' as const,
      completedAt: completed.get(task.id)!,
      data: task,
    })
  }

  return lines
}

function taskLabel(task: TaskState): string {
  // Use the most descriptive label available
  switch (task.type) {
    case 'local_agent':
      return (task as any).description || (task as any).subagent_type || 'Agent'
    case 'remote_agent':
      return (task as any).description || (task as any).label || 'Remote Agent'
    default:
      return (task as any).description || (task as any).label || task.type
  }
}

const STATUS_ICONS = {
  running: '●',
  completed: '●',
} as const

const STATUS_COLORS = {
  running: 'yellow',
  completed: 'green',
} as const

export function AgentBar(): React.ReactNode | null {
  const lines = useAgentLines()

  if (lines.length === 0) return null

  return (
    <Box flexDirection="row" marginTop={0}>
      {lines.map(line => (
        <Box key={line.id} marginRight={2}>
          <Text color={STATUS_COLORS[line.status]}>
            {STATUS_ICONS[line.status]}
          </Text>
          <Text> </Text>
          <Text dimColor={line.status === 'completed'}>
            {line.label}
          </Text>
        </Box>
      ))}
    </Box>
  )
}
