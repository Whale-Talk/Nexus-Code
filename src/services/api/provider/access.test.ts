import { expect, spyOn, test } from 'bun:test'
import { AuthenticationError } from './errors.js'
import { createMessagesAdapter } from './implementations/messages.js'
import { createOpenAICompatibleAdapter } from './implementations/openai-compatible.js'
import type { ModelRequest, StreamResponse } from './types.js'

const request: ModelRequest = {
  model: 'example',
  messages: [{ role: 'user', content: 'Hello' }],
  maxOutputTokens: 8,
}

for (const [name, create] of [
  ['messages', createMessagesAdapter],
  ['openai-compatible', createOpenAICompatibleAdapter],
] as const) {
  test(`${name} preserves the status and hides rejected credentials in both request modes`, async () => {
    let status = 401
    let calls = 0
    const echoedKey = 'test-value-echoed-by-upstream'
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        calls++
        return Response.json(
          { error: { type: 'authentication_error', message: echoedKey } },
          { status, headers: { 'request-id': 'test-request' } },
        )
      },
    })
    try {
      const adapter = create({ name, baseURL: server.url.href, apiKey: echoedKey })
      for (status of [401, 403]) {
        const consumeStream = async () => {
          const stream = await adapter.streamText(request)
          for await (const _ of stream) { /* consume until the request error */ }
        }
        for (const run of [() => adapter.generateText(request), consumeStream]) {
          const error = await run().then(() => undefined, (err: unknown) => err)
          expect(error).toBeInstanceOf(AuthenticationError)
          expect(error).toMatchObject({ status, requestID: 'test-request' })
          expect((error as Error).message).not.toContain(echoedKey)
        }
      }
      expect(calls).toBe(4)
    } finally {
      await server.stop(true)
    }
  })

  test.each(['network', 'validation', 'abort'])(`${name} settles header and event readers on %s failure`, async cause => {
    // A system proxy can return real HTTP 502 headers even for a closed loopback port.
    const transport = spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network connection failed'))
    try {
      const adapter = create({ name, baseURL: 'http://127.0.0.1', apiKey: 'test' })
      const signal = new AbortController()
      let stream: StreamResponse & { metadata: Promise<unknown> }
      try {
        stream = await adapter.streamText(
          cause === 'validation' ? { ...request, maxOutputTokens: -1 } : request,
          signal.signal,
        ) as typeof stream
      } catch (error) {
        // Some adapters validate options eagerly, before returning a stream.
        expect(cause).toBe('validation')
        expect((error as Error).message).toContain('maxOutputTokens')
        return
      }
      if (cause === 'abort') signal.abort()
      const events = (async () => { for await (const _ of stream) { /* drain */ } })()
      const results = await Promise.allSettled([events, stream.metadata])
      expect(results.map(result => result.status)).toEqual(['rejected', 'rejected'])
      if (cause === 'network') expect(transport).toHaveBeenCalled()
    } finally {
      transport.mockRestore()
    }
  })
}
