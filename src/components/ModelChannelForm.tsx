import React, { useEffect, useState } from 'react'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { Box, Text, useInput } from '../ink.js'
import {
  addChannelModels, addModelChannel, channelIdSchema, channelSchema,
  getEditableModelCatalog, type ModelChannel, type ProviderKind,
} from '../services/api/provider/catalog.js'
import { fetchChannelModelIds, requiresModelDirectoryScope, type ModelDirectoryScope } from '../services/api/provider/listModels.js'
import { findCredentialOriginConflict } from '../services/api/provider/channelCredentials.js'
import { Select } from './CustomSelect/select.js'
import { Pane } from './design-system/Pane.js'
import { loadEditableCatalog, SecretField } from './Settings/ChannelCredentials.js'
import TextInput from './TextInput.js'

type ModelConnection = Pick<ModelChannel, 'protocol' | 'baseURL' | 'apiKeyEnv'>

type Step = 'id' | 'protocol' | 'url' | 'key' | 'models' | 'confirm'
const steps: Step[] = ['id', 'protocol', 'url', 'key', 'models', 'confirm']
export const protocolOptions = [
  { value: 'openai-compatible', label: 'OpenAI 兼容 · Chat Completions' },
  { value: 'messages', label: 'Messages 兼容接口' },
]
const modelIdsFrom = (input: string) => input.split(/[,，]/u).map(id => id.trim()).filter(Boolean)

export function ChannelField({ initialValue, onChange, onSubmit, onBack }: {
  initialValue: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  onBack: () => void
}) {
  const [offset, setOffset] = useState(initialValue.length)
  const { columns } = useTerminalSize()
  useInput((_input, key, event) => {
    if (key.escape) {
      event.stopImmediatePropagation()
      onBack()
    }
  })
  return <TextInput value={initialValue} onChange={onChange} onSubmit={onSubmit}
    onExit={onBack} focus showCursor multiline={false} disableEscapeDoublePress
    columns={Math.max(1, columns - 6)} cursorOffset={offset} onChangeCursorOffset={setOffset} />
}

function DiscoverModels({ connection, apiKey, directoryScope, existing, onPick, onManual, onRetry, onBack }: React.Attributes & {
  connection: ModelConnection
  apiKey?: string
  directoryScope?: ModelDirectoryScope
  existing: ReadonlySet<string>
  onPick: (id: string) => void
  onManual: () => void
  onRetry: () => void
  onBack: () => void
}) {
  const [result, setResult] = useState<string[] | string>()
  const { baseURL, protocol, apiKeyEnv } = connection
  useEffect(() => {
    const controller = new AbortController()
    void fetchChannelModelIds({ baseURL, protocol, apiKeyEnv }, controller.signal, apiKey, directoryScope)
      .then(ids => { if (!controller.signal.aborted) setResult(ids) })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setResult(cause instanceof Error ? cause.message : '读取失败')
      })
    return () => controller.abort()
  }, [baseURL, protocol, apiKeyEnv, apiKey, directoryScope])
  const options = Array.isArray(result)
    ? result.filter(id => !existing.has(id)).map(id => ({ label: id, value: `model:${id}` }))
    : []
  return <>
    <Text color={typeof result === 'string' ? 'warning' : undefined}>{result === undefined ? '正在读取渠道模型…' : typeof result === 'string' ? result
      : options.length ? '选择要添加的模型' : '渠道没有返回可新增的模型。'}</Text>
    <Select key={result === undefined ? 'loading' : 'result'} clickToSelect options={[
      ...options,
      { value: 'manual', label: '手工输入模型 ID' },
      ...(result !== undefined && options.length === 0 ? [{ value: 'retry', label: '重新读取模型列表' }] : []),
      { value: 'back', label: '返回添加方式' },
    ]} visibleOptionCount={6} onCancel={onBack} onChange={(value: string) => {
      if (value === 'manual') onManual()
      else if (value === 'retry') onRetry()
      else if (value === 'back') onBack()
      else onPick(value.slice('model:'.length))
    }} />
  </>
}

export function ModelChannelForm({ channelId, onSave, onCancel }: {
  channelId?: string
  onSave: (id: string) => void
  onCancel: () => void
}) {
  const [step, setStep] = useState<Step>(channelId ? 'models' : 'id')
  const [draft, setDraft] = useState({ id: channelId ?? '', url: '', key: '', models: '' })
  const [protocol, setProtocol] = useState<ProviderKind>('openai-compatible')
  const [error, setError] = useState('')
  const [catalog, reloadCatalog] = useState(loadEditableCatalog)
  const [source, setSource] = useState<'choose' | 'directory' | 'secret' | 'read' | 'manual'>('choose')
  const [discoveryKey, setDiscoveryKey] = useState('')
  const [discoveryAttempt, setDiscoveryAttempt] = useState(0)
  const [directoryScope, setDirectoryScope] = useState<ModelDirectoryScope>()
  if (catalog instanceof Error) return <Pane color="permission">
    <Text color="error">{catalog.message}</Text>
    <Select clickToSelect options={[{ value: 'retry', label: '重新读取' }, { value: 'cancel', label: '返回' }]}
      onChange={(value: string) => value === 'retry' ? reloadCatalog(loadEditableCatalog()) : onCancel()} onCancel={onCancel} />
  </Pane>
  const ids = source === 'read' ? [draft.models] : modelIdsFrom(draft.models)
  const hasFirstChannel = Object.keys(catalog.channels).length > 0
  const connection = (channelId && catalog.channels[channelId]) ||
    { protocol, baseURL: draft.url, apiKeyEnv: draft.key || undefined }
  const fields = {
    id: ['渠道名称', '用英文、数字、点、短横线或下划线命名，例如 work。'],
    url: ['API 地址', '填写服务商提供的接口根地址，保留路径前缀。'],
    key: ['密钥环境变量名', protocol === 'messages'
      ? '填写存放此渠道密钥的变量名，例如 WORK_API_KEY。'
      : '填写变量名，例如 WORK_API_KEY。服务无需密钥时可留空。'],
    models: ['模型 ID', '填写服务商提供的完整模型 ID，多个 ID 用逗号分隔。'],
  } as const

  function go(next: Step) {
    setError('')
    setStep(next)
  }
  function back() {
    if (step === 'models' && source !== 'choose') { setSource('choose'); setError('') }
    else if (step === 'id' || (channelId && step === 'models')) onCancel()
    else {
      if (step === 'confirm' && source === 'read') setSource('choose')
      if (step !== 'confirm') setDiscoveryKey('')
      go(steps[steps.indexOf(step) - 1]!)
    }
  }
  function checkConnection() {
    const variable = connection.apiKeyEnv
    const current = getEditableModelCatalog()
    if (channelId && (current.channels[channelId]?.baseURL !== connection.baseURL ||
        current.channels[channelId]?.protocol !== connection.protocol || current.channels[channelId]?.apiKeyEnv !== variable)) {
      throw new Error('渠道连接已变更，请返回渠道列表重新打开。')
    }
    if (variable && findCredentialOriginConflict(current, variable, connection.baseURL)) {
      throw new Error(`${variable} 正用于其他服务地址，请使用独立的密钥变量。`)
    }
  }
  function readModels(key?: string, scope = directoryScope) {
    try {
      checkConnection()
    } catch (cause) {
      return setError(cause instanceof Error ? cause.message : '无法读取最新渠道配置')
    }
    setError('')
    setDirectoryScope(scope)
    const variable = connection.apiKeyEnv
    if (variable && !(key ?? discoveryKey) && !process.env[variable]?.trim()) {
      setSource('secret')
      return
    }
    if (key !== undefined) setDiscoveryKey(key)
    setDiscoveryAttempt(previous => previous + 1)
    setSource('read')
  }
  function startDiscovery() {
    if (requiresModelDirectoryScope(connection)) {
      setDirectoryScope(undefined)
      setSource('directory')
    } else {
      readModels()
    }
  }
  function submit(value: string) {
    const input = value.trim()
    if (step === 'id') {
      if (!channelIdSchema.safeParse(input).success) return setError('请输入有效的渠道名称，以字母或数字开头。')
      if (Object.hasOwn(catalog.channels, input)) return setError('该渠道已存在，可从渠道列表进入并添加模型。')
    }
    if (step === 'url' && !channelSchema.shape.baseURL.safeParse(input).success) {
      return setError('请填写 HTTP(S) 地址，去掉用户名、密码、查询参数和片段。')
    }
    if (step === 'key' && (!input && protocol === 'messages' ||
        input && !channelSchema.shape.apiKeyEnv.safeParse(input).success)) {
      return setError('请填写环境变量名，例如 WORK_API_KEY。')
    }
    if (step === 'key' && input) {
      const conflict = findCredentialOriginConflict(catalog, input, draft.url)
      if (conflict) return setError(`${input} 已用于 ${conflict.id}（${new URL(conflict.baseURL).origin}）。请为新地址指定独立变量。`)
    }
    if (step === 'models') {
      const ids = modelIdsFrom(input)
      if (!ids.length) return setError('请至少输入一个模型 ID。')
      if (!channelSchema.shape.models.safeParse(ids.map(id => ({ id }))).success) return setError('请输入单行的模型 ID。')
      if (new Set(ids).size !== ids.length) return setError('输入中有重复的模型 ID。')
      const existing = catalog.channels[draft.id]?.models ?? []
      if (ids.some(id => existing.some(model => model.id === id))) return setError('该渠道已包含输入的模型，请仅填写新增的 ID。')
    }
    setDraft(previous => ({ ...previous, [step]: input }))
    go(steps[steps.indexOf(step) + 1]!)
  }
  function save() {
    try {
      checkConnection()
      if (channelId) addChannelModels(channelId, ids)
      else addModelChannel(draft.id, {
        protocol, baseURL: draft.url,
        ...(draft.key ? { apiKeyEnv: draft.key } : {}),
        models: ids.map(id => ({ id })),
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。')
      return
    }
    if (discoveryKey && connection.apiKeyEnv) process.env[connection.apiKeyEnv] = discoveryKey
    onSave(draft.id)
  }

  return <Pane color="permission">
    <Box flexDirection="column" gap={1}>
      <Text bold>{channelId ? `添加模型 · ${channelId}` : '新增渠道'}</Text>
      {step === 'protocol' ? <>
        <Text>选择 {draft.id} 的 API 协议</Text>
        <Select clickToSelect options={protocolOptions} defaultFocusValue={protocol} onCancel={back}
          onChange={(value: ProviderKind) => {
            setProtocol(value)
            setDraft(previous => ({ ...previous, key: previous.key || previous.id.toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/^(?=\d)/, '_') + '_API_KEY' }))
            go('url')
          }} />
      </> : step === 'confirm' ? <>
        <Box flexDirection="column">
          <Text bold>{draft.id}</Text>
          {!channelId && <>
            <Text>{protocolOptions.find(item => item.value === protocol)?.label}</Text>
            <Text>{draft.url}</Text>
            <Text>凭据　{draft.key || '无需密钥'}</Text>
            {Boolean(draft.key) && !discoveryKey && !process.env[draft.key]?.trim() &&
              <Text color="warning">当前终端未设置 {draft.key}。保存渠道后可在设置中心的「渠道密钥」填写。</Text>}
          </>}
          {discoveryKey ? <Text>输入的密钥将用于本次运行。需要长期保存时可在「渠道密钥」设置。</Text> : null}
          <Text>模型　{ids.join('、')}</Text>
          {!hasFirstChannel && <Text>三个角色将先使用首个模型，保存后可分别选择。</Text>}
        </Box>
        <Select clickToSelect options={[{ value: 'save', label: channelId ? '保存新增模型' : '保存渠道' }, { value: 'back', label: '返回修改' }]}
          onChange={(value: string) => value === 'save' ? save() : back()} onCancel={back} />
      </> : step === 'models' && source === 'choose' ? <>
        <Text>添加模型到 {draft.id}</Text>
        <Text dimColor>{connection.baseURL}</Text>
        <Select clickToSelect options={[{ value: 'read', label: '从渠道读取模型列表' }, { value: 'manual', label: '手工输入模型 ID' }]}
          onChange={(value: 'read' | 'manual') => { setError(''); if (value === 'read') startDiscovery(); else setSource('manual') }} onCancel={back} />
      </> : step === 'models' && source === 'directory' ? <>
        <Text>选择此 GLM 渠道使用的密钥类型</Text>
        <Select clickToSelect options={[
          { value: 'glm-api', label: '按量付费 API' },
          { value: 'glm-coding-plan', label: 'Coding Plan 套餐' },
          { value: 'manual', label: '手工输入模型 ID' },
        ]} onCancel={back} onChange={(value: ModelDirectoryScope | 'manual') => {
          if (value === 'manual') { setError(''); setSource('manual') }
          else readModels(undefined, value)
        }} />
      </> : step === 'models' && source === 'secret' ? <>
        <Text>{connection.baseURL}</Text>
        <Text dimColor>回车使用新密钥向此地址读取模型。保存后可在本次运行使用。</Text>
        <SecretField onBack={back} onSubmit={readModels} />
      </> : step === 'models' && source === 'read' ? <DiscoverModels key={discoveryAttempt}
        connection={connection} apiKey={discoveryKey || undefined} directoryScope={directoryScope}
        existing={new Set(catalog.channels[draft.id]?.models.map(model => model.id))}
        onManual={() => { setError(''); setSource('manual') }} onRetry={() => readModels()}
        onBack={back} onPick={id => { setDraft(previous => ({ ...previous, models: id })); go('confirm') }} /> : <>
        <Box flexDirection="column"><Text bold>{fields[step][0]}</Text><Text dimColor>{fields[step][1]}</Text></Box>
        <Box key={step}><ChannelField initialValue={draft[step]} onBack={back} onSubmit={submit}
          onChange={value => { setError(''); setDraft(previous => ({ ...previous, [step]: value })) }} /></Box>
      </>}
      {error ? <Text color="error">{error}</Text> : null}
      <Text dimColor>{step === 'protocol' || step === 'confirm' ? '↑↓ 选择 · ' : ''}Enter 确认 · Esc 返回</Text>
    </Box>
  </Pane>
}
