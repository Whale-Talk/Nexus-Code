import capitalize from 'lodash-es/capitalize.js'
import React, { useMemo, useState } from 'react'
import { useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCDWithKeybindings.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { Box, Text } from '../ink.js'
import { useKeybindings } from '../keybindings/useKeybinding.js'
import { logEvent, type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../services/analytics/index.js'
import { useAppState, useSetAppState } from '../state/AppState.js'
import {
  convertEffortValueToLevel, getDefaultEffortForModel, getSupportedEffortLevels,
  resolvePickerEffortPersistence, toPersistableEffort, type EffortLevel,
} from '../utils/effort.js'
import { isFastModeAvailable, isFastModeCooldown, isFastModeEnabled } from '../utils/fastMode.js'
import { getDefaultMainLoopModel, modelDisplayString, parseUserSpecifiedModel, type ModelSetting } from '../utils/model/model.js'
import { isModelAllowed } from '../utils/model/modelAllowlist.js'
import { getModelOptions, type ModelOption } from '../utils/model/modelOptions.js'
import { getSettingsForSource, updateSettingsForSource } from '../utils/settings/settings.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'
import { Select } from './CustomSelect/index.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { Pane } from './design-system/Pane.js'
import { effortLevelToSymbol } from './EffortIndicator.js'
import { clampReasoningEffort } from '../services/api/provider/reasoning.js'
import { RoleModelSettings } from './RoleModelSettings.js'

export type Props = {
  initial: string | null
  sessionModel?: ModelSetting
  onSelect: (model: string | null, effort: EffortLevel | undefined) => void
  onCancel?: () => void
  isStandaloneCommand?: boolean
  showFastModeNotice?: boolean
  headerText?: string
  /** Used by pickers whose settings belong to a project or a teammate. */
  skipSettingsWrite?: boolean
}

const configureRoles = 'configure-roles'

export function ModelPicker(props: Props) {
  const [editingRoles, setEditingRoles] = useState(false)
  if (editingRoles) return <RoleModelSettings onClose={() => setEditingRoles(false)} />
  return <SessionModelPicker {...props} onConfigure={() => setEditingRoles(true)} />
}

function optionId(option: ModelOption): string {
  return JSON.stringify([option.role ?? option.value, option.label])
}

function SessionModelPicker({
  initial, sessionModel, onSelect, onCancel, isStandaloneCommand,
  showFastModeNotice, headerText, skipSettingsWrite, onConfigure,
}: Props & { onConfigure: () => void }) {
  const setAppState = useSetAppState()
  const isFastMode = useAppState(s => isFastModeEnabled() && !!s.fastMode)
  const effortValue = useAppState(s => s.effortValue)
  const exitState = useExitOnCtrlCDWithKeybindings()
  const { columns, rows } = useTerminalSize()
  const options = useMemo(() => {
    const models = getModelOptions(isFastMode)
    if (initial !== null && isModelAllowed(initial) && !models.some(option => (option.role ?? option.value) === initial)) {
      return [...models, { value: initial, label: modelDisplayString(initial), description: '当前模型' }]
    }
    return models
  }, [initial, isFastMode])
  const choices = useMemo(() => {
    const list = options.map(option => ({
      value: optionId(option),
      label: option.label,
      description: option.role && option.role !== option.value ? option.value ?? '' : option.description,
    }))
    if (isStandaloneCommand) {
      list.unshift({ value: configureRoles, label: '配置角色与渠道…', description: '更改三个角色的长期绑定' })
    }
    return list
  }, [options, isStandaloneCommand])
  const current = options.find(option => (option.role ?? option.value) === initial)
  const initialFocus = current ?? options[0]
  const [focused, setFocused] = useState(initialFocus ? optionId(initialFocus) : configureRoles)
  const focusedOption = options.find(option => optionId(option) === focused)
  const focusedSetting = focusedOption?.role ?? focusedOption?.value
  const resolved = focusedSetting ? parseUserSpecifiedModel(focusedSetting) : getDefaultMainLoopModel()
  const levels = focusedOption ? getSupportedEffortLevels(resolved) : []
  const defaultEffort = defaultEffortFor(resolved)
  const [effort, setEffort] = useState<EffortLevel | undefined>(() =>
    effortValue === undefined ? undefined : convertEffortValueToLevel(effortValue),
  )
  const [changedEffort, setChangedEffort] = useState(false)
  const selectedEffort = effort ?? defaultEffort
  const displayEffort = clampReasoningEffort(selectedEffort, levels)

  function changeEffort(offset: number) {
    if (!displayEffort) return
    const index = levels.indexOf(displayEffort)
    setEffort(levels[(index + offset + levels.length) % levels.length])
    setChangedEffort(true)
  }

  useKeybindings({
    'modelPicker:decreaseEffort': () => changeEffort(-1),
    'modelPicker:increaseEffort': () => changeEffort(1),
  }, { context: 'ModelPicker' })

  function select(value: string) {
    if (value === configureRoles) return onConfigure()
    const option = options.find(item => optionId(item) === value)
    if (!option) return
    const setting = option.role ?? option.value
    const model = setting ? parseUserSpecifiedModel(setting) : getDefaultMainLoopModel()
    const level = effort ?? defaultEffortFor(model)
    const pickedEffort = changedEffort ? clampReasoningEffort(level, getSupportedEffortLevels(model)) : undefined
    logEvent('nexus_model_command_menu_effort', {
      effort: (pickedEffort ?? level) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    if (!skipSettingsWrite) {
      const priorPersisted = getSettingsForSource('userSettings')?.effortLevel
      const next = resolvePickerEffortPersistence(pickedEffort ?? level, defaultEffortFor(model),
        priorPersisted, pickedEffort !== undefined)
      const persistable = toPersistableEffort(next)
      if (pickedEffort && persistable !== priorPersisted &&
        (persistable === 'low' || persistable === 'medium' || persistable === 'high' || persistable === 'max')) {
        updateSettingsForSource('userSettings', { effortLevel: persistable })
      }
      setAppState(prev => ({ ...prev, effortValue: next }))
    }
    // Save the role itself. Its channel binding can change while the session is open.
    onSelect(setting, pickedEffort)
  }

  const compact = columns < 68
  const content = <Box flexDirection="column">
    <Box flexDirection="column" marginBottom={1}>
      <Text color="remember" bold>选择对话模型</Text>
      <Text dimColor>{headerText ?? (isStandaloneCommand
        ? '选择仅影响本次对话。长期绑定可在「配置角色与渠道」中调整。'
        : '选择要使用的模型。')}</Text>
      {sessionModel && <Text dimColor>计划模式正在使用 {modelDisplayString(sessionModel)}。选择后将结束此次临时切换。</Text>}
    </Box>
    <Select clickToSelect options={choices} defaultFocusValue={initialFocus ? optionId(initialFocus) : configureRoles}
      defaultValue={current ? optionId(current) : undefined} onFocus={setFocused}
      onChange={select} onCancel={onCancel} layout={compact ? 'compact-vertical' : 'compact'}
      visibleOptionCount={Math.max(3, Math.min(8, Math.floor((rows - 10) / (compact ? 2 : 1))))} />
    {displayEffort && <Box marginTop={1}>
      <Text dimColor>{effortLevelToSymbol(displayEffort)} {capitalize(displayEffort)} 思考强度
        {displayEffort === defaultEffort ? '（默认）' : ''} · ← → 调整</Text>
    </Box>}
    {isFastModeEnabled() && showFastModeNotice && <Text dimColor>快速模式已开启。</Text>}
    {isFastModeEnabled() && !showFastModeNotice && isFastModeAvailable() && !isFastModeCooldown() &&
      <Text dimColor>/fast 开启受支持渠道的快速模式。</Text>}
    {isStandaloneCommand && <Box marginTop={1}><Text dimColor>
      {exitState.pending ? `再按一次 ${exitState.keyName} 退出` : <Byline>
        <KeyboardShortcutHint shortcut="↑↓" action="移动" />
        <KeyboardShortcutHint shortcut="Enter" action="选择" />
        <ConfigurableShortcutHint action="select:cancel" context="Select" fallback="Esc" description="返回" />
      </Byline>}
    </Text></Box>}
  </Box>
  return isStandaloneCommand ? <Pane color="permission">{content}</Pane> : content
}

function defaultEffortFor(model: string): EffortLevel {
  const value = getDefaultEffortForModel(model)
  return value === undefined ? 'high' : convertEffortValueToLevel(value)
}
