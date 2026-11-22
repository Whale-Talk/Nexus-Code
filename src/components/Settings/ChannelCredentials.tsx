import React, { useState } from 'react'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { Box, Text, useInput } from '../../ink.js'
import { getEditableModelCatalog, type CatalogConfig } from '../../services/api/provider/catalog.js'
import {
  applyChannelCredential, getCredentialTarget, type CredentialScope, type CredentialTarget,
} from '../../services/api/provider/channelCredentials.js'
import { userSettingsEnvPath } from '../../utils/settings/userSettingsEnv.js'
import { Select } from '../CustomSelect/index.js'
import TextInput from '../TextInput.js'

export function loadEditableCatalog(): CatalogConfig | Error {
  try { return getEditableModelCatalog() } catch (error) {
    return error instanceof Error ? error : new Error('无法读取用户渠道配置')
  }
}

export function SecretField({ onSubmit, onBack }: { onSubmit: (value: string) => void; onBack: () => void }) {
  const [secret, setSecret] = useState('')
  const [offset, setOffset] = useState(0)
  const [error, setError] = useState('')
  const { columns } = useTerminalSize()
  useInput((_input, key, event) => {
    if (key.escape) {
      event.stopImmediatePropagation()
      onBack()
    }
  })
  return <>
    <Text bold>输入新密钥</Text>
    <TextInput value={secret} onChange={value => { setSecret(value); setError('') }} onSubmit={value => {
      if (!value.trim() || /[^\x21-\x7e]/.test(value.trim())) setError('请输入有效的单行 API 密钥')
      else onSubmit(value.trim())
    }} onExit={onBack} focus showCursor mask="*" showMaskedSuffix={false} disableEscapeDoublePress
      multiline={false} columns={Math.max(1, columns - 4)} cursorOffset={offset} onChangeCursorOffset={setOffset} />
    {error && <Text color="error">{error}</Text>}
    <Text dimColor>Enter 继续 · Esc 取消</Text>
  </>
}

export function ChannelCredentials({ onClose, initialChannelId }: { onClose: (notice?: string) => void; initialChannelId?: string }) {
  const [catalog, setCatalog] = useState(loadEditableCatalog)
  const [target, setTarget] = useState<CredentialTarget | undefined>(() =>
    initialChannelId && !(catalog instanceof Error) && Object.hasOwn(catalog.channels, initialChannelId)
      ? getCredentialTarget(catalog, initialChannelId) : undefined)
  const [pending, setPending] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const { rows } = useTerminalSize()

  function back(message?: string) {
    setPending('')
    if (initialChannelId) return onClose(message)
    setTarget(undefined)
    setError('')
    setCatalog(loadEditableCatalog())
    if (message) setNotice(message)
  }

  if (catalog instanceof Error) return <>
    <Text color="error">{catalog.message}</Text>
    <Select clickToSelect options={[{ value: 'reload', label: '重新读取' }, { value: 'back', label: '返回' }]}
      onChange={(id: string) => id === 'reload' ? setCatalog(loadEditableCatalog()) : onClose()} onCancel={() => onClose()} />
  </>
  if (!target) {
    const options = Object.keys(catalog.channels).map(id => {
      const channel = catalog.channels[id]!
      return { value: id, label: id, description: `${new URL(channel.baseURL).host} · ${channel.apiKeyEnv ?? '未设置密钥变量'}` }
    })
    return <Box flexDirection="column">
      <Text bold>渠道密钥</Text>
      <Text dimColor>{options.length ? '选择要设置密钥的渠道。' : '请先在「模型渠道」添加渠道。'}</Text>
      {notice && <Text color="success">{notice}</Text>}
      <Select clickToSelect options={[...options, { value: '', label: '返回' }]} visibleOptionCount={Math.max(2, Math.min(7, rows - 5))}
        onChange={(id: string) => {
          if (!id) return onClose()
          setNotice('')
          setTarget(getCredentialTarget(catalog, id))
        }} onCancel={onClose} />
    </Box>
  }

  const save = (scope: CredentialScope | 'cancel') => {
    if (scope === 'cancel') return back()
    try {
      applyChannelCredential(target, pending, scope)
      back(scope === 'user' ? `已为 ${target.id} 保存本机密钥，本次运行也已生效。` :
        `已为 ${target.id} 设置本次运行的密钥。`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '未能设置密钥')
    }
  }
  return <Box flexDirection="column">
    <Text bold>{target.id} · 渠道密钥</Text>
    <Text>目的地址　{target.baseURL}</Text>
    {target.variable && <Text>变量名　　{target.variable}</Text>}
    {target.shared.length > 1 && <Box flexDirection="column">
      <Text color="warning">更改此变量会影响以下渠道</Text>
      {target.shared.map(channel => <Text key={channel.id}>{channel.id}　{channel.baseURL}</Text>)}
    </Box>}
    {!target.variable || target.multipleOrigins ? <>
      <Text color={target.multipleOrigins ? 'warning' : undefined}>{target.multipleOrigins
        ? '不同服务地址共用了此变量。请在「模型渠道 → 编辑连接」为各服务分配独立的密钥变量。'
        : catalog.channels[target.id]?.protocol === 'messages'
          ? '此渠道需要密钥。请先在「模型渠道 → 编辑连接」设置密钥变量。'
          : '此渠道配置为无需密钥。'}</Text>
      <Select clickToSelect options={[{ value: 'back', label: '返回' }]} onChange={() => back()} onCancel={back} />
    </> : pending ? <>
      <Box marginTop={1} flexDirection="column">
        <Text bold>选择新密钥的使用范围</Text>
        <Text dimColor>本机保存位置　{userSettingsEnvPath()}（明文）</Text>
      </Box>
      <Select clickToSelect options={[
        { value: 'session', label: '仅用于本次运行' },
        { value: 'user', label: '保存到本机用户配置' },
        { value: 'cancel', label: '取消更改' },
      ]} onChange={save} onCancel={back} />
      {error && <Text color="error">{error}</Text>}
    </> : <SecretField onSubmit={setPending} onBack={back} />}
  </Box>
}
