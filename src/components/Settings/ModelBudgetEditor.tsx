import React, { useState } from 'react'
import { Box, Text, useInput } from '../../ink.js'
import {
  getModelCatalog, saveModelBudgetSettings,
  type ModelBudgetOverrides, type ModelChannel,
} from '../../services/api/provider/catalog.js'
import { getModelBudgetDetails } from '../../utils/context.js'
import { Select } from '../CustomSelect/index.js'
import { ChannelField } from '../ModelChannelForm.js'

type Model = ModelChannel['models'][number]
type Field = keyof ModelBudgetOverrides
const sources = { manual: '手动', channel: '渠道返回', official: '官方规格', fallback: '估算值' } as const
const fields = { contextWindow: '上下文窗口', outputBudget: '单次输出预算' } as const
const tokens = (value: number) => value.toLocaleString() + ' tokens'

function parseTokens(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/u.test(trimmed)) throw new Error('请输入有效的 token 整数，或留空恢复自动。')
  const number = Number(trimmed.replaceAll(',', ''))
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error('请输入有效的正整数。')
  return number
}

export function ModelBudgetEditor({ channelId, channel, model, onClose }: {
  channelId: string
  channel: ModelChannel
  model: Model
  onClose: (message?: string) => void
}) {
  const original: ModelBudgetOverrides = { contextWindow: model.contextWindow, outputBudget: model.outputBudget }
  const [draft, setDraft] = useState(original)
  const [field, setField] = useState<Field>()
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const details = modelBudgetDetails(channelId, model.id)

  function save() {
    try {
      if (draft.contextWindow === original.contextWindow && draft.outputBudget === original.outputBudget) {
        onClose()
        return
      }
      saveModelBudgetSettings(channelId, model.id, channel, original, draft)
      onClose('已保存模型高级设置。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '未能保存模型参数。')
    }
  }

  useInput((value, key, event) => {
    if (!field && key.ctrl && value === 's') {
      event.stopImmediatePropagation()
      save()
    }
  })

  if (field) return <Box flexDirection="column">
    <Text bold>{fields[field]}</Text>
    <Text dimColor>填写 token 数量，留空恢复自动。</Text>
    <ChannelField initialValue={input} onChange={value => { setInput(value); setError('') }}
      onSubmit={value => {
        try {
          const parsed = parseTokens(value)
          if (field === 'contextWindow' && parsed === 1) throw new Error('上下文窗口至少需要 2 个 token。')
          setDraft(previous => ({ ...previous, [field]: parsed }))
          setField(undefined)
          setError('')
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : '请检查输入。')
        }
      }} onBack={() => { setField(undefined); setError('') }} />
    {error && <Text color="error">{error}</Text>}
    <Text dimColor>Enter 确认 · Esc 返回</Text>
  </Box>

  return <Box flexDirection="column">
    <Text bold>高级设置 · {model.name ?? model.id}</Text>
    <Text dimColor>上下文包含输入和输出。实际输出还受本次剩余空间限制。</Text>
    <Select clickToSelect options={[
      { value: 'contextWindow', label: '上下文窗口', description: draft.contextWindow === undefined
        ? original.contextWindow === undefined ? `自动 · ${tokens(details.contextWindow)} · ${sources[details.contextSource]}` : '自动'
        : `手动 · ${tokens(draft.contextWindow)}` },
      { value: 'outputBudget', label: '单次输出预算', description: draft.outputBudget === undefined
        ? original.outputBudget === undefined ? `自动 · ${tokens(details.outputBudget)}` : '自动'
        : `手动 · ${tokens(draft.outputBudget)}` },
      { value: 'auto', label: '恢复自动' },
      { value: 'save', label: '保存' },
    ]} onChange={(value: Field | 'auto' | 'save') => {
      setError('')
      if (value === 'save') save()
      else if (value === 'auto') setDraft({})
      else {
        setField(value)
        setInput(draft[value]?.toString() ?? '')
      }
    }} onCancel={() => onClose()} />
    {details.outputLimit !== undefined && <Text dimColor>已知输出上限　{tokens(details.outputLimit)}</Text>}
    {error && <Text color="error">{error}</Text>}
    <Text dimColor>Enter 打开 · Ctrl+S 保存 · Esc 返回</Text>
  </Box>
}

export function modelBudgetDetails(channelId: string, modelId: string) {
  return getModelBudgetDetails(getModelCatalog() ? `${channelId}::${modelId}` : modelId)
}
