import React, { lazy, Suspense, useCallback, useContext, useEffect, useState } from 'react'
import { ModalContext, useModalOrTerminalSize } from '../../context/modalContext.js'
import { useRegisterOverlay } from '../../context/overlayContext.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { TerminalSizeContext } from '../../ink/components/TerminalSizeContext.js'
import { Box, Text } from '../../ink.js'
import { stringWidth } from '../../ink/stringWidth.js'
import { isCommandEnabled, type Command, type LocalJSXCommandContext, type LocalJSXCommandOnDone } from '../../types/command.js'
import { truncateToWidth } from '../../utils/format.js'
import { Select } from '../CustomSelect/index.js'
import { RoleModelSettings } from '../RoleModelSettings.js'
import { Settings } from './Settings.js'
import { WebSettings } from './WebSettings.js'

const ModelChannels = lazy(async () => ({
  default: (await import('./ModelChannels.js')).ModelChannels,
}))
const mainEntries = [
  { value: 'models', label: '模型', description: '配置角色绑定、渠道、密钥及推理偏好' },
  { value: 'web', label: '网页工具', description: '配置网页搜索、读取和 DeepSeek 网页密钥' },
  { value: 'general', label: '通用设置与外观', description: '主题、语言、输出和交互偏好' },
  { value: 'permissions', label: '工具审批与权限', description: '查看允许、询问和拒绝规则' },
  { value: 'mcp', label: 'MCP 服务', description: '查看连接、工具和服务状态' },
  { value: 'status', label: '状态与用量', description: '查看运行环境和使用情况' },
  { value: 'advanced', label: '更多设置', description: '代理、技能与扩展' },
]
const modelEntries = [
  { value: 'channels', label: '管理渠道与模型', description: '管理 API 地址和协议，读取或手填模型 ID' },
  { value: 'reasoning', label: '推理偏好', description: '调整思考和推理相关选项' },
]
const extraEntries = [
  { value: 'agents', label: '代理', description: '管理代理配置' },
  { value: 'skills', label: '技能', description: '浏览可用技能' },
  { value: 'plugin', label: '插件', description: '管理安装的插件' },
  { value: 'hooks', label: '工具事件', description: '查看事件触发的操作' },
  { value: 'memory', label: '记忆文件', description: '管理自动记忆，打开项目和个人指令' },
  { value: 'sandbox', label: '命令执行隔离', description: '配置本机支持的隔离选项' },
]

type SettingsCommand = Extract<Command, { type: 'local-jsx' }>
type Menu = 'home' | 'models' | 'advanced'
type Props = { context: LocalJSXCommandContext; onClose: LocalJSXCommandOnDone }

function CommandPanel({ command, context, onClose }: Props & { command: SettingsCommand }) {
  const [content, setContent] = useState<React.ReactNode>(null)
  useEffect(() => {
    let active = true
    const finish: LocalJSXCommandOnDone = (message, options) => {
      if (active) onClose(message, options)
    }
    async function load() {
      try {
        const module = await command.load()
        if (!active) return
        const page = await module.call(finish, context, '')
        if (active) setContent(page)
      } catch (error) {
        finish(error instanceof Error ? error.message : String(error))
      }
    }
    void load()
    return () => { active = false }
  }, [command, context, onClose])
  return content ?? <Text dimColor>正在打开设置…</Text>
}

export function SettingsCenter({ context, onClose }: Props) {
  useRegisterOverlay('settings-center', true)
  const [page, setPage] = useState('home')
  const [menuFocus, setMenuFocus] = useState<Partial<Record<Menu, string>>>({})
  const [message, setMessage] = useState('')
  const outerModal = useContext(ModalContext)
  const available = useModalOrTerminalSize(useTerminalSize())
  const width = Math.min(88, available.columns)
  // Outer border, heading and spacer consume four rows. In classic mode
  // reserve one more for the REPL status line under the panel.
  const innerSize = { columns: Math.max(1, width - 4), rows: Math.max(1, available.rows - (outerModal ? 4 : 5)) }
  const findCommand = (value: string) => context.options.commands.find((item): item is SettingsCommand =>
    item.type === 'local-jsx' && !item.loadedFrom && (item.name === value || item.aliases?.includes(value)) &&
    !item.isHidden && isCommandEnabled(item),
  )
  const advanced = extraEntries.filter(item => findCommand(item.value))
  const parentMenu = modelEntries.some(item => item.value === page) ? 'models'
    : advanced.some(item => item.value === page) ? 'advanced' : 'home'
  const back = useCallback<LocalJSXCommandOnDone>((result, options) => {
    if (options?.shouldQuery || options?.nextInput || options?.metaMessages?.length) {
      onClose(result, options)
      return
    }
    setMessage(options?.display === 'system' || options?.display === 'skip' ? '' : result ?? '')
    setPage(parentMenu)
  }, [onClose, parentMenu])
  const isMenu = page === 'home' || page === 'advanced'
  const entry = [...mainEntries, ...modelEntries, ...advanced].find(item => item.value === page)
  let panel: React.ReactNode
  if (isMenu) {
    const entries = page === 'advanced' ? advanced : mainEntries.filter(item =>
      ['models', 'web', 'general', 'status'].includes(item.value) ||
      (item.value === 'advanced' ? advanced.length > 0 : findCommand(item.value)),
    )
    const indexWidth = String(entries.length).length + 8
    const labelWidth = Math.max(...entries.map(item => stringWidth(item.label)), 0)
    const descriptionWidth = innerSize.columns - indexWidth - labelWidth
    const options = entries.map(item => ({
      value: item.value,
      label: truncateToWidth(item.label, Math.max(1, innerSize.columns - indexWidth)),
      description: descriptionWidth >= 28 ? truncateToWidth(item.description, descriptionWidth) : undefined,
    }))
    const showNotice = Boolean(message) && innerSize.rows >= 5
    panel = <>
      {showNotice && <Box marginBottom={1}><Text wrap="truncate-end">{message}</Text></Box>}
      <Select clickToSelect key={page} options={options}
        defaultFocusValue={menuFocus[page]}
        visibleOptionCount={Math.max(1, innerSize.rows - 3 - (showNotice ? 2 : 0))}
        onChange={value => {
          setMenuFocus(previous => ({ ...previous, [page]: value }))
          setMessage('')
          setPage(value)
        }} onCancel={() => {
          if (page !== 'home') back()
          else onClose(undefined, { display: 'skip' })
        }} />
      <Box marginTop={1}><Text dimColor wrap="truncate-end">↑↓ 移动 · Enter 打开 · Esc {page === 'home' ? '返回聊天' : '返回设置中心'}</Text></Box>
    </>
  } else if (page === 'models') {
    function openModelPage(value: string) {
      setMenuFocus(previous => ({ ...previous, models: value }))
      setPage(value)
    }
    panel = <RoleModelSettings onClose={() => back()} initialFocus={menuFocus.models}
      onManageChannels={() => openModelPage('channels')} onReasoning={() => openModelPage('reasoning')} />
  } else if (page === 'reasoning') {
    panel = <Settings defaultTab="Config" context={context} onClose={back} modelSettings />
  } else if (page === 'channels') {
    panel = <Suspense fallback={<Text dimColor>正在打开模型渠道…</Text>}>
      <ModelChannels onClose={() => back()} />
    </Suspense>
  } else if (page === 'web') {
    panel = <WebSettings onClose={back} />
  } else if (page === 'general' || page === 'status') {
    panel = <Settings defaultTab={page === 'general' ? 'Config' : 'Status'} context={context} onClose={back} />
  } else {
    const command = findCommand(page)
    panel = command ? <CommandPanel command={command} context={context} onClose={back} /> :
      <Select clickToSelect options={[{ value: 'back', label: '此功能当前不可用，返回设置中心' }]} onCancel={() => back()} onChange={() => back()} />
  }
  return <Box width="100%" alignItems="center" flexDirection="column">
    <Box width={width} flexDirection="column" borderStyle="round" borderColor="permission" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="remember">Nexus 设置中心</Text>
        {parentMenu === 'models' && <Text dimColor> / 模型</Text>}
        {entry && <Text dimColor> / {entry.label}</Text>}
      </Box>
      <ModalContext.Provider value={{ ...innerSize, scrollRef: outerModal?.scrollRef ?? null }}>
        <TerminalSizeContext.Provider value={innerSize}>{panel}</TerminalSizeContext.Provider>
      </ModalContext.Provider>
    </Box>
  </Box>
}
