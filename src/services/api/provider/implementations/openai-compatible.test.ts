import { describe, expect, test } from 'bun:test'
import type { ModelRequest } from '../types.js'
import {
  createOpenAICompatibleAdapter,
  normalizeOpenAICompatibleBaseURL,
} from './openai-compatible.js'

describe('normalizeOpenAICompatibleBaseURL', () => {
  test('裸域名自动补 /v1（relay 场景）', () => {
    expect(normalizeOpenAICompatibleBaseURL('https://api.deepseek.com')).toBe(
      'https://api.deepseek.com/v1/',
    )
    expect(normalizeOpenAICompatibleBaseURL('https://api.deepseek.com/')).toBe(
      'https://api.deepseek.com/v1/',
    )
  })

  test('含 API 版本段的路径原样使用（智谱直连）', () => {
    expect(normalizeOpenAICompatibleBaseURL('https://open.bigmodel.cn/api/paas/v4')).toBe(
      'https://open.bigmodel.cn/api/paas/v4/',
    )
  })

  test('自定义路径原样使用，不追加 /v1', () => {
    expect(normalizeOpenAICompatibleBaseURL('https://relay.example.com/openai')).toBe(
      'https://relay.example.com/openai/',
    )
  })

  test('Ollama 本地端口补 /v1', () => {
    expect(normalizeOpenAICompatibleBaseURL('http://localhost:11434')).toBe(
      'http://localhost:11434/v1/',
    )
  })
})

describe('createOpenAICompatibleAdapter', () => {
  test('可正常创建适配器', () => {
    const adapter = createOpenAICompatibleAdapter({
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'test-key',
      name: 'zhipu-test',
    } as never)
    expect(typeof adapter.streamText).toBe('function')
    expect(typeof adapter.generateText).toBe('function')
  })
})

const chatCases = [
  { baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-v4-pro', mode: 'off', thinking: 'disabled' },
  { baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-flash', mode: 'adaptive', thinking: 'enabled',
    requested: 'medium', effort: 'high' },
  { baseURL: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.2', mode: 'off', thinking: 'disabled', requested: 'max' },
  { baseURL: 'https://api.z.ai/api/coding/paas/v4', model: 'glm-5.2', mode: 'adaptive', thinking: 'enabled',
    requested: 'low', effort: 'high' },
  { baseURL: 'https://api.z.ai/api/paas/v4', model: 'glm-5.3-flash', mode: 'off', requested: 'low', effort: 'low' },
  { baseURL: 'https://api.moonshot.cn/v1', model: 'kimi-k3', mode: 'off', requested: 'max', effort: 'max' },
  { baseURL: 'https://api.moonshot.ai/v1', model: 'kimi-k2.6', mode: 'off', thinking: 'disabled' },
  { baseURL: 'https://token-plan-sgp.xiaomimimo.com/v1', model: 'mimo-v2.6-pro', mode: 'adaptive',
    thinking: 'enabled', requested: 'high' },
  { baseURL: 'https://api.xiaomimimo.com/v1', model: 'mimo-v2.6-flash', mode: 'off', thinking: 'disabled' },
  { baseURL: 'https://api.deepseek.com.relay.example/v1', model: 'deepseek-flash', mode: 'off' },
  { baseURL: 'https://relay.example/v1', model: 'mimo-v2.6-pro', mode: 'off', thinking: 'disabled',
    dialect: 'mimo' },
] as const

for (const fixture of chatCases) {
  test(`Chat Completions sends documented ${fixture.model} parameters for ${fixture.baseURL} (${fixture.mode})`, async () => {
    const bodies: Record<string, unknown>[] = []
    const transport = Object.assign(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      bodies.push(body)
      const metadata = { id: 'chat-1', model: fixture.model, created: 1 }
      if (!body.stream) {
        return Response.json({ ...metadata, object: 'chat.completion',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'answer' } }] })
      }
      const chunks = [
        { index: 0, delta: { role: 'assistant', content: 'answer' } },
        { index: 0, delta: {}, finish_reason: 'stop' },
      ].map(choice => ({ ...metadata, object: 'chat.completion.chunk', choices: [choice] }))
      return new Response(chunks.map(chunk => 'data: ' + JSON.stringify(chunk) + '\n\n').join('') + 'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } })
    }, globalThis.fetch)
    const adapter = createOpenAICompatibleAdapter({ baseURL: fixture.baseURL, apiKey: 'test-only', fetch: transport })
    const request: ModelRequest = {
      model: fixture.model, messages: [{ role: 'user', content: 'sample' }], maxOutputTokens: 100,
      reasoning: { mode: fixture.mode },
      ...('requested' in fixture ? { effort: fixture.requested } : {}),
      ...('dialect' in fixture ? { reasoningDialect: fixture.dialect } : {}),
    }
    await adapter.generateText(request)
    await Array.fromAsync(await adapter.streamText(request))
    expect(bodies.length).toBe(2)
    for (const body of bodies) {
      expect(body.thinking).toEqual('thinking' in fixture ? { type: fixture.thinking } : undefined)
      expect(body.reasoning_effort).toBe('effort' in fixture ? fixture.effort : undefined)
    }
  })
}
