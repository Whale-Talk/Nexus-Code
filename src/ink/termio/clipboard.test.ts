import { expect, test } from 'bun:test'
import { setClipboardWithResult } from './osc.js'

test('a remote terminal request preserves the text without claiming a native write', async () => {
  const originalSSH = process.env.SSH_CONNECTION
  const originalTmux = process.env.TMUX
  process.env.SSH_CONNECTION = 'clipboard-test-session'
  delete process.env.TMUX
  try {
    const text = '中文\n👩‍💻'
    const { sequence, delivery } = await setClipboardWithResult(text)
    expect(sequence).toContain(`52;c;${Buffer.from(text, 'utf8').toString('base64')}`)
    expect(await delivery).toBe('osc52')
  } finally {
    if (originalSSH === undefined) delete process.env.SSH_CONNECTION
    else process.env.SSH_CONNECTION = originalSSH
    if (originalTmux === undefined) delete process.env.TMUX
    else process.env.TMUX = originalTmux
  }
})
