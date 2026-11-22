import React, { useEffect, useState } from 'react'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { Box, Text, useInput } from '../ink.js'
import {
  addChannelModels, addModelChannel, channelIdSchema, channelSchema, findCredentialOriginConflict, getEditableModelCatalog,
  isUnconfiguredModelCatalog, saveDiscoveredChannelModel, saveRoleBinding,
  type CatalogConfig, type ChannelConnection, type ModelRole, type ProviderKind,
} from '../services/api/provider/catalog.js'
import { applyChannelCredential, getCredentialTarget, type CredentialScope } from '../services/api/provider/channelCredentials.js'
import { fetchChannelModels, requiresModelDirectoryScope, type ModelDirectoryEntry, type ModelDirectoryScope } from '../services/api/provider/listModels.js'
import { providerPresets, type ProviderPreset } from '../services/api/provider/presets.js'
import { isModelAllowed } from '../utils/model/modelAllowlist.js'
import { userSettingsEnvPath } from '../utils/settings/userSettingsEnv.js'
import { Select } from './CustomSelect/select.js'
import { FuzzyPicker } from './design-system/FuzzyPicker.js'
import { Pane } from './design-system/Pane.js'
import { loadEditableCatalog, SecretField } from './Settings/ChannelCredentials.js'
import TextInput from './TextInput.js'

type Step = 'preset' | 'id' | 'protocol' | 'url' | 'variable' | 'credential' | 'secret' | 'scope' | 'models' | 'confirm'
type ModelSource = 'choose' | 'directory' | 'directory-key' | 'read' | 'preset' | 'manual'
type SaveResult = { boundRole?: ModelRole; message: string }

export const protocolOptions: { value: ProviderKind; label: string }[] = [
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

function DiscoverModels({ connection, apiKey, directoryScope, existing, onPick, onManual, onRetry, onCredential, onBack }: React.Attributes & {
  connection: ChannelConnection
  apiKey?: string
  directoryScope?: ModelDirectoryScope
  existing: ReadonlySet<string>
  onPick: (model: ModelDirectoryEntry) => void
  onManual: () => void
  onRetry: () => void
  onCredential: () => void
  onBack: () => void
}) {
  const [result, setResult] = useState<ModelDirectoryEntry[] | string>()
  const [search, setSearch] = useState<string | undefined>()
  const { rows } = useTerminalSize()
  const { baseURL, protocol, apiKeyEnv } = connection
  useEffect(() => {
    const controller = new AbortController()
    void fetchChannelModels({ baseURL, protocol, apiKeyEnv }, controller.signal, apiKey, directoryScope)
      .then(models => { if (!controller.signal.aborted) setResult(models) })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setResult(cause instanceof Error ? cause.message : '读取失败')
      })
    return () => controller.abort()
  }, [baseURL, protocol, apiKeyEnv, apiKey, directoryScope])
  const candidates = Array.isArray(result)
    ? result.filter(model => !existing.has(model.id) || model.contextWindow !== undefined || model.maxOutputTokens !== undefined)
    : []
  if (search !== undefined) {
    return <FuzzyPicker title="搜索模型" placeholder="输入模型 ID" items={candidates.filter(model =>
      model.id.toLowerCase().includes(search.trim().toLowerCase()))} getKey={model => model.id}
      renderItem={model => <Text wrap="truncate-end">{model.id}</Text>}
      emptyMessage="没有匹配的模型" onQueryChange={setSearch} onSelect={onPick}
      selectAction="选择" onCancel={() => setSearch(undefined)} />
  }
  const options = candidates.map(model => ({
    label: model.id, value: `model:${model.id}`,
    description: [existing.has(model.id) ? '已添加' : '',
      model.contextWindow === undefined ? '' : `上下文 ${model.contextWindow.toLocaleString()}`,
      model.maxOutputTokens === undefined ? '' : `输出 ${model.maxOutputTokens.toLocaleString()}`,
    ].filter(Boolean).join(' · '),
  }))
  return <>
    <Text color={typeof result === 'string' ? 'warning' : undefined} wrap="truncate-end">{result === undefined ? '正在读取渠道模型…'
      : typeof result === 'string' ? result
      : candidates.length ? '已读取模型列表。选择要添加或更新的模型。' : '渠道没有返回可新增或可更新的模型。'}</Text>
    <Select key={result === undefined ? 'loading' : 'result'} clickToSelect options={[
      ...options,
      ...(candidates.length ? [{ value: 'search', label: '搜索模型' }] : []),
      { value: 'manual', label: '手工输入模型 ID' },
      ...(result === undefined ? [] : [{ value: 'retry', label: '重新读取模型列表' }]),
      ...(typeof result === 'string' && /401|403|鉴权|密钥/u.test(result) && apiKeyEnv
        ? [{ value: 'credential', label: '更换密钥' }] : []),
      { value: 'back', label: '返回添加方式' },
    ]} visibleOptionCount={Math.max(1, Math.min(6, rows - 5))} onCancel={onBack} onChange={(value: string) => {
      if (value === 'search') setSearch('')
      else if (value === 'manual') onManual()
      else if (value === 'retry') onRetry()
      else if (value === 'credential') onCredential()
      else if (value === 'back') onBack()
      else {
        const model = candidates.find(item => `model:${item.id}` === value)
        if (model) onPick(model)
      }
    }} />
  </>
}

function availablePresetId(preset: ProviderPreset, config: CatalogConfig, initialize: boolean): string {
  if (initialize || !Object.hasOwn(config.channels, preset.id)) return preset.id
  let suffix = 2
  while (Object.hasOwn(config.channels, `${preset.id}-${suffix}`)) suffix++
  return `${preset.id}-${suffix}`
}

export function ModelChannelForm({ channelId, bindRole, onSave, onCancel }: {
  channelId?: string
  bindRole?: ModelRole
  onSave: (id: string, result: SaveResult) => void
  onCancel: () => void
}) {
  const [step, setStep] = useState<Step>(channelId ? 'models' : 'preset')
  const [draft, setDraft] = useState({ id: channelId ?? '', url: '', key: '', models: '' })
  const [protocol, setProtocol] = useState<ProviderKind>('openai-compatible')
  const [preset, setPreset] = useState<ProviderPreset>()
  const [catalog, reloadCatalog] = useState(loadEditableCatalog)
  const [error, setError] = useState('')
  const [source, setSource] = useState<ModelSource>('choose')
  const [secret, setSecret] = useState('')
  const [scope, setScope] = useState<CredentialScope>('session')
  const [discoveryAttempt, setDiscoveryAttempt] = useState(0)
  const [directoryScope, setDirectoryScope] = useState<ModelDirectoryScope>()
  const [directoryModel, setDirectoryModel] = useState<ModelDirectoryEntry>()
  const { rows } = useTerminalSize()

  if (catalog instanceof Error) return <Pane color="permission">
    <Text color="error">{catalog.message}</Text>
    <Select clickToSelect options={[{ value: 'retry', label: '重新读取' }, { value: 'cancel', label: '返回' }]}
      onChange={(value: string) => value === 'retry' ? reloadCatalog(loadEditableCatalog()) : onCancel()} onCancel={onCancel} />
  </Pane>

  const current = (channelId && catalog.channels[channelId]) || undefined
  const connection = current ?? { protocol, baseURL: draft.url, apiKeyEnv: draft.key || undefined }
  const initialize = !channelId && isUnconfiguredModelCatalog(catalog)
  const ids = source === 'read' || source === 'preset' ? [draft.models] : modelIdsFrom(draft.models)
  const selected = source === 'read' ? directoryModel : undefined
  const roleName = bindRole && bindRole[0]!.toUpperCase() + bindRole.slice(1)
  const availableVariable = connection.apiKeyEnv && process.env[connection.apiKeyEnv]?.trim()

  function go(next: Step) { setError(''); setStep(next) }
  function chooseSource(next: ModelSource) { setError(''); setSource(next) }
  function resetSecret() { setSecret(''); setScope('session') }

  function pickPreset(value: string) {
    if (preset?.id === value) return go('credential')
    if (value === 'custom' && !preset && draft.id) return go('id')
    const found = providerPresets.find(item => item.id === value)
    setPreset(found)
    resetSecret()
    setDirectoryScope(undefined)
    setSource('choose')
    if (!found) {
      if (preset) {
        setDraft({ id: '', url: '', key: '', models: '' })
        setProtocol('openai-compatible')
      }
      go('id')
      return
    }
    const id = availablePresetId(found, catalog as CatalogConfig, initialize)
    const key = id === found.id ? found.apiKeyEnv : defaultKeyVariable(id)
    setDraft({ id, url: found.baseURL, key, models: '' })
    setProtocol(found.protocol)
    go('credential')
  }

  function back() {
    if (step === 'models' && source !== 'choose') return chooseSource('choose')
    if (step === 'preset' || (channelId && step === 'models')) return onCancel()
    switch (step) {
      case 'id': return go('preset')
      case 'protocol': return go('id')
      case 'url': return go('protocol')
      case 'variable': return go(preset ? 'credential' : 'url')
      case 'credential': return go(preset ? 'preset' : 'variable')
      case 'secret': return go('credential')
      case 'scope': return go('secret')
      case 'models': return go('credential')
      case 'confirm':
        if (source === 'read') chooseSource('choose')
        return go('models')
    }
  }

  function checkConnection() {
    const latest = getEditableModelCatalog()
    if (channelId) {
      const known = latest.channels[channelId]
      if (!known || known.baseURL !== connection.baseURL ||
          known.protocol !== connection.protocol || known.apiKeyEnv !== connection.apiKeyEnv) {
        throw new Error('渠道连接已变更，请重新打开。')
      }
    }
    if (connection.apiKeyEnv && findCredentialOriginConflict(latest, connection.apiKeyEnv, connection.baseURL)) {
      throw new Error(`${connection.apiKeyEnv} 已用于其他服务地址，请使用独立变量。`)
    }
  }

  function readModels(key?: string, nextScope = directoryScope) {
    try { checkConnection() }
    catch (cause) { return setError(cause instanceof Error ? cause.message : '无法读取渠道配置') }
    setDirectoryScope(nextScope)
    if (key !== undefined) {
      setSecret(key)
      setScope('session')
    }
    if (connection.apiKeyEnv && !(key ?? secret) && !availableVariable) {
      if (channelId) chooseSource('directory-key')
      else {
        go('credential')
        setError('请先设置本渠道的 API 密钥。')
      }
      return
    }
    setDiscoveryAttempt(previous => previous + 1)
    chooseSource('read')
  }

  function startDiscovery() {
    if (requiresModelDirectoryScope(connection)) {
      setDirectoryScope(undefined)
      chooseSource('directory')
    } else readModels()
  }

  function acceptField(value: string) {
    const entered = value.trim()
    if (step === 'id') {
      if (!channelIdSchema.safeParse(entered).success) return setError('请输入有效的渠道名称，以字母或数字开头。')
      if (Object.hasOwn((catalog as CatalogConfig).channels, entered)) return setError('此渠道已存在。')
      setDraft(previous => ({ ...previous, id: entered, key: previous.key || defaultKeyVariable(entered) }))
      return go('protocol')
    }
    if (step === 'url') {
      if (!channelSchema.shape.baseURL.safeParse(entered).success) return setError('请填写 API 根地址，去掉用户名、密码、查询参数和片段。')
      if (/(?:\/chat\/completions|\/messages|\/responses)\/?$/i.test(new URL(entered).pathname)) {
        return setError('请填写接口根地址，例如 https://example.com/v1。')
      }
      if (entered !== draft.url) resetSecret()
      setDraft(previous => ({ ...previous, url: entered }))
      return go('variable')
    }
    if (step === 'variable') {
      if ((!entered && protocol === 'messages') ||
          (entered && !channelSchema.shape.apiKeyEnv.safeParse(entered).success)) {
        return setError('请输入有效的密钥变量，例如 WORK_API_KEY。')
      }
      if (entered) {
        const conflict = findCredentialOriginConflict(catalog as CatalogConfig, entered, draft.url)
        if (conflict) return setError(`此变量已用于 ${conflict.id}，请使用独立变量。`)
      }
      if (entered !== draft.key) resetSecret()
      setDraft(previous => ({ ...previous, key: entered }))
      return go('credential')
    }
    const nextIds = modelIdsFrom(entered)
    if (!nextIds.length || !channelSchema.shape.models.safeParse(nextIds.map(id => ({ id }))).success) {
      return setError('请至少填写一个有效的模型 ID。')
    }
    if (new Set(nextIds).size !== nextIds.length) return setError('输入中有重复的模型 ID。')
    if (current && nextIds.some(id => current.models.some(model => model.id === id))) {
      return setError('该渠道已包含输入的模型，请仅填写新增的 ID。')
    }
    setDraft(previous => ({ ...previous, models: entered }))
    go('confirm')
  }

  function save(bind: boolean) {
    const qualified = `${draft.id}::${ids[0]}`
    try {
      checkConnection()
      if (channelId && selected) saveDiscoveredChannelModel(channelId, connection, selected)
      else if (channelId) addChannelModels(channelId, ids)
      else addModelChannel(draft.id, {
        ...connection,
        models: ids.map(id => ({
          id, discoveredContextWindow: selected?.contextWindow, discoveredMaxOutputTokens: selected?.maxOutputTokens,
        })),
      }, { initializeRoles: initialize })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。')
      return
    }
    let message = channelId ? '已保存模型。' : '已保存新渠道。'
    let boundRole: ModelRole | undefined
    try {
      if (secret && connection.apiKeyEnv) {
        applyChannelCredential(getCredentialTarget(getEditableModelCatalog(), draft.id), secret, scope)
      }
    } catch (cause) {
      onSave(draft.id, { message: `${message} 密钥保存失败，可在渠道页重试。${cause instanceof Error ? cause.message : ''}` })
      return
    }
    if (bind && bindRole) {
      try {
        if (!isModelAllowed(qualified)) throw new Error('该模型受模型使用策略限制。')
        saveRoleBinding(bindRole, qualified)
        message = `已将 ${roleName} 绑定到 ${draft.id} / ${ids[0]}。`
        boundRole = bindRole
      } catch (cause) {
        message += ` 角色绑定未保存。${cause instanceof Error ? cause.message : ''}`
      }
    }
    onSave(draft.id, { message, boundRole })
  }

  function selectModel(model: ModelDirectoryEntry) {
    setDirectoryModel(model)
    setDraft(previous => ({ ...previous, models: model.id }))
    go('confirm')
  }

  const count = Math.max(1, Math.min(8, rows - 6))
  let content: React.ReactNode
  switch (step) {
    case 'preset':
      content = <>
        <Text bold>添加渠道 · 选择厂商</Text>
        <Select clickToSelect options={[
          ...providerPresets.map(item => ({ value: item.id, label: item.label })),
          { value: 'custom', label: '自定义渠道' },
        ]} defaultFocusValue={preset?.id} visibleOptionCount={count} onChange={pickPreset} onCancel={back} />
      </>
      break
    case 'protocol':
      content = <>
        <Text bold>自定义渠道 · API 协议</Text>
        <Select clickToSelect options={protocolOptions} defaultFocusValue={protocol} onCancel={back}
          onChange={(value: ProviderKind) => { setProtocol(value); go('url') }} />
      </>
      break
    case 'credential':
      content = <>
        <Text bold>{preset?.label ?? draft.id} · API 密钥</Text>
        <Text wrap="truncate-end">{connection.baseURL}</Text>
        <Text dimColor>{protocolOptions.find(option => option.value === protocol)?.label} · {connection.apiKeyEnv || '无需密钥'}</Text>
        <Select clickToSelect options={[
          ...(secret ? [{ value: 'continue', label: '继续使用已输入的密钥' }] : []),
          ...(availableVariable ? [{ value: 'existing', label: '使用已有密钥' }] : []),
          ...(connection.apiKeyEnv ? [{ value: 'secret', label: '输入 API 密钥' }] : []),
          { value: 'defer', label: connection.apiKeyEnv ? '稍后设置密钥' : '无需密钥，继续' },
          { value: 'variable', label: '修改密钥变量' },
        ]} onChange={(value: string) => {
          if (value === 'continue') return go('models')
          resetSecret()
          go(value === 'existing' || value === 'defer' ? 'models' : value === 'secret' ? 'secret' : 'variable')
        }} onCancel={back} />
      </>
      break
    case 'secret':
      content = <>
        <Text wrap="truncate-end">目的地址　{connection.baseURL}</Text>
        <SecretField onSubmit={value => { setSecret(value); go('scope') }} onBack={back} />
      </>
      break
    case 'scope':
      content = <>
        <Text bold>密钥使用范围</Text>
        <Text dimColor wrap="truncate-end">本机保存位置　{userSettingsEnvPath()}（明文）</Text>
        <Select clickToSelect options={[
          { value: 'session', label: '仅用于本次运行' },
          { value: 'user', label: '保存到本机用户配置' },
        ]} defaultFocusValue={scope} onChange={(value: CredentialScope) => { setScope(value); go('models') }} onCancel={back} />
      </>
      break
    case 'confirm':
      content = <>
        <Text bold>确认保存</Text>
        <Text wrap="truncate-end">{draft.id} · {connection.baseURL}</Text>
        <Text wrap="truncate-end">模型　{ids.join('、')}</Text>
        {selected?.contextWindow !== undefined && <Text>渠道上下文　{selected.contextWindow.toLocaleString()} tokens</Text>}
        {selected?.maxOutputTokens !== undefined && <Text>渠道输出上限　{selected.maxOutputTokens.toLocaleString()} tokens</Text>}
        {initialize && <Text dimColor>将首个模型用于三个角色。之后可分别调整。</Text>}
        {secret && <Text dimColor>{scope === 'user' ? '保存密钥到本机用户配置' : '密钥仅本次运行生效'}</Text>}
        <Select clickToSelect options={[
          ...(bindRole && !initialize ? [{ value: 'bind', label: `保存并绑定 ${roleName}` }] : []),
          { value: 'save', label: channelId ? '保存模型' : '保存渠道' },
          { value: 'back', label: '返回修改' },
        ]} onChange={(value: string) => value === 'back' ? back() : save(value === 'bind')} onCancel={back} />
      </>
      break
    case 'models':
      switch (source) {
        case 'choose':
          content = <>
            <Text bold>{channelId ? `添加模型 · ${channelId}` : '选择模型'}</Text>
            <Text dimColor wrap="truncate-end">{connection.baseURL}</Text>
            <Select clickToSelect options={[
              { value: 'read', label: '从渠道读取模型列表' },
              { value: 'manual', label: '手工输入模型 ID' },
              ...(preset?.models.length ? [{ value: 'preset', label: '选择预设模型' }] : []),
            ]} onChange={(value: 'read' | 'manual' | 'preset') =>
              value === 'read' ? startDiscovery() : chooseSource(value)} onCancel={back} />
          </>
          break
        case 'directory':
          content = <>
            <Text>选择此 GLM 渠道的密钥类型</Text>
            <Select clickToSelect options={[
              { value: 'glm-api', label: '按量付费 API' }, { value: 'glm-coding-plan', label: 'Coding Plan 套餐' },
              { value: 'manual', label: '手工输入模型 ID' },
            ]} onCancel={back} onChange={(value: ModelDirectoryScope | 'manual') =>
              value === 'manual' ? chooseSource('manual') : readModels(undefined, value)} />
          </>
          break
        case 'directory-key':
          content = <>
            <Text wrap="truncate-end">目的地址　{connection.baseURL}</Text>
            <Text dimColor>本次密钥仅在保存模型后用于本次运行。</Text>
            <SecretField onSubmit={readModels} onBack={back} />
          </>
          break
        case 'read':
          content = <DiscoverModels key={discoveryAttempt} connection={connection} apiKey={secret || undefined}
            directoryScope={directoryScope} existing={new Set(current?.models.map(model => model.id))}
            onPick={selectModel} onManual={() => chooseSource('manual')} onRetry={() => readModels()}
            onCredential={() => channelId ? chooseSource('directory-key') : go('credential')} onBack={back} />
          break
        case 'preset':
          content = <>
            <Text dimColor>预设模型的可用性取决于账号，可用「测试对话」验证。</Text>
            <Select clickToSelect options={(preset?.models ?? []).map(id => ({ value: id, label: id }))}
              onChange={id => selectModel({ id })} onCancel={back} />
          </>
          break
        case 'manual':
          content = <Field title="手工输入模型 ID" hint="填写渠道要求的原始 ID。多个 ID 用逗号分隔。"
            value={draft.models} onChange={models => setDraft(previous => ({ ...previous, models }))}
            onSubmit={acceptField} onBack={back} />
          break
      }
      break
    default: {
      const field = step === 'id' ? 'id' : step === 'url' ? 'url' : 'key'
      const titles = { id: '渠道名称', url: 'API 根地址', key: '密钥环境变量名' }
      const hint = field === 'id' ? '以字母或数字开头，例如 company。'
        : field === 'url' ? '保留渠道提供的路径前缀，例如 /v1。'
        : protocol === 'messages' ? '用于此渠道，例如 WORK_API_KEY。' : '无需密钥的本地服务可以留空。'
      content = <Box key={field} flexDirection="column">
        <Field title={titles[field]} hint={hint} value={draft[field]} onChange={value => {
          if (field === 'url' || field === 'key') resetSecret()
          setDraft(previous => ({ ...previous, [field]: value }))
        }} onSubmit={acceptField} onBack={back} />
      </Box>
    }
  }
  return <Pane color="permission">
    <Box flexDirection="column">
      {content}
      {error && <Text color="error">{error}</Text>}
      {step !== 'secret' && (step !== 'models' || source !== 'directory-key') &&
        <Text dimColor wrap="truncate-end">Enter 确认 · Esc 返回</Text>}
    </Box>
  </Pane>
}

function defaultKeyVariable(id: string): string {
  return id.toUpperCase().replace(/[^A-Z0-9_]/g, '_').replace(/^(?=\d)/, '_') + '_API_KEY'
}

function Field({ title, hint, value, onChange, onSubmit, onBack }: {
  title: string; hint: string; value: string
  onChange: (value: string) => void; onSubmit: (value: string) => void; onBack: () => void
}) {
  return <>
    <Text bold>{title}</Text>
    <Text dimColor wrap="truncate-end">{hint}</Text>
    <ChannelField initialValue={value} onChange={onChange} onSubmit={onSubmit} onBack={onBack} />
  </>
}
