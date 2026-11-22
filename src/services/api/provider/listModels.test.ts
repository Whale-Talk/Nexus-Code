import { expect, spyOn, test } from 'bun:test'
import { fetchChannelModelIds, requiresModelDirectoryScope, type ModelDirectoryScope } from './listModels.js'

const signal = new AbortController().signal
const localChannel = { protocol: 'openai-compatible', baseURL: 'http://localhost:1234' } as const

test('model discovery queries the configured provider prefix with only the selected credentials', async () => {
  const saved = process.env.NEXUS_LIST_TEST_KEY
  process.env.NEXUS_LIST_TEST_KEY = 'synthetic-list-key'
  const seen: unknown[] = []
  const intercept = async (url: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    seen.push([String(url), headers.get('authorization'), headers.get('x-api-key'), init?.redirect, init?.credentials])
    return Response.json({ data: [{ id: 'faster' }, { id: 'stronger' }, { id: 'faster' }] })
  }
  const mock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(intercept, { preconnect: fetch.preconnect }))
  const key = { apiKeyEnv: 'NEXUS_LIST_TEST_KEY' }
  try {
    const listed = await fetchChannelModelIds({ protocol: 'messages', baseURL: 'https://api.deepseek.com/anthropic', ...key }, signal)
    expect(listed).toEqual(['faster', 'stronger'])
    await fetchChannelModelIds({ protocol: 'messages', baseURL: 'https://other.test/relay', ...key }, signal)
    await fetchChannelModelIds({ protocol: 'openai-compatible', baseURL: 'https://other.test/api/v4', ...key }, signal)
    await fetchChannelModelIds(localChannel, signal)
    await fetchChannelModelIds({ ...localChannel, ...key }, signal, 'new-channel-only')
    expect(seen).toEqual([
      ['https://api.deepseek.com/models', 'Bearer synthetic-list-key', null, 'manual', 'omit'],
      ['https://other.test/relay/v1/models', null, 'synthetic-list-key', 'manual', 'omit'],
      ['https://other.test/api/v4/models', 'Bearer synthetic-list-key', null, 'manual', 'omit'],
      ['http://localhost:1234/v1/models', null, null, 'manual', 'omit'],
      ['http://localhost:1234/v1/models', 'Bearer new-channel-only', null, 'manual', 'omit'],
    ])
    delete process.env.NEXUS_LIST_TEST_KEY
    await expect(fetchChannelModelIds({ ...localChannel, ...key }, signal)).rejects.toThrow(/密钥环境变量/)
    expect(seen).toHaveLength(5)
  } finally {
    mock.mockRestore()
    if (saved === undefined) delete process.env.NEXUS_LIST_TEST_KEY
    else process.env.NEXUS_LIST_TEST_KEY = saved
  }
})

test('official Messages channels query only their published same-origin model directory', async () => {
  const routes: readonly (readonly [string, string, ModelDirectoryScope?])[] = [
    ['https://open.bigmodel.cn/api/anthropic', '/api/coding/paas/v4/models', 'glm-coding-plan'],
    ['https://open.bigmodel.cn/api/anthropic', '/api/paas/v4/models', 'glm-api'],
    ['https://api.z.ai/api/anthropic/v1/', '/api/coding/paas/v4/models', 'glm-coding-plan'],
    ['https://api.kimi.com/coding/', '/coding/v1/models'],
    ['https://api.kimi.ai/coding/v1', '/coding/v1/models'],
    ['https://api.moonshot.cn/anthropic', '/v1/models'],
    ['https://api.moonshot.ai/anthropic', '/v1/models'],
    ['https://api.xiaomimimo.com/anthropic/v1', '/v1/models'],
    ['https://token-plan-cn.xiaomimimo.com/anthropic', '/v1/models'],
    ['https://token-plan-sgp.xiaomimimo.com/anthropic', '/v1/models'],
    ['https://token-plan-ams.xiaomimimo.com/anthropic', '/v1/models'],
  ] as const
  const seen: unknown[] = []
  const intercept = async (url: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    seen.push([String(url), headers.get('authorization'), headers.get('x-api-key')])
    return Response.json({ data: [{ id: 'example-model' }] })
  }
  const mock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(intercept, { preconnect: fetch.preconnect }))
  const credential = 'synthetic-channel-key'
  try {
    const glm = { baseURL: 'https://open.bigmodel.cn/api/anthropic', protocol: 'messages' } as const
    expect(requiresModelDirectoryScope(glm)).toBe(true)
    await expect(fetchChannelModelIds(glm, signal, credential)).rejects.toThrow(/选择此 GLM 渠道的密钥类型/)
    expect(seen).toHaveLength(0)
    for (const [baseURL, , scope] of routes) {
      expect(await fetchChannelModelIds({ baseURL, protocol: 'messages' }, signal, credential, scope)).toEqual(['example-model'])
    }
    const thirdParty = 'https://token-plan-cn.xiaomimimo.com.relay.test/anthropic'
    const differentPath = 'https://open.bigmodel.cn/relay/api/anthropic'
    await fetchChannelModelIds({ baseURL: thirdParty, protocol: 'messages' }, signal, credential)
    await fetchChannelModelIds({ baseURL: differentPath, protocol: 'messages' }, signal, credential)
    await fetchChannelModelIds({ baseURL: 'https://open.bigmodel.cn/api/paas/v4', protocol: 'openai-compatible' }, signal, credential)
    expect(seen).toEqual([
      ...routes.map(([base, path]) => [new URL(path, base).href, `Bearer ${credential}`, null]),
      [`${thirdParty}/v1/models`, null, credential],
      [`${differentPath}/v1/models`, null, credential],
      ['https://open.bigmodel.cn/api/paas/v4/models', `Bearer ${credential}`, null],
    ])
  } finally {
    mock.mockRestore()
  }
})

test('GLM HTTP 200 authentication business errors are reported without returning provider text', async () => {
  let reply: unknown = { code: 1001, msg: 'private provider response', success: false }
  const intercept = async () => Response.json(reply)
  const mock = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(intercept, { preconnect: fetch.preconnect }))
  const glm = { baseURL: 'https://open.bigmodel.cn/api/paas/v4', protocol: 'openai-compatible' } as const
  try {
    await expect(fetchChannelModelIds(glm, signal)).rejects.toThrow('渠道鉴权失败（代码 1001），请核对密钥类型和模型列表权限')
    reply = { data: [], error: { code: '1220', message: 'private provider response' } }
    await expect(fetchChannelModelIds(glm, signal)).rejects.toThrow('渠道鉴权失败（代码 1220），请核对密钥类型和模型列表权限')
  } finally {
    mock.mockRestore()
  }
})

test('model discovery ignores remote URLs, pins pagination and never follows redirects', async () => {
  let redirected = 0
  const secondary = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => {
    redirected++
    return Response.json({ data: [{ id: 'wrong' }] })
  } })
  const paths: string[] = []
  const primary = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: req => {
    const url = new URL(req.url)
    paths.push(url.pathname + url.search)
    if (url.pathname.startsWith('/redirect/')) return Response.redirect(secondary.url.href, 307)
    if (url.searchParams.has('after_id')) return Response.json({ data: [{ id: 'two' }], has_more: false })
    return Response.json({ data: [{ id: 'one' }], has_more: true, last_id: 'one', next: secondary.url.href })
  } })
  try {
    expect(await fetchChannelModelIds({ ...localChannel, baseURL: primary.url.href }, signal)).toEqual(['one', 'two'])
    await expect(fetchChannelModelIds({ ...localChannel, baseURL: new URL('/redirect', primary.url).href }, signal)).rejects.toThrow(/重定向/)
    expect(paths).toEqual(['/v1/models', '/v1/models?after_id=one', '/redirect/models'])
    expect(redirected).toBe(0)
  } finally {
    primary.stop(true)
    secondary.stop(true)
  }
})

test('model discovery reports safe actionable HTTP errors, malformed results and cancellation', async () => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: req => {
    const path = new URL(req.url).pathname
    if (path.startsWith('/404/')) return new Response('private provider response', { status: 404 })
    if (path.startsWith('/401/')) return new Response('private provider response', { status: 401 })
    if (path.startsWith('/bad/')) return Response.json({ data: [{ id: '\x1b[31mred' }] })
    return new Response('private provider response')
  } })
  const channel = (path: string) => ({ ...localChannel, baseURL: new URL(path, server.url).href })
  try {
    await expect(fetchChannelModelIds(channel('/404'), signal)).rejects.toThrow('渠道未提供模型列表（HTTP 404），可以手动填写模型 ID')
    await expect(fetchChannelModelIds(channel('/401'), signal)).rejects.toThrow('渠道拒绝访问（HTTP 401），请核对密钥和模型列表权限')
    await expect(fetchChannelModelIds(channel('/bad'), signal)).rejects.toThrow(/格式无效/)
    await expect(fetchChannelModelIds(channel('/invalid-json'), signal)).rejects.toThrow(/有效的 JSON/)
    await expect(fetchChannelModelIds(channel('/cancel'), AbortSignal.abort())).rejects.toThrow(/已取消/)
    const timer = spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort())
    try {
      await expect(fetchChannelModelIds(channel('/timeout'), signal)).rejects.toThrow(/超时/)
      expect(timer).toHaveBeenCalledWith(10_000)
    } finally {
      timer.mockRestore()
    }
  } finally {
    server.stop(true)
  }
})
