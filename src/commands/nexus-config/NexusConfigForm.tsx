import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { useState } from 'react';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { Box, Text } from '../../ink.js';
import TextInput from '../../components/TextInput.js';

// Nexus API 配置表单 — 输入 NEXUS_BASE_URL + NEXUS_API_KEY, 保存到 ~/.nexus/settings.json。
// 替代 OAuth 登录（Nexus 无账号概念, 全部走 API key + relay）。

const CONFIG_DIR = join(homedir(), '.nexus')
const SETTINGS_PATH = join(CONFIG_DIR, 'settings.json')

function readSettings(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'))
  } catch {
    return {}
  }
}

function saveSettings(env: Record<string, string>): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  const current = readSettings()
  const merged = {
    ...current,
    env: {
      ...(current.env as Record<string, string> | undefined),
      ...env,
    },
  }
  writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2) + '\n', { mode: 0o600 })
}

type Step = 'url' | 'key' | 'done'

// TextInput 需要受控光标状态 — 用 useState 管理
function ConfigField({
  label,
  hint,
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const [cursorOffset, setCursorOffset] = useState(value.length)
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
        columns={80}
        cursorOffset={cursorOffset}
        onChangeCursorOffset={setCursorOffset}
      />
      <Text dimColor={true}>回车确认 · Esc 取消</Text>
    </Box>
  )
}

export function NexusConfigForm({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>('url')
  const [baseUrl, setBaseUrl] = useState('http://192.168.77.162:8080')
  const [apiKey, setApiKey] = useState('')

  if (step === 'url') {
    return (
      <ConfigField
        label="配置 Nexus API 服务地址"
        hint="请输入 relay 服务的 base URL（例如 http://192.168.77.162:8080）"
        value={baseUrl}
        onChange={setBaseUrl}
        onSubmit={() => setStep('key')}
        onCancel={onDone}
      />
    )
  }

  if (step === 'key') {
    return (
      <ConfigField
        label="配置 API 密钥"
        hint={`服务地址: ${baseUrl}\n请输入您的 API key（不要添加 sk- 前缀）`}
        value={apiKey}
        onChange={setApiKey}
        onSubmit={() => {
          if (!apiKey.trim()) return
          const url = baseUrl.trim()
          const keyVal = apiKey.trim()
          saveSettings({
            NEXUS_BASE_URL: url,
            NEXUS_API_KEY: keyVal,
          })
          // 配置完成 — 提示重启后退出 (绕过 Onboarding 步骤切换问题)
          setStep('done')
        }}
        onCancel={onDone}
      />
    )
  }

  // done — 配置完成, 显示提示后自动退出
  return (
    <Box flexDirection="column" gap={1} padding={1}>
      <Text color="green">✓ 配置完成！</Text>
      <Text dimColor={true}>服务地址: {baseUrl}</Text>
      <Text dimColor={true}>API 密钥: {apiKey.slice(0, 8)}…</Text>
      <Text dimColor={true}>配置已保存到 ~/.nexus/settings.json</Text>
      <Text bold={true}>请重新运行 nexus 以应用配置</Text>
      <AutoExit />
    </Box>
  )
}

// 自动退出 — 不依赖按键 (Onboarding 键盘事件不可靠)
function AutoExit() {
  React.useEffect(() => {
    const t = setTimeout(() => process.exit(0), 3000)
    return () => clearTimeout(t)
  }, [])
  return <Text dimColor={true}>3 秒后自动退出…</Text>
}
