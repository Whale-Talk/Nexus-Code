/**
 * OMN 模式状态文件管理（与官方 activateState/clearStateFiles 语义一致）。
 *
 * 状态路径沿用 .omc/state/ —— 内置技能（ralph/autopilot/cancel 等）的
 * 持久化循环、stop hook 和清理逻辑都读写该目录，改名会破坏技能互操作。
 * 原子写入防并发 hook 写出半截 JSON。
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'

const MAX_STATE_PROMPT_LEN = 500

/** 写入状态前清洗 prompt：剥离系统回声并截断，防止回声被持久化后反复注入 */
function sanitizePromptForState(prompt: string): string {
  if (typeof prompt !== 'string') return ''
  const trimmed = prompt.trim()
  if (!trimmed) return ''
  // 剥离 [RALPH LOOP] 等回声块（保守简化版；完整回声检测在 keywordDetector）
  const stripped = trimmed
    .replace(/\[(?:RALPH|AUTOPILOT|ULTRAPILOT|ULTRAWORK|TEAM)[^\]]*\]/gi, ' ')
    .trim()
  const base = stripped.length > 0 ? stripped : trimmed
  return base.length > MAX_STATE_PROMPT_LEN
    ? `${base.slice(0, MAX_STATE_PROMPT_LEN - 3)}...`
    : base
}

function atomicWriteFileSync(filePath: string, content: string): void {
  try {
    const tmpPath = `${filePath}.tmp-${process.pid}`
    writeFileSync(tmpPath, content, { mode: 0o600 })
    writeFileSync(filePath, content, { mode: 0o600 })
    try { unlinkSync(tmpPath) } catch {}
  } catch {
    // best-effort: state 文件失败不阻塞用户输入
  }
}

export type OmnStateName = 'ralph' | 'ralplan' | 'autopilot' | 'ultrawork'

function getStatePath(
  directory: string,
  stateName: string,
  sessionId?: string,
): string {
  if (sessionId && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,255}$/.test(sessionId)) {
    return join(directory, '.omc', 'state', 'sessions', sessionId, `${stateName}-state.json`)
  }
  return join(directory, '.omc', 'state', `${stateName}-state.json`)
}

/** 激活模式状态（ralph 带循环追踪字段，其余通用） */
export function activateOmnState(
  directory: string,
  prompt: string,
  stateName: OmnStateName,
  sessionId?: string,
): void {
  const now = new Date().toISOString()
  const safePrompt = sanitizePromptForState(prompt)

  const state =
    stateName === 'ralph'
      ? {
          active: true,
          iteration: 1,
          max_iterations: 100,
          started_at: now,
          prompt: safePrompt,
          session_id: sessionId || undefined,
          project_path: directory,
          linked_ultrawork: true,
          awaiting_confirmation: true,
          awaiting_confirmation_set_at: now,
          last_checked_at: now,
        }
      : stateName === 'ralplan'
        ? {
            active: true,
            started_at: now,
            session_id: sessionId || undefined,
            project_path: directory,
            awaiting_confirmation: true,
            awaiting_confirmation_set_at: now,
            last_checked_at: now,
          }
        : {
            active: true,
            started_at: now,
            original_prompt: safePrompt,
            session_id: sessionId || undefined,
            project_path: directory,
            reinforcement_count: 0,
            awaiting_confirmation: true,
            awaiting_confirmation_set_at: now,
            last_checked_at: now,
          }

  const statePath = getStatePath(directory, stateName, sessionId)
  try {
    mkdirSync(join(statePath, '..'), { recursive: true })
  } catch {}
  atomicWriteFileSync(statePath, JSON.stringify(state, null, 2))
}

/** cancel 时清理模式状态（local + session 两级） */
export function clearOmnStateFiles(
  directory: string,
  modeNames: string[],
  sessionId?: string,
): void {
  for (const name of modeNames) {
    for (const path of [getStatePath(directory, name, sessionId), getStatePath(directory, name)]) {
      try {
        if (existsSync(path)) unlinkSync(path)
      } catch {}
    }
  }
}

/** 读取状态（供检测器检查已有模式，例如避免重复激活） */
export function readOmnState(
  directory: string,
  stateName: string,
  sessionId?: string,
): unknown | null {
  const path = getStatePath(directory, stateName, sessionId)
  try {
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}
