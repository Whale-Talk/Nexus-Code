import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { updateModelChannelConnection } from '../../services/api/provider/catalog.js'
import { resolveProviderRoute, tagResponseRoute, type RequestRoute } from '../../services/api/provider/index.js'
import { getAtomModel } from '../../utils/model/model.js'
import { WebSearchTool } from './WebSearchTool.js'

const fixtureEnv = {
  NEXUS_CONFIG_DIR: '', NEXUS_BASE_URL: 'https://api.anthropic.com',
  NEXUS_PROVIDER: 'messages', NEXUS_API_KEY: 'fixture-generic-only', NEXUS_SEARCH_PROVIDER: 'auto',
  EXPLICIT_MODEL_KEY: 'fixture-model-only',
  OFFICIAL_MODEL_KEY: 'fixture-official-only', RELAY_MODEL_KEY: 'fixture-relay-only',
  DEEPSEEK_SEARCH_API_KEY: '',
  EXA_API_KEY: 'fixture-exa-only', PARALLEL_API_KEY: 'fixture-parallel-only',
}
let directory: string
let previous: Record<string, string | undefined>
let resetFetch: (() => void) | undefined
beforeEach(() => {
  resetFetch = undefined
  directory = mkdtempSync(join(tmpdir(), 'nexus-search-'))
  previous = Object.fromEntries(Object.keys(fixtureEnv).map(key => [key, process.env[key]]))
  Object.assign(process.env, fixtureEnv, { NEXUS_CONFIG_DIR: directory })
})
afterEach(() => {
  resetFetch?.()
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(directory, { recursive: true, force: true })
})

type Seen = { url: URL; headers: Headers; body: any; method: string }
function intercept(respond: (request: Seen) => Response) {
  const seen: Seen[] = []
  const fake = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = { url: new URL(input instanceof Request ? input.url : String(input)),
      headers: new Headers(init?.headers), method: init?.method || 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined }
    seen.push(request)
    return respond(request)
  }
  const spy = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(fake, { preconnect: globalThis.fetch.preconnect }),
  )
  resetFetch = () => spy.mockRestore()
  return seen
}

function runSearch(domains?: string[], route?: RequestRoute, blockedDomains?: string[]) {
  const message = { model: 'deepseek-flash' }
  if (route) tagResponseRoute(message, route)
  return WebSearchTool.call(
    { query: 'example query', allowed_domains: domains, blocked_domains: blockedDomains },
    { abortController: new AbortController(), options: { mainLoopModel: 'quark' } } as Parameters<typeof WebSearchTool.call>[1],
    async () => { throw new Error('unexpected second tool call') },
    { type: 'assistant', message: { ...message } },
    undefined,
  )
}

const officialChannel = {
  protocol: 'messages' as const, baseURL: 'https://api.deepseek.com/anthropic',
  apiKeyEnv: 'OFFICIAL_MODEL_KEY', models: [{ id: 'deepseek-flash' }],
}
function useDeepSeekChannels() {
  writeFileSync(join(directory, 'models.json'), JSON.stringify({
    roles: { quark: 'relay::deepseek-flash', atom: 'official::deepseek-flash', electron: 'relay::deepseek-flash' },
    channels: {
      official: officialChannel,
      relay: { ...officialChannel, baseURL: 'https://relay.example/v1', apiKeyEnv: 'RELAY_MODEL_KEY' },
    },
  }))
  return {
    official: resolveProviderRoute('official::deepseek-flash').source,
    relay: resolveProviderRoute('relay::deepseek-flash').source,
  }
}

function mcpSearchResponse({ body, method }: Seen, results: { title: string; url: string }[] = []): Response {
  if (method === 'GET') return new Response(null, { status: 405 })
  if (body.id === undefined) return new Response(null, { status: 202 })
  const result = body.method === 'initialize'
    ? { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
    : { content: [{ type: 'text', text: JSON.stringify({ results }) }] }
  return Response.json({ jsonrpc: '2.0', id: body.id, result })
}

const deepSeekSearchURL = 'https://api.deepseek.com/v1/tools/search'

test('explicit Claude inference sends the specified model and only its channel key to Messages', async () => {
  const model = 'claude-sonnet-fixture'
  writeFileSync(join(directory, 'models.json'), JSON.stringify({
    roles: { quark: 'local::main', atom: 'chosen::' + model, electron: 'local::main' },
    channels: {
      chosen: { protocol: 'messages', baseURL: 'https://api.anthropic.com', apiKeyEnv: 'EXPLICIT_MODEL_KEY', models: [{ id: model }] },
      local: { protocol: 'openai-compatible', baseURL: 'http://127.0.0.1:1/v1', models: [{ id: 'main' }] },
    },
  }))
  const requests = intercept(() => Response.json({ type: 'message', role: 'assistant', id: 'msg_fixture', model,
    content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }))
  const route = resolveProviderRoute(getAtomModel())
  const result = await route.adapter.generateText({ model: route.model, maxOutputTokens: 4, messages: [{ role: 'user', content: 'test' }] })
  expect(result.data.model).toBe(model)
  expect(requests.map(r => r.url.href)).toEqual(['https://api.anthropic.com/v1/messages'])
  expect(requests[0]!.headers.get('x-api-key')).toBe(fixtureEnv.EXPLICIT_MODEL_KEY)
  expect(requests[0]!.body.model).toBe(model)
})

test.each(['exa', 'parallel'])('%s search uses only the selected search server even with an official model configured', async provider => {
  process.env.NEXUS_SEARCH_PROVIDER = provider
  process.env.DEEPSEEK_SEARCH_API_KEY = 'unused-standalone-key'
  const { official } = useDeepSeekChannels()
  const requests = intercept(request => mcpSearchResponse(request, [
    { title: 'included', url: 'https://sub.example.org/a' }, { title: 'excluded', url: 'https://example.org.invalid/b' },
  ]))
  const response = await runSearch(['example.org'], official)
  expect(response.data.results).toMatchObject([{ content: [{ title: 'included' }] }])
  expect(new Set(requests.map(r => r.url.host))).toEqual(new Set([provider === 'exa' ? 'mcp.exa.ai' : 'search.parallel.ai']))
  for (const request of requests) {
    expect(request.headers.get('x-api-key')).toBe(provider === 'exa' ? fixtureEnv.EXA_API_KEY : null)
    expect(request.headers.get('authorization')).toBe(provider === 'parallel' ? 'Bearer ' + fixtureEnv.PARALLEL_API_KEY : null)
  }
})

test.each([429, 503])('search failure %i returns to the user without a fallback request', async status => {
  const requests = intercept(() => new Response(null, { status }))
  await expect(runSearch()).rejects.toThrow('Exa 搜索失败')
  expect(requests.map(r => r.url.host)).toEqual(['mcp.exa.ai'])
})

test('empty search results are returned without consulting the model', async () => {
  const requests = intercept(request => mcpSearchResponse(request))
  expect((await runSearch()).data.results).toMatchObject([{ content: [] }])
  expect(requests.every(r => r.url.origin === 'https://mcp.exa.ai')).toBe(true)
})

test('automatic search uses the official tool caller’s channel key instead of the primary model’s route', async () => {
  delete process.env.NEXUS_SEARCH_PROVIDER
  const { official, relay } = useDeepSeekChannels()
  const requests = intercept(request => request.url.href === deepSeekSearchURL
    ? Response.json({ results: [
      { title: 'first', url: 'https://a.example.org/1', snippet: 'short', summary: 'long summary' },
      { title: 'second', url: 'https://b.example.net/2', snippet: 'short excerpt' },
      { title: 'excluded', url: 'https://example.org.attacker.invalid/3', snippet: 'wrong domain' },
    ] })
    : mcpSearchResponse(request))

  const result = await runSearch(['example.org', 'example.net'], official)
  expect(result.data.results).toMatchObject([{ content: [
    { title: 'first', url: 'https://a.example.org/1', excerpt: 'long summary' },
    { title: 'second', url: 'https://b.example.net/2', excerpt: 'short excerpt' },
  ] }])
  expect(result.data.results[0]).toHaveProperty('content.length', 2)
  expect(requests.map(request => request.url.href)).toEqual([deepSeekSearchURL])
  expect(requests[0]!.method).toBe('POST')
  expect(requests[0]!.headers.get('authorization')).toBe('Bearer ' + fixtureEnv.OFFICIAL_MODEL_KEY)
  expect(requests[0]!.headers.get('x-api-key')).toBeNull()
  expect(requests[0]!.body).toEqual({ query: 'example query site:example.org OR site:example.net', count: 10 })

  // The relay advertises the exact same model ID. Its key stays at the relay.
  const requestCount = requests.length
  await runSearch(undefined, relay)
  const relaySearch = requests.slice(requestCount)
  expect(relaySearch.length).toBeGreaterThan(0)
  expect(relaySearch.every(request => request.url.origin === 'https://mcp.exa.ai')).toBe(true)
  expect(relaySearch.every(request => request.headers.get('authorization') === null)).toBe(true)
})

test.each(['auto', 'deepseek'])('%s uses the dedicated search key for a relay and excludes blocked results', async provider => {
  process.env.NEXUS_SEARCH_PROVIDER = provider
  process.env.DEEPSEEK_SEARCH_API_KEY = 'standalone-search-key'
  const { official, relay } = useDeepSeekChannels()
  const requests = intercept(() => Response.json({ results: [
    { title: 'blocked', url: 'https://sub.example.org/a', snippet: 'blocked' },
    { title: 'included', url: 'https://example.com/b', snippet: 'valid' },
  ] }))
  for (const caller of [relay, official]) {
    const result = await runSearch(undefined, caller, ['example.org'])
    expect(result.data.results).toMatchObject([{ content: [{ title: 'included' }] }])
    expect(result.data.results[0]).toHaveProperty('content.length', 1)
  }
  expect(requests.map(request => request.url.href)).toEqual([deepSeekSearchURL, deepSeekSearchURL])
  for (const request of requests) {
    expect(request.headers.get('authorization')).toBe('Bearer standalone-search-key')
    expect(request.body).toEqual({ query: 'example query -site:example.org', count: 10 })
  }
})

test('explicit DeepSeek search cannot reuse a relay key without a dedicated credential', async () => {
  process.env.NEXUS_SEARCH_PROVIDER = 'deepseek'
  const { relay } = useDeepSeekChannels()
  const requests = intercept(() => new Response(null, { status: 500 }))
  await expect(runSearch(undefined, relay)).rejects.toThrow(/DEEPSEEK_SEARCH_API_KEY/)
  expect(requests).toEqual([])
})

test('editing the caller’s official channel does not silently switch its pending search to another credential', async () => {
  const { official } = useDeepSeekChannels()
  updateModelChannelConnection('official', officialChannel, { ...officialChannel, apiKeyEnv: 'EXPLICIT_MODEL_KEY' })
  const requests = intercept(() => new Response(null, { status: 500 }))
  await expect(runSearch(undefined, official)).rejects.toThrow(/DeepSeek/)
  expect(requests).toEqual([])
})

test.each([401, 429])('DeepSeek search failure %i stays on the same endpoint', async status => {
  const { official } = useDeepSeekChannels()
  const requests = intercept(() => new Response(null, { status }))
  await expect(runSearch(undefined, official)).rejects.toThrow(/DeepSeek/)
  expect(requests.map(request => request.url.href)).toEqual([deepSeekSearchURL])
})
