import type { StructuredPatchHunk } from 'diff'
import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text } from '../../ink.js'
import { stringWidth } from '../../ink/stringWidth.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import { fetchWorkingTreeDiffPreview, type GitDiffPreview } from '../../utils/gitDiff.js'
import sliceAnsi from '../../utils/sliceAnsi.js'
import { DiffSearchField } from './DiffSearchField.js'
import { buildReviewRows, findReviewMatches, type ReviewMatch } from './reviewRows.js'

type DetailProps = {
  filePath: string
  root?: string
  turnHunks?: readonly StructuredPatchHunk[]
  isBinary: boolean
  isUntracked?: boolean
  columns: number
  rows: number
  searching: boolean
  onSearchingChange: (searching: boolean) => void
  backShortcut: string
}

const noHunks: readonly StructuredPatchHunk[] = []

export function DiffDetailView({ filePath, root, turnHunks, isBinary, isUntracked,
  columns, rows, searching, onSearchingChange, backShortcut }: DetailProps) {
  const [preview, setPreview] = useState<GitDiffPreview>()
  useEffect(() => {
    if (turnHunks || isBinary || !root) return
    const controller = new AbortController()
    void fetchWorkingTreeDiffPreview(root, filePath, Boolean(isUntracked), controller.signal).then(
      result => { if (!controller.signal.aborted) setPreview(result) },
      () => { if (!controller.signal.aborted) setPreview({ kind: 'unavailable' }) },
    )
    return () => controller.abort()
  }, [filePath, isBinary, isUntracked, root, turnHunks])

  const hunks = turnHunks ?? (preview?.kind === 'patch' ? preview.hunks : noHunks)
  const { rows: patchRows, hunkStarts, truncated } = useMemo(() => buildReviewRows(hunks), [hunks])
  const [top, setTop] = useState(0)
  const [left, setLeft] = useState(0)
  const [query, setQuery] = useState('')
  const [matchIndex, setMatchIndex] = useState(0)
  const matches = useMemo(() => findReviewMatches(patchRows, query), [patchRows, query])
  const pageSize = Math.max(1, rows - 4)
  const bottom = Math.max(0, patchRows.length - pageSize)
  const start = Math.min(top, bottom)
  const gutterWidth = columns < 20 ? 0 : 8
  const textWidth = Math.max(1, columns - gutterWidth - 1)
  const match = matches[matchIndex]

  function scroll(amount: number) {
    setTop(Math.max(0, Math.min(bottom, start + amount)))
  }
  function focusMatch(result: ReviewMatch | undefined, index: number) {
    setMatchIndex(index)
    if (!result) return
    setTop(result.row)
    setLeft(result.column < textWidth ? 0 : Math.max(0, result.column - Math.floor(textWidth / 3)))
  }
  function moveMatch(delta: number) {
    if (!matches.length) return
    const next = (matchIndex + delta + matches.length) % matches.length
    focusMatch(matches[next], next)
  }
  function moveHunk(delta: -1 | 1) {
    const target = delta === 1 ? hunkStarts.find(line => line > top) : hunkStarts.findLast(line => line < top)
    if (target !== undefined) setTop(target)
  }
  function openSearch() {
    if (!patchRows.length) return
    onSearchingChange(true)
  }
  function acceptSearch(searchText: string) {
    setQuery(searchText)
    const nextMatches = findReviewMatches(patchRows, searchText)
    const next = Math.max(0, nextMatches.findIndex(item => item.row >= start))
    focusMatch(nextMatches[next], next)
    onSearchingChange(false)
  }

  useKeybindings({
    'diff:previousFile': () => scroll(-1),
    'diff:nextFile': () => scroll(1),
    'diff:previousPage': () => scroll(-pageSize),
    'diff:nextPage': () => scroll(pageSize),
    'diff:firstLine': () => setTop(0),
    'diff:lastLine': () => setTop(bottom),
    'diff:search': openSearch,
    'diff:previousMatch': () => moveMatch(-1),
    'diff:nextMatch': () => moveMatch(1),
    'diff:previousHunk': () => moveHunk(-1),
    'diff:nextHunk': () => moveHunk(1),
    'diff:panLeft': () => setLeft(value => Math.max(0, value - textWidth)),
    'diff:panRight': () => {
      if (patchRows.slice(start, start + pageSize).some(row => stringWidth(row.text) > left + textWidth)) {
        setLeft(value => value + textWidth)
      }
    },
  }, { context: 'DiffDialog', isActive: !searching })

  if (!patchRows.length) {
    let message: string
    if (isBinary || preview?.kind === 'binary') message = '二进制文件，无法预览文本差异。'
    else if (preview?.kind === 'too-large') message = '差异超过 1 MB，无法在终端预览。'
    else if (preview?.kind === 'unavailable' || (!root && !turnHunks)) message = '无法读取差异。文件或仓库状态可能已变更。'
    else if (preview || turnHunks) message = '没有文本差异。'
    else message = '正在读取差异…'
    return <Box flexDirection="column">
      <Text dimColor wrap="truncate-end">{message}</Text>
      <Text dimColor>{backShortcut} 返回文件列表</Text>
    </Box>
  }

  const position = `${start + 1}–${Math.min(start + pageSize, patchRows.length)} / ${patchRows.length} 行`
  const searchStatus = query ? matches.length
    ? ` · 匹配 ${matchIndex + 1}/${matches.length}`
    : ' · 无匹配' : ''
  return <Box flexDirection="column">
    {patchRows.slice(start, start + pageSize).map((row, index) => {
      const line = start + index
      const color = row.kind === 'addition' ? 'diffAddedWord'
        : row.kind === 'deletion' ? 'diffRemovedWord'
          : row.kind === 'header' ? 'suggestion' : undefined
      const number = row.lineNumber === undefined ? '' : String(row.lineNumber)
      return <Box key={line}>
        {gutterWidth > 0 && <Text dimColor>{number.padStart(gutterWidth - 1)} </Text>}
        <Text color={color} dimColor={row.kind === 'note'} inverse={match?.row === line} wrap="truncate-end">
          {left > 0 ? '‹' : ''}{sliceAnsi(row.text, left, left + textWidth) || ' '}
        </Text>
      </Box>
    })}
    <Text dimColor wrap="truncate-end">{position}{truncated ? ' · 预览已截断' : ''}{searchStatus}</Text>
    {searching
      ? <DiffSearchField initialValue={query} columns={columns} placeholder="搜索当前差异"
        onSubmit={acceptSearch} onCancel={() => onSearchingChange(false)} />
      : <>
        <Text dimColor wrap="truncate-end">↑↓ 滚动 · PgUp/PgDn 翻页 · {backShortcut} 返回</Text>
        <Text dimColor wrap="truncate-end">/ 搜索 · n/N 匹配 · [ ] 区块 · h/l 横移</Text>
      </>}
  </Box>
}
