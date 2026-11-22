import React, { useEffect, useReducer } from 'react'
import { getModelUsage, getTotalCost, formatCost, hasUnknownModelCost } from '../../cost-tracker.js'
import { useMainLoopModel } from '../../hooks/useMainLoopModel.js'
import { Box, Text } from '../../ink.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import { getModelRateLimit, statusListeners } from '../../services/providerLimits.js'

export function Usage() {
  const model = useMainLoopModel()
  const [, refresh] = useReducer(n => n + 1, 0)
  useKeybinding('settings:retry', refresh, { context: 'Settings' })
  useEffect(() => {
    const listener = () => refresh()
    statusListeners.add(listener)
    return () => { statusListeners.delete(listener) }
  }, [])
  const limit = getModelRateLimit(model)
  const entries = Object.entries(getModelUsage())
  return <Box flexDirection="column" gap={1}>
    <Text bold>当前会话用量</Text>
    {entries.length === 0 && <Text dimColor>本次会话还没有模型用量记录。</Text>}
    {entries.map(([channelModel, usage]) => <Box key={channelModel} flexDirection="column">
      <Text bold>{channelModel}</Text>
      <Text>输入 {usage.inputTokens} · 输出 {usage.outputTokens} · 缓存读取 {usage.cacheReadInputTokens} · 缓存写入 {usage.cacheCreationInputTokens}</Text>
    </Box>)}
    {entries.length > 0 && <Text>已知费用 {formatCost(getTotalCost())}{hasUnknownModelCost() ? '（未计入未配置价格的模型）' : ''}</Text>}
    {limit && <Text color="warning">{model} 请求受限{limit.resetsAt !== undefined ? `，预计 ${new Date(limit.resetsAt * 1000).toLocaleTimeString()} 可重试` : ''}</Text>}
    <Text dimColor>R 刷新 · Esc 返回</Text>
  </Box>
}
