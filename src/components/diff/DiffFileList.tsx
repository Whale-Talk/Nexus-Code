import figures from 'figures'
import React from 'react'
import type { DiffFile } from '../../hooks/useDiffData.js'
import { stringWidth } from '../../ink/stringWidth.js'
import { Box, Text } from '../../ink.js'
import { truncateStartToWidth } from '../../utils/format.js'
import { reviewText } from './reviewRows.js'

type Props = {
  files: DiffFile[]
  selectedIndex: number
  columns: number
  visibleCount: number
}

export function DiffFileList({ files, selectedIndex, columns, visibleCount }: Props) {
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(visibleCount / 2), files.length - visibleCount))
  return <Box flexDirection="column">
    {files.slice(start, start + visibleCount).map((file, index) => {
      const selected = start + index === selectedIndex
      const stats = file.isUntracked ? '未跟踪' : file.isBinary ? '二进制' : `+${file.linesAdded} −${file.linesRemoved}`
      const pathWidth = Math.max(1, columns - stringWidth(stats) - 4)
      return <Box key={file.path} justifyContent="space-between">
        <Text bold={selected} inverse={selected} wrap="truncate-end">
          {selected ? figures.pointer + ' ' : '  '}{truncateStartToWidth(reviewText(file.path), pathWidth)}
        </Text>
        {columns >= 22 && <Text dimColor={!selected} wrap="truncate-end">{stats}</Text>}
      </Box>
    })}
  </Box>
}
