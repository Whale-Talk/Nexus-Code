import React, { useEffect, useRef, useState } from 'react'
import { Box, Text } from '../../ink.js'
import { getEditableModelCatalog, getModelCatalog, type ChannelConnection } from '../../services/api/provider/catalog.js'
import { APIError, resolveProviderRoute } from '../../services/api/provider/index.js'
import { getModelMaxOutputTokens } from '../../utils/context.js'
import { isModelAllowed } from '../../utils/model/modelAllowlist.js'
import { Select } from '../CustomSelect/index.js'

export function ChannelModelTest({ channelId, modelId, connection, onClose }: {
  channelId: string
  modelId: string
  connection: ChannelConnection
  onClose: () => void
}) {
  const active = useRef<AbortController | null>(null)
  const [result, setResult] = useState<{ success: boolean; message: string }>()
  const [waiting, setWaiting] = useState(false)

  useEffect(() => () => active.current?.abort(), [])

  async function send() {
    if (active.current) return
    let selected: string
    let route: ReturnType<typeof resolveProviderRoute>
    try {
      const channel = getEditableModelCatalog().channels[channelId]
      if (!channel || channel.baseURL !== connection.baseURL || channel.protocol !== connection.protocol ||
          channel.apiKeyEnv !== connection.apiKeyEnv || !channel.models.some(model => model.id === modelId)) {
        throw new Error('渠道或模型已变更，请返回后重新打开。')
      }
      const catalog = getModelCatalog()
      const cached = catalog?.config.channels[channelId]
      if (catalog && (!cached || cached.baseURL !== connection.baseURL || cached.protocol !== connection.protocol ||
          cached.apiKeyEnv !== connection.apiKeyEnv)) {
        throw new Error('当前进程的渠道信息已过期，请重新启动后再测试。')
      }
      selected = catalog ? `${channelId}::${modelId}` : modelId
      if (!isModelAllowed(selected)) throw new Error('该模型受模型使用策略限制。')
      route = resolveProviderRoute(selected)
    } catch (cause) {
      setResult({ success: false, message: cause instanceof Error ? cause.message : '无法确定测试渠道。' })
      return
    }
    const controller = new AbortController()
    const deadline = AbortSignal.timeout(15_000)
    active.current = controller
    setWaiting(true)
    try {
      await route.adapter.generateText({
        model: route.model,
        reasoningDialect: route.reasoningDialect,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        maxOutputTokens: Math.min(128, getModelMaxOutputTokens(selected).upperLimit),
      }, AbortSignal.any([controller.signal, deadline]))
      if (!controller.signal.aborted) setResult({ success: true, message: '对话接口已响应。' })
    } catch (cause) {
      if (!controller.signal.aborted) {
        const status = cause instanceof APIError ? cause.status : undefined
        const message = deadline.aborted ? '测试超时，请重试。'
          : status === 401 || status === 403 ? `渠道拒绝访问（HTTP ${status}），请核对本渠道的密钥和权限。`
          : status ? `测试失败（HTTP ${status}），请核对地址和模型 ID。`
          : '测试失败，请核对渠道地址、协议和网络连接。'
        setResult({ success: false, message })
      }
    } finally {
      if (active.current === controller) active.current = null
      if (!controller.signal.aborted) setWaiting(false)
    }
  }

  return <Box flexDirection="column">
    <Text bold>测试对话 · {modelId}</Text>
    <Text wrap="truncate-end">{connection.baseURL}</Text>
    <Text dimColor wrap="truncate-end">向该模型发送一条简短的测试消息。</Text>
    {waiting && <Text dimColor>等待渠道响应…</Text>}
    {result && <Text color={result.success ? 'success' : 'warning'} wrap="truncate-end">{result.message}</Text>}
    <Select clickToSelect options={[
      ...(!waiting && !result?.success ? [{ value: 'send', label: result ? '重新测试' : '发送测试消息' }] : []),
      { value: 'back', label: '返回' },
    ]} onChange={(value: string) => value === 'send' ? void send() : onClose()} onCancel={onClose} />
    <Text dimColor>Enter 确认 · Esc 返回</Text>
  </Box>
}
