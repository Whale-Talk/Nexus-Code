import React, { useState } from 'react'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { Box, Text } from '../../ink.js'
import {
  findCredentialOriginConflict, getEditableModelCatalog, getModelCatalog,
} from '../../services/api/provider/catalog.js'
import { saveUserSettingsEnv } from '../../utils/settings/userSettingsEnv.js'
import { Select } from '../CustomSelect/index.js'
import { SecretField } from './ChannelCredentials.js'

const searchProviders = [
  { value: 'auto', label: '自动', description: '官方渠道或独立网页密钥可用时使用 DeepSeek，其余使用 Exa' },
  { value: 'deepseek', label: 'DeepSeek Search API', description: '按有结果的成功请求计费' },
  { value: 'exa', label: 'Exa', description: '可设置 EXA_API_KEY' },
  { value: 'parallel', label: 'Parallel', description: '可设置 PARALLEL_API_KEY' },
]

const fetchProviders = [
  { value: 'auto', label: '自动', description: '官方渠道或独立网页密钥可用时使用 DeepSeek，其余直接读取网址' },
  { value: 'deepseek', label: 'DeepSeek Fetch API', description: '读取网页正文，按有结果的成功请求计费' },
  { value: 'direct', label: '直接读取网址' },
]

type Section = 'search' | 'fetch' | 'key'
type Page = Section | 'overview' | 'key-scope'
const keyVariable = 'DEEPSEEK_WEB_API_KEY'
const keyOrigin = 'https://api.deepseek.com'

function currentProvider(envName: string, providers: typeof searchProviders | typeof fetchProviders) {
  const value = process.env[envName]?.trim() || 'auto'
  return { value, label: providers.find(provider => provider.value === value)?.label ?? '待重新选择' }
}

export function WebSettings({ onClose }: { onClose: (notice?: string) => void }) {
  const { columns } = useTerminalSize()
  const layout = columns < 64 ? 'compact-vertical' : 'compact'
  const [page, setPage] = useState<Page>('overview')
  const [section, setSection] = useState<Section>('search')
  const [pendingKey, setPendingKey] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const search = currentProvider('NEXUS_SEARCH_PROVIDER', searchProviders)
  const fetch = currentProvider('NEXUS_FETCH_PROVIDER', fetchProviders)

  function back(result = '') {
    setPendingKey('')
    setError('')
    setNotice(result)
    setPage('overview')
  }

  function saveProvider(name: string, value: string, label: string) {
    try {
      saveUserSettingsEnv({ [name]: value })
      process.env[name] = value
      back(`${label}已保存`)
    } catch {
      setError(`无法保存${label}，请检查用户配置目录。`)
    }
  }

  function saveKey(scope: string) {
    if (scope === 'cancel') return back()
    try {
      const editable = getEditableModelCatalog()
      const active = getModelCatalog()?.config
      if (findCredentialOriginConflict(editable, keyVariable, keyOrigin) ||
        (active && findCredentialOriginConflict(active, keyVariable, keyOrigin))) {
        setError('此环境变量已用于其他地址。请为模型渠道指定独立变量后重试。')
        return
      }
      if (scope === 'user') saveUserSettingsEnv({ [keyVariable]: pendingKey })
      process.env[keyVariable] = pendingKey
      back(scope === 'user' ? '网页密钥已保存到本机用户配置' : '网页密钥已设置为仅本次运行使用')
    } catch {
      setError('无法设置网页密钥，请检查用户配置目录和模型渠道。')
    }
  }

  if (page === 'key' || page === 'key-scope') {
    return <Box flexDirection="column" gap={1}>
      <Text dimColor>DeepSeek 网页密钥 · {keyOrigin}</Text>
      {page === 'key' ? <SecretField onBack={() => back()} onSubmit={value => {
        setPendingKey(value)
        setPage('key-scope')
      }} /> : <>
        <Text bold>选择密钥使用范围</Text>
        <Select clickToSelect options={[
          { value: 'session', label: '仅用于本次运行' },
          { value: 'user', label: '保存到本机用户配置', description: '明文存入个人 settings.json' },
          { value: 'cancel', label: '取消更改' },
        ]} layout={layout} onChange={saveKey} onCancel={() => back()} />
        {error && <Text color="error">{error}</Text>}
        <Text dimColor>↑↓ 选择 · Enter 确认 · Esc 取消</Text>
      </>}
    </Box>
  }

  if (page === 'search' || page === 'fetch') {
    const isSearch = page === 'search'
    const name = isSearch ? 'NEXUS_SEARCH_PROVIDER' : 'NEXUS_FETCH_PROVIDER'
    const label = isSearch ? '搜索服务' : '读取服务'
    return <Box flexDirection="column" gap={1}>
      <Text bold>选择{label}</Text>
      <Select clickToSelect options={isSearch ? searchProviders : fetchProviders} layout={layout}
        defaultFocusValue={isSearch ? search.value : fetch.value}
        onCancel={() => back()} onChange={(value: string) => saveProvider(name, value, label)} />
      {error && <Text color="error">{error}</Text>}
      <Text dimColor>↑↓ 选择 · Enter 保存 · Esc 返回</Text>
    </Box>
  }

  return <Box flexDirection="column" gap={1}>
    <Select key="web-overview" clickToSelect options={[
      { value: 'search', label: `搜索服务 · ${search.label}` },
      { value: 'fetch', label: `读取服务 · ${fetch.label}` },
      { value: 'key', label: `DeepSeek 网页密钥 · ${process.env[keyVariable]?.trim() ? '已设置' : '未设置'}` },
    ]} defaultFocusValue={section} onCancel={() => onClose()} onChange={(value: Section) => {
      setNotice('')
      setSection(value)
      setPage(value)
    }} />
    {notice && <Text color="success">{notice}</Text>}
    <Text dimColor>网页密钥供搜索与读取共用，专用密钥优先。</Text>
    <Text dimColor>搜索用 DEEPSEEK_SEARCH_API_KEY，读取用 DEEPSEEK_FETCH_API_KEY。</Text>
    <Text dimColor>↑↓ 选择 · Enter 打开 · Esc 返回设置中心</Text>
  </Box>
}
