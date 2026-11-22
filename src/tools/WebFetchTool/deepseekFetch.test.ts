import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import axios from 'axios'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveProviderRoute, tagResponseRoute, type RequestRoute } from '../../services/api/provider/index.js'
import { WebFetchTool } from './WebFetchTool.js'
import { clearWebFetchCache, MAX_MARKDOWN_LENGTH } from './utils.js'

const deepSeekFetchURL = 'https://api.deepseek.com/v1/tools/fetch'
const publicPage = 'https://docs.python.org/3/library/pathlib.html'
const policyURL = 'https://policy.example.org/web'
const fixtureEnv = {
  NEXUS_CONFIG_DIR: '',
  NEXUS_FETCH_PROVIDER: 'auto',
  NEXUS_WEB_FETCH_POLICY_URL: '',
  DEEPSEEK_FETCH_API_KEY: '',
  DEEPSEEK_WEB_API_KEY: '',
  DEEPSEEK_SEARCH_API_KEY: 'fixture-search-only',
  NEXUS_API_KEY: 'fixture-global-only',
  NEXUS_BASE_URL: 'https://relay.example.org',
  OFFICIAL_MODEL_KEY: 'fixture-official-only',
  RELAY_MODEL_KEY: 'fixture-relay-only',
}

type Request = { url: string; method: string; headers: Headers; body?: unknown }
let directory: string
let previous: Record<string, string | undefined>
let requests: Request[]
let respond: (request: Request) => Response
let allowDomain: boolean
let cleanup: (() => void)[] = []

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'nexus-web-fetch-'))
  cleanup = []
  if (!Object.hasOwn(globalThis, 'MACRO')) {
    Object.defineProperty(globalThis, 'MACRO', { configurable: true, value: { VERSION: 'fixture' } })
    cleanup.push(() => { Reflect.deleteProperty(globalThis, 'MACRO') })
  }
  previous = Object.fromEntries(Object.keys(fixtureEnv).map(key => [key, process.env[key]]))
  Object.assign(process.env, fixtureEnv, { NEXUS_CONFIG_DIR: directory })
  clearWebFetchCache()
  requests = []
  allowDomain = true
  respond = request => {
    if (request.url !== deepSeekFetchURL) throw new Error('Unexpected fetch endpoint')
    return Response.json({ title: 'Library page', content: 'Fixture page body\n\n## Example\nA link to [the docs](https://docs.python.org/3/).' })
  }
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = {
      url: input instanceof globalThis.Request ? input.url : String(input),
      method: init?.method ?? 'GET', headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    }
    requests.push(request)
    return respond(request)
  }
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(fakeFetch, { preconnect: globalThis.fetch.preconnect }),
  )
  const savedAdapter = axios.defaults.adapter
  axios.defaults.adapter = async config => {
    const url = config.url ?? ''
    const method = config.method?.toUpperCase() ?? 'GET'
    requests.push({ url, method, headers: new Headers(config.headers.toJSON(true) as Record<string, string>) })
    const parsed = new URL(url)
    const response = { status: 200, statusText: 'OK', headers: {}, config }
    if (`${parsed.origin}${parsed.pathname}` === policyURL) {
      return { ...response, data: { can_fetch: allowDomain } }
    }
    if (url === publicPage) {
      return { ...response, headers: { 'content-type': 'text/markdown' }, data: Buffer.from('# Direct page') }
    }
    throw new Error('Unexpected direct request')
  }
  cleanup.push(() => fetchSpy.mockRestore(), () => { axios.defaults.adapter = savedAdapter })
})

afterEach(() => {
  for (const restore of cleanup) restore()
  cleanup = []
  clearWebFetchCache()
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(directory, { recursive: true, force: true })
})

function useChannels() {
  const model = { id: 'deepseek-flash' }
  writeFileSync(join(directory, 'models.json'), JSON.stringify({
    roles: { quark: 'relay::deepseek-flash', atom: 'official::deepseek-flash', electron: 'relay::deepseek-flash' },
    channels: {
      official: { protocol: 'messages', baseURL: 'https://api.deepseek.com/anthropic', apiKeyEnv: 'OFFICIAL_MODEL_KEY', models: [model] },
      relay: { protocol: 'messages', baseURL: 'https://relay.example.org/v1', apiKeyEnv: 'RELAY_MODEL_KEY', models: [model] },
    },
  }))
  return {
    official: resolveProviderRoute('official::deepseek-flash').source,
    relay: resolveProviderRoute('relay::deepseek-flash').source,
  }
}

function runFetch(route?: RequestRoute, url = publicPage) {
  const message = { model: 'deepseek-flash' }
  if (route) tagResponseRoute(message, route)
  return WebFetchTool.call(
    { url, prompt: 'Quote the example' },
    { abortController: new AbortController(), options: { mainLoopModel: 'quark', isNonInteractiveSession: true } } as Parameters<typeof WebFetchTool.call>[1],
    async () => { throw new Error('Unexpected second tool call') },
    { type: 'assistant', message: { ...message } },
  )
}

test('automatic reading uses the official caller’s key and returns page content without a second model request', async () => {
  delete process.env.NEXUS_FETCH_PROVIDER
  const { official } = useChannels()
  const { data } = await runFetch(official)
  expect(data.url).toBe(publicPage)
  expect(data.code).toBe(200)
  expect(data.result).toContain('Library page')
  expect(data.result).toContain('Fixture page body\n\n## Example\nA link to [the docs](https://docs.python.org/3/).')
  expect(requests.map(request => request.url)).toEqual([deepSeekFetchURL])
  expect(requests[0]!.method).toBe('POST')
  expect(requests[0]!.headers.get('authorization')).toBe('Bearer ' + fixtureEnv.OFFICIAL_MODEL_KEY)
  expect(requests[0]!.headers.get('x-api-key')).toBeNull()
  expect(requests[0]!.body).toEqual({ url: publicPage })
})

test.each(['auto', 'direct'])('%s direct reading preserves the policy check and uses no model credential', async mode => {
  process.env.NEXUS_FETCH_PROVIDER = mode
  process.env.NEXUS_WEB_FETCH_POLICY_URL = policyURL
  const { official, relay } = useChannels()
  // An explicit direct selection takes precedence even with an official caller and dedicated key.
  if (mode === 'direct') process.env.DEEPSEEK_FETCH_API_KEY = 'fixture-fetch-only'
  const { data } = await runFetch(mode === 'direct' ? official : relay)
  expect(data.result).toBe('# Direct page')
  expect(requests.map(request => request.url)).toEqual([policyURL + '?domain=docs.python.org', publicPage])
  expect(requests.every(request => request.method === 'GET' && !request.headers.has('authorization') && !request.headers.has('x-api-key'))).toBe(true)
})

test('direct reading without a policy is available for preapproved documentation only', async () => {
  const { relay } = useChannels()
  expect((await runFetch(relay)).data.result).toBe('# Direct page')
  await expect(runFetch(relay, 'https://unlisted.example.org/article')).rejects.toThrow(/NEXUS_WEB_FETCH_POLICY_URL/)
  expect(requests.map(request => request.url)).toEqual([publicPage])
})

test('dedicated fetch key takes precedence over the shared Web key and the official channel', async () => {
  process.env.DEEPSEEK_FETCH_API_KEY = 'fixture-fetch-only'
  process.env.DEEPSEEK_WEB_API_KEY = 'fixture-web-only'
  const { official, relay } = useChannels()
  await runFetch(official)
  process.env.NEXUS_FETCH_PROVIDER = 'deepseek'
  await runFetch(relay)
  delete process.env.DEEPSEEK_FETCH_API_KEY
  await runFetch(relay)
  expect(requests.map(request => request.url)).toEqual([deepSeekFetchURL, deepSeekFetchURL, deepSeekFetchURL])
  expect(requests.map(request => request.headers.get('authorization'))).toEqual([
    'Bearer fixture-fetch-only', 'Bearer fixture-fetch-only', 'Bearer fixture-web-only',
  ])
})

test('explicit DeepSeek reading cannot use a relay key or an independent search key', async () => {
  process.env.NEXUS_FETCH_PROVIDER = 'deepseek'
  const { relay } = useChannels()
  await expect(runFetch(relay)).rejects.toThrow(/DEEPSEEK_FETCH_API_KEY|DeepSeek/)
  expect(requests).toEqual([])
})

test('DeepSeek reading honours a configured denial before contacting the provider', async () => {
  process.env.NEXUS_WEB_FETCH_POLICY_URL = policyURL
  allowDomain = false
  const { official } = useChannels()
  await expect(runFetch(official)).rejects.toThrow()
  expect(requests.map(request => request.url)).toEqual([policyURL + '?domain=docs.python.org'])
})

test('reads a public page without sending the browser fragment and bounds returned page content', async () => {
  const { official } = useChannels()
  const longPage = 'a'.repeat(MAX_MARKDOWN_LENGTH)
  respond = () => Response.json({ title: 'Large page', content: longPage + 'discard this tail' })
  const { data } = await runFetch(official, publicPage + '#local-fragment')
  expect(data.result).toContain(longPage)
  expect(data.result).not.toContain('discard this tail')
  expect(requests.map(request => request.url)).toEqual([deepSeekFetchURL])
  expect(requests[0]!.body).toEqual({ url: publicPage })
})

test.each([
  ['loopback', 'http://127.0.0.1/private'],
  ['private IPv4', 'http://10.2.3.4/private'],
  ['metadata IP', 'http://169.254.169.254/private'],
  ['localhost', 'https://localhost/private'],
  ['IPv6 loopback', 'https://[::1]/private'],
  ['a URL with credentials', 'https://user:pass@example.org/private'],
  ['a file URL', 'file:///tmp/private.md'],
])('rejects %s before sending the URL to DeepSeek', async (_description, url) => {
  const { official } = useChannels()
  await expect(runFetch(official, url)).rejects.toThrow()
  expect(requests).toEqual([])
})

test.each([401, 429, 503])('DeepSeek reading failure %i never switches to direct or model inference', async status => {
  const { official } = useChannels()
  respond = () => new Response(null, { status })
  await expect(runFetch(official)).rejects.toThrow(/DeepSeek/)
  expect(requests.map(request => request.url)).toEqual([deepSeekFetchURL])
})
