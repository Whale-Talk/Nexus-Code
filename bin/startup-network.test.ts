import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const model = 'deepseek-startup-fixture'
const key = 'fake-startup-regression-key'
const reply = 'NEXUS_STARTUP_LOCAL_REPLY'
const guard = join(import.meta.dir, 'fixtures', 'startup-network-guard.ts')

function modelResponse(stream: boolean) {
  const text = { type: 'text', text: reply }
  const message = {
    id: 'msg_fixture', type: 'message', role: 'assistant', model,
    content: [text], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 4 },
  }
  if (!stream) return Response.json(message)
  const events = [
    { type: 'message_start', message: { ...message, content: [], stop_reason: null } },
    { type: 'content_block_start', index: 0, content_block: { ...text, text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: message.usage },
    { type: 'message_stop' },
  ]
  return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

for (const entry of ['launcher', 'source'] as const) {
  test(`${entry}: legacy opt-in cannot restore official startup calls or send model credentials off-channel`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'nexus-startup-network-'))
    const config = join(root, '.nexus')
    const log = join(root, 'network.log')
    const calls: string[] = []
    const server = Bun.serve({
      hostname: '127.0.0.1', port: 0,
      async fetch(request) {
        const path = new URL(request.url).pathname
        calls.push(path)
        if (request.method !== 'POST' || path !== '/relay/v1/messages') return new Response(null, { status: 404 })
        const json = await request.json()
        if (json.model !== model || request.headers.get('x-api-key') !== key) {
          return new Response(null, { status: 403 })
        }
        return modelResponse(json.stream === true)
      },
    })
    let child: { kill(): void } | undefined
    try {
      mkdirSync(config)
      const connection = { NEXUS_BASE_URL: server.url.origin + '/relay', NEXUS_API_KEY: key, NEXUS_MODEL: model }
      writeFileSync(join(config, 'settings.json'), JSON.stringify({ env: connection, model }))
      writeFileSync(join(config, 'profile.json'), JSON.stringify({
        hasCompletedOnboarding: true,
        metricsStatusCache: { enabled: true, timestamp: Date.now() - 48 * 60 * 60 * 1000 },
      }))
      writeFileSync(join(root, 'bunfig.toml'), 'preload = [' + JSON.stringify(guard) + ']\n')
      // Whitelist the OS essentials instead of inheriting live provider credentials or telemetry switches.
      const env = {
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
        ComSpec: process.env.ComSpec, PATHEXT: process.env.PATHEXT,
        TEMP: root, TMP: root, HOME: root, USERPROFILE: root, APPDATA: root, LOCALAPPDATA: root,
        ...connection, NEXUS_CONFIG_DIR: config, BUN_BINARY: process.execPath,
        NEXUS_TEST_NETWORK_LOG: log, NEXUS_TEST_MODEL_ORIGIN: server.url.origin,
        HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1',
        ALL_PROXY: 'http://127.0.0.1:1', NO_PROXY: '127.0.0.1,localhost',
        NEXUS_DISABLE_AUTOUPDATER: '1', NEXUS_MAX_RETRIES: '0',
      }
      const cmd = entry === 'launcher'
        ? ['node', join(import.meta.dir, 'nexus.cjs')]
        : [process.execPath, 'run', join(import.meta.dir, '../src/dev-entry.ts')]
      const proc = Bun.spawn([...cmd, '-p', 'Reply OK.'], {
        cwd: root, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', timeout: 30_000,
      })
      child = proc
      proc.stdin.end()
      const [code, output, errors] = await Promise.all([
        proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text(),
      ])
      expect(code, errors).toBe(0)
      expect(output).toContain(reply)
      expect(calls.length).toBeGreaterThan(0)
      expect([...new Set(calls)]).toEqual(['/relay/v1/messages'])
      const [ready, ...denied] = readFileSync(log, 'utf8').trim().split('\n')
      expect(ready).toBe('guard-ready')
      const attempts = denied.map(line => JSON.parse(line) as { host: string; path: string; credentials: boolean })
      expect(attempts.filter(request => request.credentials ||
        /(^|\.)(anthropic\.com|claude\.ai|claude\.com)$/.test(request.host) ||
        request.path.startsWith('/api/claude'))).toEqual([])
    } finally {
      child?.kill()
      await server.stop(true)
      // Bun's Windows fs.rm can return EBUSY while handles from a just-exited CLI are closing.
      for (let attempt = 0; ; attempt++) {
        try {
          await rm(root, { recursive: true, force: true })
          break
        } catch (error) {
          if (attempt >= 25 || (error as NodeJS.ErrnoException).code !== 'EBUSY') throw error
          await Bun.sleep(200)
        }
      }
    }
  }, 40_000)
}
