import { expect, test } from 'bun:test'

// Use a fresh process because the renderer and Chalk cache capabilities at import time.
const probe = `
  import chalk from 'chalk'
  if (process.env.TEST_COLOR_TTY === '1') chalk.level = 3
  const { colorize } = await import('./colorize.ts')
  process.stdout.write(colorize('Nexus', '#ff3cac', 'foreground'))
`

function renderedText(noColor: string | undefined, force: string | undefined, tty: boolean) {
  const result = Bun.spawnSync([process.execPath, '-e', probe], {
    cwd: import.meta.dir,
    env: {
      ...process.env,
      TEST_COLOR_TTY: tty ? '1' : '0',
      NO_COLOR: noColor,
      FORCE_COLOR: force,
      TMUX: undefined,
      TERM_PROGRAM: undefined,
    },
  })
  expect(result.exitCode).toBe(0)
  return result.stdout.toString()
}

test('the terminal renderer honors an explicit monochrome preference on an RGB terminal', () => {
  expect(renderedText('1', undefined, true)).toBe('Nexus')
  expect(renderedText('', undefined, true)).toContain('\x1b[38;2;255;60;172m')
})

test('output can be explicitly colored and stays plain when redirected by default', () => {
  expect(renderedText('1', '3', true)).toContain('\x1b[38;2;255;60;172m')
  expect(renderedText(undefined, undefined, false)).toBe('Nexus')
})
