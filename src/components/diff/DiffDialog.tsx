import React, { useState } from 'react'
import type { CommandResultDisplay } from '../../commands.js'
import { useModalOrTerminalSize } from '../../context/modalContext.js'
import { useRegisterOverlay } from '../../context/overlayContext.js'
import { useDiffData } from '../../hooks/useDiffData.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { useTurnDiffs } from '../../hooks/useTurnDiffs.js'
import { Box, Text } from '../../ink.js'
import { stringWidth } from '../../ink/stringWidth.js'
import { useRegisterKeybindingContext } from '../../keybindings/KeybindingContext.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import { useShortcutDisplay } from '../../keybindings/useShortcutDisplay.js'
import type { Message } from '../../types/message.js'
import { truncateStartToWidth } from '../../utils/format.js'
import { Dialog } from '../design-system/Dialog.js'
import { DiffDetailView } from './DiffDetailView.js'
import { DiffFileList } from './DiffFileList.js'
import { DiffSearchField } from './DiffSearchField.js'
import { reviewText } from './reviewRows.js'

type Props = {
  messages: Message[]
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void
}

export function DiffDialog({ messages, onDone }: Props) {
  const worktree = useDiffData()
  const turns = useTurnDiffs(messages)
  const [source, setSource] = useState(0)
  const [selection, setSelection] = useState(0)
  const [detail, setDetail] = useState(false)
  const [searching, setSearching] = useState(false)
  const [fileFilter, setFileFilter] = useState('')
  const activeSource = Math.min(source, turns.length)
  const turn = activeSource === 0 ? undefined : turns[activeSource - 1]
  const allFiles = turn ? Array.from(turn.files.values(), file => ({
    path: file.filePath, linesAdded: file.linesAdded, linesRemoved: file.linesRemoved,
    isBinary: false, isUntracked: false,
  })).sort((a, b) => a.path.localeCompare(b.path)) : worktree.files
  const needle = fileFilter.toLowerCase()
  const files = needle ? allFiles.filter(file => file.path.toLowerCase().includes(needle)) : allFiles
  const stats = turn ? { ...turn.stats, filesCount: turn.stats.filesChanged } : worktree.stats
  const selectedIndex = Math.min(selection, Math.max(0, files.length - 1))
  const selected = files[selectedIndex]
  const inDetail = detail && Boolean(selected)
  const terminal = useModalOrTerminalSize(useTerminalSize())
  const columns = Math.max(1, terminal.columns - 4)
  const rows = Math.max(1, terminal.rows - 5)
  const listRows = Math.max(1, rows - 3)
  const dismiss = useShortcutDisplay('diff:dismiss', 'DiffDialog', 'Esc')
  useRegisterOverlay('diff-dialog', true)
  useRegisterKeybindingContext('DiffDialog', !searching)

  function changeSource(amount: number) {
    const next = Math.max(0, Math.min(turns.length, activeSource + amount))
    if (next === activeSource) return
    setSource(next)
    setSelection(0)
  }
  function moveFile(amount: number) {
    setSelection(Math.max(0, Math.min(files.length - 1, selectedIndex + amount)))
  }
  function cancel() {
    if (inDetail) setDetail(false)
    else if (fileFilter) {
      setFileFilter('')
      setSelection(0)
    }
    else onDone(undefined, { display: 'skip' })
  }

  function acceptFileFilter(value: string) {
    setFileFilter(value)
    setSelection(0)
    setSearching(false)
  }

  const detailActions: Record<string, () => void> = {
    'diff:previousSource': () => setDetail(false),
    'diff:back': () => setDetail(false),
  }
  const listActions: Record<string, () => void> = {
    'diff:previousSource': () => changeSource(-1),
    'diff:nextSource': () => changeSource(1),
    'diff:previousFile': () => moveFile(-1),
    'diff:nextFile': () => moveFile(1),
    'diff:previousPage': () => moveFile(-listRows),
    'diff:nextPage': () => moveFile(listRows),
    'diff:firstLine': () => setSelection(0),
    'diff:lastLine': () => setSelection(Math.max(0, files.length - 1)),
    'diff:viewDetails': () => { if (selected) setDetail(true) },
    'diff:search': () => { if (allFiles.length) setSearching(true) },
  }
  useKeybindings({ 'diff:dismiss': cancel, ...(inDetail ? detailActions : listActions) },
    { context: 'DiffDialog', isActive: !searching })

  const sourceTitle = turn ? `第 ${turn.turnIndex} 轮 · 工具记录` : '工作区 · 相对 HEAD'
  const scope = turn ? `第 ${turn.turnIndex} 轮` : '工作区'
  const title = inDetail && selected
    ? `${scope} · ${truncateStartToWidth(reviewText(selected.path), Math.max(1, columns - stringWidth(scope) - 3))}`
    : sourceTitle
  const empty = fileFilter ? '没有匹配的文件。' : turn ? '这一轮没有记录到文件改动。' : worktree.loading ? '正在读取 Git 改动…'
    : worktree.stats ? '工作区没有未提交改动。' : '无法读取工作区改动。'
  return <Dialog title={<Text wrap="truncate-end">{truncateStartToWidth(title, columns)}</Text>}
    color="background" onCancel={cancel} isCancelActive={!searching} hideInputGuide={inDetail || searching}
    inputGuide={exit => <Text wrap="truncate-end">{exit.pending ? `再按一次 ${exit.keyName} 退出`
      : `${turns.length ? '←→ 来源 · ' : ''}↑↓ 选文件 · Enter 查看 · / 搜索 · ${dismiss} ${fileFilter ? '清除筛选' : '关闭'}`}</Text>}>
    {inDetail && selected
      ? <Box key={activeSource + ':' + selected.path} flexDirection="column">
        <DiffDetailView filePath={selected.path} root={worktree.root} turnHunks={turn?.files.get(selected.path)?.hunks}
          isBinary={selected.isBinary} isUntracked={selected.isUntracked}
          columns={columns} rows={rows} searching={searching} onSearchingChange={setSearching} backShortcut={dismiss} />
      </Box>
      : <Box flexDirection="column">
        {stats && <Text dimColor wrap="truncate-end">
          {files.length ? `${selectedIndex + 1}/${files.length} · ` : ''}{stats.filesCount} 个文件
          <Text color="diffAddedWord"> +{stats.linesAdded}</Text>
          <Text color="diffRemovedWord"> −{stats.linesRemoved}</Text>
          {stats.filesCount > allFiles.length ? ` · 仅列出 ${allFiles.length} 项` : ''}
        </Text>}
        {searching && <DiffSearchField initialValue={fileFilter} columns={columns} placeholder="按文件名筛选"
          onSubmit={acceptFileFilter} onCancel={() => setSearching(false)} />}
        {!searching && fileFilter && <Text dimColor wrap="truncate-end">筛选 {files.length}/{allFiles.length} · {reviewText(fileFilter)}</Text>}
        {files.length ? <DiffFileList files={files} selectedIndex={selectedIndex} columns={columns} visibleCount={listRows} />
          : <Text dimColor wrap="truncate-end">{empty}</Text>}
      </Box>}
  </Dialog>
}
