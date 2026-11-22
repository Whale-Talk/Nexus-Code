import { expect, test } from 'bun:test'
import { APIError } from './api/provider/errors.js'
import { getModelRateLimit, markModelRequestSucceeded, recordModelRateLimit, retryAfterMilliseconds, statusListeners, type ProviderLimits } from './providerLimits.js'

test('rate limits are scoped to the channel/model and successive successful requests clear them', () => {
  const model = 'alpha::shared'
  const other = 'beta::shared'
  const changes: ProviderLimits[] = []
  const listener = (limits: ProviderLimits) => { changes.push(limits) }
  statusListeners.add(listener)
  try {
    const e = new APIError(429, {}, '', new Headers({ 'retry-after': '30' }))
    recordModelRateLimit(e, model)
    expect(getModelRateLimit(model)?.resetsAt).toBeGreaterThan(Date.now() / 1000)
    expect(getModelRateLimit(other)).toBeUndefined()
    markModelRequestSucceeded(other)
    expect(changes).toHaveLength(1)
    markModelRequestSucceeded(model)
    expect(getModelRateLimit(model)).toBeUndefined()
    expect(changes.map(event => [event.model, event.status])).toEqual([[model, 'rejected'], [model, 'allowed']])
  } finally {
    statusListeners.delete(listener)
    markModelRequestSucceeded(model)
  }
})

test('Retry-After accepts delay seconds and HTTP dates and ignores invalid values', () => {
  const start = Date.UTC(2025, 0, 1)
  expect(retryAfterMilliseconds('20', start)).toBe(20_000)
  expect(retryAfterMilliseconds(new Date(start + 60_000).toUTCString(), start)).toBe(60_000)
  expect(retryAfterMilliseconds(new Date(start - 1000).toUTCString(), start)).toBe(0)
  expect(retryAfterMilliseconds('23oops', start)).toBeNull()
  expect(retryAfterMilliseconds('-10', start)).toBeNull()
  expect(retryAfterMilliseconds(null, start)).toBeNull()
})
