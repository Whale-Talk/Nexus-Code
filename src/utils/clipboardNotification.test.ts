import { expect, test } from 'bun:test'
import { createClipboardNotification } from './clipboardNotification.js'

test('clipboard feedback counts visible characters including joined emoji', () => {
  expect(createClipboardNotification('a中👩‍💻', 'native')).toMatchObject({
    key: 'selection-copied',
    text: '已复制 3 个字符',
    timeoutMs: 2000,
  })
})

test('receipts distinguish tmux delivery from a terminal copy request', () => {
  expect(createClipboardNotification('中文', 'tmux-buffer')).toMatchObject({
    text: '已复制 2 个字符到 tmux 缓冲区',
  })
  expect(createClipboardNotification('中文', 'osc52')).toMatchObject({
    text: '已向终端发送复制请求（2 个字符）',
  })
})
