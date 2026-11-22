import React, { useState } from 'react'
import { Box, Text, useInput } from '../../ink.js'
import TextInput from '../TextInput.js'

type Props = {
  initialValue: string
  columns: number
  placeholder: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

/** Own Esc while the rest of the diff dialog's shortcuts are suspended. */
export function DiffSearchField({ initialValue, columns, placeholder, onSubmit, onCancel }: Props) {
  const [value, setValue] = useState(initialValue)
  const [cursor, setCursor] = useState(initialValue.length)
  useInput((_input, key, event) => {
    if (!key.escape) return
    event.stopImmediatePropagation()
    onCancel()
  })

  return <Box>
    <Text>/ </Text>
    <TextInput value={value} onChange={next => setValue(next.slice(0, 256))}
      onSubmit={onSubmit} onExit={onCancel} columns={Math.max(1, columns - 2)}
      cursorOffset={cursor} onChangeCursorOffset={setCursor} focus showCursor
      disableEscapeDoublePress placeholder={placeholder} />
  </Box>
}
