import React, { useState } from 'react'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { Box, Text } from '../../ink.js'
import {
  channelSchema, findCredentialOriginConflict, updateModelChannelConnection,
  type CatalogConfig, type ChannelConnection, type ProviderKind,
} from '../../services/api/provider/catalog.js'
import { displayChannelName } from '../../services/api/provider/presets.js'
import { Select } from '../CustomSelect/index.js'
import { ChannelField, ModelChannelForm, protocolOptions } from '../ModelChannelForm.js'
import { ChannelCredentials, loadEditableCatalog } from './ChannelCredentials.js'
import { ChannelModelTest } from './ChannelModelTest.js'
import { ModelBudgetEditor, modelBudgetDetails } from './ModelBudgetEditor.js'

type Page = 'list' | 'channel' | 'new' | 'models' | 'registered' | 'modelDetail' | 'edit' | 'key' |
  'budget' | 'testPick' | 'test'
type EditStep = 'protocol' | 'url' | 'key' | 'confirm'
function protocolLabel(protocol: ProviderKind) {
  return protocolOptions.find(item => item.value === protocol)?.label ?? protocol
}

function EditConnection({ id, catalog, onClose }: { id: string; catalog: CatalogConfig; onClose: (message?: string) => void }) {
  const original = catalog.channels[id]!
  const [protocol, setProtocol] = useState(original.protocol)
  const [url, setUrl] = useState(original.baseURL)
  const [variable, setVariable] = useState(original.apiKeyEnv ?? '')
  const [step, setStep] = useState<EditStep>('protocol')
  const [error, setError] = useState('')
  const fields = [
    ['协议', protocolLabel(original.protocol), protocolLabel(protocol)],
    ['API 地址', original.baseURL, url],
    ['密钥变量', original.apiKeyEnv || '无需密钥', variable || '无需密钥'],
  ].filter(([, oldValue, newValue]) => oldValue !== newValue)
  function go(next: EditStep) { setError(''); setStep(next) }
  function back() {
    if (step === 'protocol') onClose()
    else go(step === 'confirm' ? 'key' : step === 'key' ? 'url' : 'protocol')
  }
  function acceptURL(value: string) {
    const result = channelSchema.shape.baseURL.safeParse(value.trim())
    if (!result.success) return setError('请填写有效的 HTTP(S) 地址，去掉用户名、密码、查询参数和片段。')
    setUrl(result.data)
    if (new URL(result.data).origin !== new URL(original.baseURL).origin && variable === original.apiKeyEnv) {
      setVariable('')
    }
    go('key')
  }
  function acceptVariable(value: string) {
    const input = value.trim()
    if ((!input && protocol === 'messages') || (input && !channelSchema.shape.apiKeyEnv.safeParse(input).success)) {
      return setError('请填写有效的密钥环境变量名，例如 WORK_API_KEY。')
    }
    const conflict = input && findCredentialOriginConflict(catalog, input, url)
    if (conflict) return setError(`此变量已用于 ${conflict.id}（${new URL(conflict.baseURL).origin}），请使用独立变量。`)
    setVariable(input)
    go('confirm')
  }
  function save() {
    const next: ChannelConnection = { protocol, baseURL: url, apiKeyEnv: variable || undefined }
    try {
      if (fields.length) updateModelChannelConnection(id, original, next)
      onClose(fields.length ? `已更新 ${id} 的连接。` : undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '未能保存渠道连接')
    }
  }
  return <Box flexDirection="column">
    <Text bold>编辑连接 · {id}</Text>
    {step === 'protocol' ? <>
      <Text>API 协议</Text>
      <Select clickToSelect options={protocolOptions} defaultFocusValue={protocol}
        onChange={(value: ProviderKind) => { setProtocol(value); go('url') }} onCancel={back} />
    </> : step === 'url' ? <>
      <Text>API 地址</Text>
      <Box key="url"><ChannelField initialValue={url} onChange={setUrl} onSubmit={acceptURL} onBack={back} /></Box>
    </> : step === 'key' ? <>
      <Text>密钥环境变量名 · {url}</Text>
      {new URL(url).origin !== new URL(original.baseURL).origin &&
        <Text color="warning">服务地址已更换，请为新地址使用独立的密钥变量。</Text>}
      {protocol === 'openai-compatible' && <Text dimColor>服务无需密钥时可留空。</Text>}
      <Box key="key"><ChannelField initialValue={variable} onChange={setVariable} onSubmit={acceptVariable} onBack={back} /></Box>
    </> : <>
      <Text bold>{fields.length ? '确认连接变更' : '没有变更'}</Text>
      {fields.map(([label, before, after]) => <Box key={label} flexDirection="column">
        <Text dimColor>{label}　原　{before}</Text><Text>{label}　新　{after}</Text>
      </Box>)}
      <Select clickToSelect options={[
        { value: 'save', label: fields.length ? '保存变更' : '返回渠道' },
        { value: 'back', label: '返回修改' }, { value: 'cancel', label: '取消编辑' },
      ]} onChange={(action: string) => action === 'save' ? save() : action === 'back' ? back() : onClose()} onCancel={back} />
    </>}
    {error && <Text color="error">{error}</Text>}
    {step !== 'confirm' && <Text dimColor>Enter 继续 · Esc 返回</Text>}
  </Box>
}

export function ModelChannels({ onClose }: { onClose: () => void }) {
  const [catalog, setCatalog] = useState(loadEditableCatalog)
  const [page, setPage] = useState<Page>('list')
  const [id, setId] = useState('')
  const [modelId, setModelId] = useState('')
  const [testBack, setTestBack] = useState<Page>('testPick')
  const [notice, setNotice] = useState('')
  const { rows, columns } = useTerminalSize()
  function reload(next: Page, message = '') {
    setCatalog(loadEditableCatalog())
    setNotice(message)
    setPage(next)
  }
  if (catalog instanceof Error) return <>
    <Text color="error">{catalog.message}</Text>
    <Select clickToSelect options={[{ value: 'retry', label: '重新读取' }, { value: 'exit', label: '返回' }]}
      onChange={(value: string) => value === 'retry' ? reload('list') : onClose()} onCancel={onClose} />
  </>
  const channel = catalog.channels[id]
  if (page === 'new' || (channel && page === 'models')) return <ModelChannelForm channelId={page === 'new' ? undefined : id}
    onCancel={() => reload(page === 'new' ? 'list' : 'channel')}
    onSave={(savedId, result) => { setId(savedId); reload('channel', result.message) }} />
  if (channel && page === 'edit') return <EditConnection id={id} catalog={catalog} onClose={message => reload('channel', message)} />
  if (channel && page === 'key') return <ChannelCredentials initialChannelId={id} onClose={message => reload('channel', message)} />
  const model = channel?.models.find(item => item.id === modelId)
  if (channel && model && page === 'budget') return <ModelBudgetEditor channelId={id} channel={channel} model={model}
    onClose={message => reload('modelDetail', message)} />
  if (channel && page === 'test') return <ChannelModelTest channelId={id} modelId={modelId}
    connection={channel} onClose={() => reload(testBack)} />
  if (channel && page === 'modelDetail') {
    const details = modelBudgetDetails(id, modelId)
    const source = { manual: '手动', channel: '渠道返回', official: '官方规格', fallback: '估算值' }[details.contextSource]
    return <Box flexDirection="column">
      <Text bold>{model?.name ?? modelId}</Text>
      <Text wrap="truncate-end">模型 ID　{modelId}</Text>
      <Text wrap="truncate-end">上下文窗口　{details.contextWindow.toLocaleString()} tokens · {source}</Text>
      <Text wrap="truncate-end">单次输出预算　{details.outputBudget.toLocaleString()} tokens · {model?.outputBudget === undefined ? '自动' : '手动'}</Text>
      {notice && <Text color="success" wrap="truncate-end">{notice}</Text>}
      <Select clickToSelect options={[
        ...(model ? [{ value: 'budget', label: '高级设置' }, { value: 'test', label: '测试对话' }] : []),
        { value: 'back', label: '返回模型列表' },
      ]} onChange={(value: string) => {
        if (value === 'test') {
          setTestBack('modelDetail')
          reload('test')
        } else reload(value === 'budget' ? 'budget' : 'registered')
      }} onCancel={() => reload('registered')} />
    </Box>
  }
  if (channel && (page === 'registered' || page === 'testPick')) return <Box flexDirection="column">
    <Text bold>{id} · {page === 'testPick' ? '选择模型测试对话' : '已配置的模型'}</Text>
    <Select clickToSelect options={[...channel.models.map(model => {
      const used = (['quark', 'atom', 'electron'] as const).filter(role => catalog.roles[role] === `${id}::${model.id}`)
      const description = [model.name && model.name !== model.id ? model.name : '',
        used.map(role => role[0]!.toUpperCase() + role.slice(1)).join('、')].filter(Boolean).join(' · ')
      return { value: `model:${model.id}`, label: model.id, description }
    }), { value: 'back', label: '返回渠道' }]}
      visibleOptionCount={Math.max(2, Math.min(8, rows - 4))}
      defaultFocusValue={modelId ? `model:${modelId}` : undefined} onChange={(value: string) => {
        if (value === 'back') return reload('channel')
        setModelId(value.slice('model:'.length))
        if (page === 'testPick') {
          setTestBack('testPick')
          reload('test')
        } else reload('modelDetail')
      }} onCancel={() => reload('channel')} />
    <Text dimColor>↑↓ 浏览 · Enter {page === 'testPick' ? '选择' : '查看详情'} · Esc 返回</Text>
  </Box>
  if (channel && page === 'channel') return <Box flexDirection="column">
    <Text bold>{displayChannelName(id, channel)}</Text>
    <Text wrap="truncate-end">{protocolLabel(channel.protocol)} · {channel.baseURL}</Text>
    <Text dimColor wrap="truncate-end">{credentialState(channel)} · {channel.models.length} 个模型</Text>
    {notice && <Text color="success" wrap="truncate-end">{notice}</Text>}
    <Select clickToSelect options={[
      { value: 'registered', label: '查看已配置的模型' },
      { value: 'models', label: '添加模型' },
      { value: 'key', label: '渠道密钥' }, { value: 'edit', label: '编辑连接' },
      { value: 'testPick', label: '测试对话' }, { value: 'list', label: '返回渠道列表' },
    ]} visibleOptionCount={Math.max(2, Math.min(6, rows - 5))}
      onChange={(value: Page) => reload(value)} onCancel={() => reload('list')} />
  </Box>
  const options = Object.keys(catalog.channels).map(name => {
    const item = catalog.channels[name]!
    return { value: name, label: displayChannelName(name, item), description: `${item.models.length} 个模型 · ${credentialState(item)}` }
  })
  return <Box flexDirection="column">
    <Text bold>模型渠道</Text>
    <Text dimColor>{options.length ? '选择渠道查看连接和模型。' : '添加第一个模型渠道。'}</Text>
    <Select clickToSelect options={[...options, { value: ':new', label: '＋ 新增渠道' }, { value: ':exit', label: '返回模型设置' }]}
      layout={columns < 65 ? 'compact-vertical' : 'compact'} defaultFocusValue={id || undefined}
      visibleOptionCount={Math.max(2, Math.min(8, Math.floor((rows - 4) / (columns < 65 ? 2 : 1))))}
      onChange={(value: string) => {
        if (value === ':exit') return onClose()
        if (value === ':new') return reload('new')
        setId(value)
        reload('channel')
      }} onCancel={onClose} />
  </Box>
}

function credentialState(channel: ChannelConnection): string {
  if (!channel.apiKeyEnv) return '无需密钥'
  return process.env[channel.apiKeyEnv]?.trim() ? '已配置密钥' : '需要密钥'
}
