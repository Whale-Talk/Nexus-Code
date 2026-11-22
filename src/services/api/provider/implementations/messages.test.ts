import { expect, test } from 'bun:test'
import type { ModelRequest } from '../types.js'
import { createMessagesAdapter } from './messages.js'

const baseRequest: ModelRequest = {
  model: 'provider/CaseSensitive-42', maxOutputTokens: 512,
  messages: [{ role: 'user', content: 'start' }],
}
const usage = { input_tokens: 3, output_tokens: 2, cache_read_input_tokens: 1 }

test('Messages encodes tools and reasoning and preserves the channel conversation on the next turn', async () => {
  const bodies: any[] = []
  const headers: Headers[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    async fetch(req) {
      expect(new URL(req.url).pathname).toBe('/relay/v1/messages')
      const body = await req.json()
      bodies.push(body); headers.push(req.headers)
      return Response.json({
        id: 'msg-' + bodies.length, type: 'message', role: 'assistant', model: body.model, usage,
        content: [
          { type: 'thinking', thinking: 'inspect', signature: 'signature' },
          { type: 'tool_use', id: 'call-42', name: 'read', input: { id: 42 } },
        ], stop_reason: 'tool_calls', stop_sequence: null,
      }, { headers: { 'request-id': 'r-42' } })
    },
  })
  const previous = process.env.NEXUS_CONVERSATION_ID
  process.env.NEXUS_CONVERSATION_ID = 'local-test-session'
  try {
    const adapter = createMessagesAdapter({ baseURL: server.url.origin + '/relay/', apiKey: 'fixture-only' })
    const result = await adapter.generateText({
      ...baseRequest, system: [{ text: 'local', cache_control: { type: 'ephemeral' } }],
      tools: [{ type: 'custom', name: 'read', description: 'read', input_schema: { type: 'object' } }],
      toolChoice: { type: 'auto' }, stopSequences: ['stop'], effort: 'high',
      reasoning: { mode: 'budget', tokens: 2000 }, temperature: 0,
    })
    expect(result.requestId).toBe('r-42')
    expect(result.data.stop_reason).toBe('tool_use')
    expect(result.data.usage).toEqual(usage)
    expect(bodies[0]).toEqual({
      model: baseRequest.model, messages: baseRequest.messages, max_tokens: 512, stream: false,
      system: [{ type: 'text', text: 'local', cache_control: { type: 'ephemeral' } }],
      tools: [{ name: 'read', description: 'read', input_schema: { type: 'object' } }],
      tool_choice: { type: 'auto' }, stop_sequences: ['stop'], thinking: { type: 'enabled', budget_tokens: 511 },
      output_config: { effort: 'high' },
    })
    expect(headers[0]!.get('x-api-key')).toBe('fixture-only')
    expect(headers[0]!.get('anthropic-version')).toBe('2023-06-01')
    expect(headers[0]!.get('x-parent-message-id')).toBeNull()
    const reasoning = { type: 'thinking' as const, thinking: 'inspect', signature: 'signature' }
    const tool = { type: 'tool_use' as const, id: 'call-42', name: 'read', input: { id: 42 } }
    const toolResult = { type: 'tool_result' as const, tool_use_id: 'call-42', content: 'ok' }
    await adapter.generateText({
      ...baseRequest, userId: 'explicit-id', reasoning: { mode: 'off' },
      messages: [...baseRequest.messages,
        { role: 'assistant', content: [reasoning, tool] },
        { role: 'user', content: [{ type: 'text', text: 'continue' }, toolResult] }],
    })
    expect(bodies[1].messages.slice(1)).toEqual([
      { role: 'assistant', content: [reasoning,tool] },
      { role: 'user', content: [toolResult, { type: 'text', text: 'continue' }] },
    ])
    expect(bodies[1].metadata).toEqual({ user_id: 'explicit-id' })
    expect(bodies[1].thinking).toEqual({ type: 'disabled' })
    expect(headers[1]!.get('x-parent-message-id')).toBe('msg-1')
  } finally {
    if (previous === undefined) delete process.env.NEXUS_CONVERSATION_ID
    else process.env.NEXUS_CONVERSATION_ID = previous
    await server.stop(true)
  }
})

test('Messages reads fragmented SSE, thinking signatures, tool calls, and usage in order', async () => {
  const message = { id: 's1', model: baseRequest.model, type: 'message', role: 'assistant', content: [], usage }
  const frames = [
    { type: 'ping' },
    { type: 'message_start', message },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '检查' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'abc' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'call-1', name: 'read', input: {} } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"id":1}' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_calls' }, usage: { output_tokens: 7 } },
    { type: 'message_stop' },
  ]
  const bytes = new TextEncoder().encode(frames.map(value => 'data: ' + JSON.stringify(value) + '\r\n\r\n').join(''))
  let remaining = bytes
  const server = Bun.serve({ hostname:'127.0.0.1',port:0, fetch() {
    return new Response(new ReadableStream({
      pull(controller) {
        if (!remaining.length) return controller.close()
        controller.enqueue(remaining.slice(0, 3)); remaining = remaining.slice(3)
      },
    }), { headers: { 'content-type':'text/event-stream', 'request-id':'sse-request' } })
  } })
  try {
    const stream = await createMessagesAdapter({ baseURL: server.url.href, apiKey:'fake' }).streamText(baseRequest)
    expect((await stream.metadata).requestID).toBe('sse-request')
    const events = await Array.fromAsync(stream)
    expect<readonly string[]>(events.map(e => e.type)).toEqual(frames.slice(1).map(e => e.type))
    expect<unknown>(events[2]).toEqual(frames[3])
    expect<unknown>(events[3]).toEqual(frames[4])
    expect<unknown>(events[6]).toEqual(frames[7])
    expect(events.at(-2)).toMatchObject({ type:'message_delta', delta:{stop_reason:'tool_use'}, usage:{output_tokens:7} })
  } finally { await server.stop(true) }
})

const officialCases = [
  { baseURL: 'https://api.deepseek.com/anthropic', model: 'deepseek-flash',
    disabled: { type: 'disabled' }, enabled: { type: 'enabled' }, effort: 'high', tokenHeader: 'x-api-key' },
  { baseURL: 'https://api.moonshot.ai/anthropic', model: 'kimi-k3.1-pro',
    disabled: undefined, enabled: undefined, effort: 'high', always: true, tokenHeader: 'authorization' },
  { baseURL: 'https://api.xiaomimimo.com/anthropic', model: 'mimo-v2.6-pro',
    disabled: { type: 'disabled' }, enabled: { type: 'enabled' }, effort: undefined, tokenHeader: 'authorization' },
  { baseURL: 'https://open.bigmodel.cn/api/anthropic', model: 'glm-5.3',
    disabled: undefined, enabled: undefined, effort: undefined, always: true, tokenHeader: 'x-api-key' },
] as const

for (const fixture of officialCases) {
  test(`Messages applies ${fixture.model} controls to both request paths`, async () => {
    const requests: { body: Record<string, unknown>; headers: Headers }[] = []
    const transport = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(fixture.baseURL + '/v1/messages')
      const body = JSON.parse(String(init?.body))
      requests.push({ body, headers: new Headers(init?.headers) })
      const message = { id: 'sample', type: 'message', role: 'assistant', model: fixture.model, content: [], usage }
      if (!body.stream) return Response.json(message)
      const events = [{ type: 'message_start', message }, { type: 'message_stop' }]
      return new Response(events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join(''),
        { headers: { 'content-type': 'text/event-stream' } })
    }, globalThis.fetch)
    const adapter = createMessagesAdapter({ baseURL: fixture.baseURL, apiKey: 'test-only', fetch: transport })
    const request = { ...baseRequest, model: fixture.model, effort: 'medium', temperature: 0.5 } as const
    await adapter.generateText({ ...request, reasoning: { mode: 'off' } })
    await Array.fromAsync(await adapter.streamText({ ...request, reasoning: { mode: 'budget', tokens: 256 } }))
    const [off, on] = requests
    expect(off!.body.thinking).toEqual(fixture.disabled)
    expect(on!.body.thinking).toEqual(fixture.enabled)
    expect(off!.body.output_config).toEqual('always' in fixture && fixture.effort ? { effort: fixture.effort } : undefined)
    expect(on!.body.output_config).toEqual(fixture.effort ? { effort: fixture.effort } : undefined)
    expect(off!.headers.get(fixture.tokenHeader)).toBe(fixture.tokenHeader === 'authorization' ? 'Bearer test-only' : 'test-only')
    expect(off!.headers.get(fixture.tokenHeader === 'authorization' ? 'x-api-key' : 'authorization')).toBeNull()
    expect(on!.body.temperature).toBeUndefined()
  })
}
