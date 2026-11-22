import * as React from 'react';
import { useState } from 'react';
import { Box, Text, useInput } from '../../ink.js';
import TextInput from '../../components/TextInput.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { channelSchema } from '../../services/api/provider/catalog.js';
import { saveUserSettingsEnv } from '../../utils/settings/userSettingsEnv.js';
import { Select } from '../../components/CustomSelect/index.js';

// Nexus API 配置表单 — 输入 NEXUS_BASE_URL + NEXUS_API_KEY, 保存到 ~/.nexus/settings.json。
// 替代 OAuth 登录（Nexus 无账号概念, 全部走 API key + relay）。

type Step = 'url' | 'key' | 'done'

// TextInput 需要受控光标状态 — 用 useState 管理
function ConfigField({
  label,
  hint,
  value,
  mask,
  cursorOffset,
  setCursorOffset,
  onChange,
  onSubmit,
  onCancel,
}: {
  label: string
  hint: string
  value: string
  mask?: string
  cursorOffset: number
  setCursorOffset: (offset: number) => void
  onChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const { columns } = useTerminalSize()
  useInput((_input, key, event) => {
    if (key.escape) {
      event.stopImmediatePropagation()
      onCancel()
    }
  })
  return (
    <Box flexDirection="column" gap={1} padding={1}>
      <Text bold={true}>{label}</Text>
      <Text dimColor={true}>{hint}</Text>
      <TextInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        onExit={onCancel}
        focus={true}
        showCursor={true}
        columns={Math.max(1, columns - 2)}
        mask={mask}
        showMaskedSuffix={false}
        disableEscapeDoublePress={true}
        cursorOffset={cursorOffset}
        onChangeCursorOffset={setCursorOffset}
      />
      <Text dimColor={true}>回车确认 · Esc 取消</Text>
    </Box>
  )
}

export function NexusConfigForm({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>('url')
  const [baseUrl, setBaseUrl] = useState(process.env.NEXUS_BASE_URL || 'https://api.deepseek.com/anthropic')
  const [apiKey, setApiKey] = useState('')
  const [cursorOffset, setCursorOffset] = useState(baseUrl.length)
  const [error, setError] = useState('')

  if (step === 'url') {
    return (
      <ConfigField
        label="配置 Nexus API 服务地址"
        hint={error || '确认当前服务的接口根地址。也可以按 Esc 跳过，进入设置中心配置其他渠道。'}
        value={baseUrl}
        cursorOffset={cursorOffset}
        setCursorOffset={setCursorOffset}
        onChange={value => { setBaseUrl(value); setError('') }}
        onSubmit={() => {
          if (!channelSchema.shape.baseURL.safeParse(baseUrl).success) {
            setError('请输入有效的 HTTP(S) 服务地址。')
            return
          }
          setError('')
          setCursorOffset(0)
          setStep('key')
        }}
        onCancel={onDone}
      />
    )
  }

  if (step === 'key') {
    return (
      <ConfigField
        label="配置 API 密钥"
        hint={error || `服务地址  ${baseUrl}\n请粘贴该服务发放的完整密钥，回车将保存到本机用户设置。`}
        value={apiKey}
        mask="*"
        cursorOffset={cursorOffset}
        setCursorOffset={setCursorOffset}
        onChange={setApiKey}
        onSubmit={() => {
          if (!apiKey.trim()) return
          const url = baseUrl.trim()
          const keyVal = apiKey.trim()
          const keyName = process.env.NEXUS_PROVIDER === 'openai-compatible' && process.env.NEXUS_AUTH_TOKEN
            ? 'NEXUS_AUTH_TOKEN' : 'NEXUS_API_KEY'
          const env = { NEXUS_BASE_URL: url, [keyName]: keyVal }
          try { saveUserSettingsEnv(env) }
          catch { setError('保存失败，请检查用户设置文件及其写入权限。'); return }
          Object.assign(process.env, env)
          setApiKey('')
          setStep('done')
        }}
        onCancel={onDone}
      />
    )
  }

  return (
    <Box flexDirection="column" gap={1} padding={1}>
      <Text color="green">✓ 配置完成！</Text>
      <Text dimColor={true}>服务地址: {baseUrl}</Text>
      <Text dimColor={true}>API 密钥已保存</Text>
      <Text dimColor={true}>配置已保存到 ~/.nexus/settings.json</Text>
      <Select options={[{ label: '继续', value: 'continue' }]} onChange={onDone} onCancel={onDone} />
    </Box>
  )
}
