import type { Notification } from '../context/notifications.js'
import type { ClipboardPath } from '../ink/termio/osc.js'
import { getGraphemeSegmenter } from './intl.js'

export function createClipboardNotification(text: string, path: ClipboardPath): Notification {
  let count = 0
  for (const _ of getGraphemeSegmenter().segment(text)) count++

  const messages = {
    native: `已复制 ${count} 个字符`,
    'tmux-buffer': `已复制 ${count} 个字符到 tmux 缓冲区`,
    osc52: `已向终端发送复制请求（${count} 个字符）`,
  }
  return {
    key: 'selection-copied',
    text: messages[path],
    color: 'suggestion',
    priority: 'immediate',
    timeoutMs: path === 'native' ? 2000 : 4000,
  }
}
