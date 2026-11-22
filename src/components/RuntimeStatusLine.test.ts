import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringWidth } from '../ink/stringWidth.js'
import { getAgentModelRole } from '../utils/model/agent.js'
import { getSelectedModelRole, parseUserSpecifiedModel } from '../utils/model/model.js'
import { formatRuntimeStatus, modelRouteLabel, roleLabel } from './RuntimeStatusLine.js'

const status = {
  permission: 'default' as const,
  route: 'office/model-with-a-long-identifier',
  role: 'Quark',
  loading: true,
  tasks: 2,
  approvals: 3,
  remote: false,
}

test('permission and approval count take priority when the model label does not fit', () => {
  const text = formatRuntimeStatus(status, 42)
  expect(stringWidth(text)).toBeLessThanOrEqual(42)
  expect(text).toStartWith('权限：显式审批 · 待审批 3 · 任务 2')
  expect(text).not.toContain(status.route)
  expect(formatRuntimeStatus(status, 100)).toContain('Quark · office/model-with-a-long-identifier')
})

test('running and permission modes are distinct, and a remote route is never assumed', () => {
  const text = formatRuntimeStatus({ ...status, permission: 'bypassPermissions', approvals: 0 }, 100)
  expect(text).toStartWith('权限：绕过权限')
  expect(text).toEndWith('运行中')
  expect(text).not.toContain('待审批')
  expect(formatRuntimeStatus({ ...status, remote: true }, 100)).toBe('远程会话 · 待审批 3 · 任务 2')
})

test('shows the configured permission shortcut in default mode and keeps pending approvals visible', () => {
  const idle = { ...status, approvals: 0, tasks: 0, loading: false }
  expect(formatRuntimeStatus(idle, 58, 'shift+tab')).toStartWith('权限：显式审批 · shift+tab 切换')
  expect(formatRuntimeStatus(idle, 58, 'alt+m')).toContain('alt+m 切换')
  const narrow = formatRuntimeStatus(status, 38, 'shift+tab')
  expect(narrow).toStartWith('权限：显式审批 · 待审批 3 · shift+tab')
  expect(stringWidth(narrow)).toBeLessThanOrEqual(38)
  expect(formatRuntimeStatus(status, 27, 'shift+tab')).toStartWith('权限：显式审批 · 待审批 3')
  expect(formatRuntimeStatus({ ...idle, remote: true }, 58, 'shift+tab')).toBe('远程会话')
})

test('model labels preserve distinct channels and do not infer a role from a physical ID', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nexus-status-test-'))
  const previous = process.env.NEXUS_CONFIG_DIR
  process.env.NEXUS_CONFIG_DIR = directory
  try {
    const model = { id: 'same' }
    writeFileSync(join(directory, 'models.json'), JSON.stringify({
      roles: { quark: 'main::same', atom: 'aux::same', electron: 'aux::same' },
      channels: {
        main: { protocol: 'messages', baseURL: 'https://main.example', models: [model] },
        aux: { protocol: 'openai-compatible', baseURL: 'https://aux.example', models: [model, { id: 'Atom' }] },
      },
    }))
    expect(modelRouteLabel('main::same')).toBe('main/same')
    expect(modelRouteLabel('aux::same')).toBe('aux/same')
    expect(roleLabel('aux::atom')).toBeUndefined()
    expect(roleLabel('inherit')).toBeUndefined()
    expect(roleLabel('electron[1m]')).toBe('Electron')
    expect(getSelectedModelRole('atom')).toBe('atom')
    expect(getSelectedModelRole('quarkplan')).toBe('atom')
    expect(parseUserSpecifiedModel('Atom')).toBe('aux::Atom')
    expect(getSelectedModelRole('Atom')).toBeUndefined()
    expect(getSelectedModelRole('aux::Atom')).toBeUndefined()
    expect(getAgentModelRole('inherit')).toBeUndefined()
    expect(getAgentModelRole('Atom', 'electron')).toBe('electron')
  } finally {
    if (previous === undefined) delete process.env.NEXUS_CONFIG_DIR
    else process.env.NEXUS_CONFIG_DIR = previous
    rmSync(directory, { recursive: true, force: true })
  }
})
