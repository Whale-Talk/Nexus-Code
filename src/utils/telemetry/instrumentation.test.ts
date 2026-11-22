import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// The telemetry SDK registers global providers. Run the real startup and flush
// in a fresh process so the user's environment and other tests can't select exporters.
const probe = `
  globalThis.MACRO = { VERSION: 'test' }
  const { default: axios } = await import('axios')
  const requests = []
  axios.defaults.adapter = async config => {
    requests.push(config.url)
    return { status: 200, data: { metrics_logging_enabled: true }, headers: {}, config }
  }
  globalThis.fetch = Object.assign(async input => {
    requests.push(String(input))
    throw new Error('Unexpected network request')
  }, { preconnect() {} })
  const signals = []
  console.dir = data => {
    if (data?.descriptor) signals.push(data.descriptor.name)
    if (data?.body) signals.push(data.body)
    if (data?.traceId && data?.name) signals.push(data.name)
  }
  const { enableConfigs } = await import('./src/utils/config.ts')
  const { getEventLogger, getTracerProvider } = await import('./src/bootstrap/state.ts')
  const { initializeTelemetry, flushTelemetry } = await import('./src/utils/telemetry/instrumentation.ts')
  enableConfigs()
  const meter = await initializeTelemetry()
  let collections = 0
  meter.createObservableGauge('nexus_reader_probe').addCallback(() => { collections++ })
  meter.createCounter('nexus_regression_count').add(1)
  getEventLogger()?.emit({ body: 'nexus_regression_log' })
  getTracerProvider()?.getTracer('regression').startSpan('nexus_regression_trace').end()
  await flushTelemetry()
  console.log(JSON.stringify({ requests, signals, collections }))
`

for (const privacySwitch of ['unset', 'enabled']) {
  for (const cachedOptIn of [false, true]) {
    test(`metrics startup and flush skip cloud requests (privacy switch ${privacySwitch}, legacy opt-in ${cachedOptIn})`, async () => {
      const result = await runProbe(privacySwitch, cachedOptIn, false)
      expect(result.requests).toEqual([])
      expect(result.signals).toEqual([])
      expect(result.collections).toBe(0)
    }, 30_000)
  }
}

test('explicit console metrics, logs and traces still export without sending a cloud request', async () => {
  const result = await runProbe('enabled', true, true)
  expect(result.requests).toEqual([])
  expect(result.collections).toBeGreaterThan(0)
  expect(result.signals.sort()).toEqual(['nexus_regression_count', 'nexus_regression_log', 'nexus_regression_trace'])
}, 30_000)

async function runProbe(privacySwitch: string, cachedOptIn: boolean, consoleExport: boolean) {
  const profile = mkdtempSync(join(tmpdir(), 'nexus-telemetry-test-'))
  try {
    writeFileSync(join(profile, 'profile.json'), JSON.stringify(cachedOptIn
      ? { metricsStatusCache: { enabled: true, timestamp: Date.now() } }
      : {}))
    const child = Bun.spawn([process.execPath, '--feature=ENHANCED_TELEMETRY_BETA', '-e', probe], {
      cwd: resolve(import.meta.dir, '../../..'),
      env: {
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        TEMP: profile, TMP: profile, HOME: profile, USERPROFILE: profile, APPDATA: profile, LOCALAPPDATA: profile,
        NEXUS_CONFIG_DIR: profile,
        NEXUS_API_KEY: 'synthetic-model-key', NEXUS_BASE_URL: 'http://127.0.0.1:1',
        ...(privacySwitch === 'enabled' && { NEXUS_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1' }),
        ...(consoleExport && {
          NEXUS_ENABLE_TELEMETRY: '1', NEXUS_ENHANCED_TELEMETRY_BETA: '1',
          OTEL_METRICS_EXPORTER: 'console', OTEL_LOGS_EXPORTER: 'console', OTEL_TRACES_EXPORTER: 'console',
        }),
      },
      stdout: 'pipe', stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ])
    if (code !== 0) throw new Error(stderr)
    return JSON.parse(stdout.trim()) as { requests: string[]; signals: string[]; collections: number }
  } finally {
    rmSync(profile, { recursive: true, force: true })
  }
}
