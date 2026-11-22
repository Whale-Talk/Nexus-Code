import React, { useState } from 'react'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { Box, Text } from '../ink.js'
import {
  getEditableModelCatalog,
  getModelCatalog,
  saveRoleBinding,
  type CatalogConfig,
  type ModelRole,
} from '../services/api/provider/catalog.js'
import { displayChannelName } from '../services/api/provider/presets.js'
import { isModelAllowed } from '../utils/model/modelAllowlist.js'
import { Select, type OptionWithDescription } from './CustomSelect/index.js'
import { Pane } from './design-system/Pane.js'
import { ModelChannelForm } from './ModelChannelForm.js'

const roleNames = { quark: 'Quark', atom: 'Atom', electron: 'Electron' } as const
const roles = Object.keys(roleNames) as ModelRole[]
const addChannel = ':add-channel'
const addModels = ':add-models'

type Screen =
  | { kind: 'roles' }
  | { kind: 'channels'; role: ModelRole; addingModels?: boolean }
  | { kind: 'models'; role: ModelRole; channel: string }
  | { kind: 'confirm'; role: ModelRole; channel: string; model: string }
type FormState = { role: ModelRole; channel?: string }
type CatalogState =
  | { config: CatalogConfig; preview: boolean }
  | { error: string }

function readCatalog(): CatalogState {
  try {
    return { config: getEditableModelCatalog(), preview: !getModelCatalog() }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function displayBinding(value: string, config?: CatalogConfig): string {
  if (!value) return '尚未配置'
  const separator = value.indexOf('::')
  if (separator < 0) return value
  const id = value.slice(0, separator)
  const channel = config?.channels[id]
  return `${channel ? displayChannelName(id, channel) : id} / ${value.slice(separator + 2)}`
}

export function RoleModelSettings({ onClose, onManageChannels, onReasoning, initialFocus }: {
  onClose: () => void
  onManageChannels?: () => void
  onReasoning?: () => void
  initialFocus?: string
}) {
  const [catalog, setCatalog] = useState(readCatalog)
  const [screen, setScreen] = useState<Screen>({ kind: 'roles' })
  const [lastRole, setLastRole] = useState(initialFocus ?? 'quark')
  const [form, setForm] = useState<FormState>()
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const { columns, rows } = useTerminalSize()
  const compact = columns < 68

  function go(next: Screen) {
    setNotice('')
    setError('')
    setScreen(next)
  }

  if (form) {
    return <ModelChannelForm
      channelId={form.channel}
      bindRole={form.role}
      onCancel={() => setForm(undefined)}
      onSave={(channel, result) => {
        setCatalog(readCatalog())
        go(result.boundRole ? { kind: 'roles' } : { kind: 'models', role: form.role, channel })
        setNotice(result.message)
        setForm(undefined)
      }}
    />
  }

  if ('error' in catalog) {
    return <Pane color="permission">
      <Text bold>角色模型配置</Text>
      <Text color="error">{catalog.error}</Text>
      <Select clickToSelect options={[{ label: '重新读取', value: 'retry' }, { label: '返回', value: 'back' }]}
        onChange={(value: string) => value === 'retry' ? setCatalog(readCatalog()) : onClose()}
        onCancel={onClose} />
    </Pane>
  }

  const { config } = catalog
  let title: string
  let hint: string
  let options: OptionWithDescription<string>[]
  let focus: string | undefined
  let selected: string | undefined
  let choose: (value: string) => void
  let back: () => void

  switch (screen.kind) {
    case 'roles':
      title = '角色绑定'
      hint = catalog.preview && config.channels.current
        ? `沿用现有连接 ${new URL(config.channels.current.baseURL).host}。选择角色调整绑定。`
        : '选择要配置的角色。绑定适用于此用户的所有项目。'
      options = roles.map(role => ({
        label: roleNames[role], value: role, description: displayBinding(config.roles[role], config),
      }))
      if (onManageChannels) options.push({ value: 'channels', label: '管理渠道与模型', description: '新增渠道、密钥和模型高级参数' })
      if (onReasoning) options.push({ value: 'reasoning', label: '推理偏好', description: '设置思考模式和推理强度' })
      focus = lastRole
      choose = value => {
        if (value === 'channels') return onManageChannels?.()
        if (value === 'reasoning') return onReasoning?.()
        const role = value as ModelRole
        setLastRole(role)
        go({ kind: 'channels', role })
      }
      back = onClose
      break
    case 'channels': {
      const { role, addingModels } = screen
      title = `${roleNames[role]} · ${addingModels ? '为哪个渠道添加模型' : '选择渠道'}`
      hint = `当前绑定  ${displayBinding(config.roles[role])}`
      options = Object.keys(config.channels).map(id => {
        const channel = config.channels[id]!
        return {
          label: displayChannelName(id, channel), value: id,
          description: `${new URL(channel.baseURL).host} · ${channel.models.length} 个模型`,
        }
      })
      if (!addingModels) {
        options.push({ label: '＋ 新增渠道', value: addChannel })
        if (Object.keys(config.channels).length) {
          options.push({ label: '为已有渠道添加模型', value: addModels })
        }
      }
      selected = config.roles[role].split('::')[0] || undefined
      focus = selected
      choose = value => {
        if (value === addChannel) setForm({ role })
        else if (value === addModels) go({ kind: 'channels', role, addingModels: true })
        else if (addingModels) setForm({ role, channel: value })
        else go({ kind: 'models', role, channel: value })
      }
      back = () => go(addingModels ? { kind: 'channels', role } : { kind: 'roles' })
      break
    }
    case 'models': {
      const { role, channel } = screen
      title = `${roleNames[role]} · 选择模型`
      hint = `渠道  ${channel}`
      options = config.channels[channel]!.models.map(model => {
        const value = `${channel}::${model.id}`
        const allowed = isModelAllowed(value) || (catalog.preview && isModelAllowed(model.id))
        return {
          value,
          label: model.name ?? model.id,
          description: !allowed ? '受模型使用策略限制' : (model.name ? model.id : undefined),
          disabled: !allowed,
        }
      })
      options.push({ label: '＋ 为此渠道添加模型', value: addModels }, { label: '＋ 新增渠道', value: addChannel })
      selected = options.find(option => option.value === config.roles[role])?.value
      focus = selected ?? options.find(option => !option.disabled)?.value
      choose = value => {
        if (value === addModels) setForm({ role, channel })
        else if (value === addChannel) setForm({ role })
        else go({ kind: 'confirm', role, channel, model: value })
      }
      back = () => go({ kind: 'channels', role })
      break
    }
    case 'confirm': {
      const { role, channel, model } = screen
      title = `保存 ${roleNames[role]} 的绑定？`
      hint = `当前  ${displayBinding(config.roles[role])}\n选定  ${displayBinding(model)}`
      options = [{ label: '保存绑定', value: 'save' }, { label: '返回选模型', value: 'back' }]
      back = () => go({ kind: 'models', role, channel })
      choose = value => {
        if (value === 'back') return back()
        try {
          const saved = saveRoleBinding(role, model)
          setCatalog({ config: saved, preview: false })
          go({ kind: 'roles' })
          setNotice(`已保存 ${roleNames[role]} → ${displayBinding(model)}，下次调用该角色时生效。`)
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      }
      break
    }
  }

  return <Pane color="permission">
    <Box flexDirection="column" marginBottom={1}>
      <Text color="remember" bold>{title}</Text>
      <Text dimColor>{hint}</Text>
      {notice && <Text color="success">{notice}</Text>}
      {error && <Text color="error">{error}</Text>}
    </Box>
    <Select clickToSelect key={screen.kind === 'channels' && screen.addingModels ? 'add-models' : screen.kind}
      options={options} defaultFocusValue={focus} defaultValue={selected}
      visibleOptionCount={Math.max(2, Math.min(7, Math.floor((rows - 10) / (compact ? 2 : 1))))}
      layout={compact ? 'compact-vertical' : 'compact'} onChange={choose} onCancel={back} />
    <Box marginTop={1}><Text dimColor>↑↓ 移动 · Enter 选择 · Esc 返回</Text></Box>
  </Pane>
}
