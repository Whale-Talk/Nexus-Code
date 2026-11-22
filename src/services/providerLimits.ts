import type { APIError } from './api/provider/errors.js'

export type ProviderLimits = { model: string; status: 'allowed' | 'rejected'; resetsAt?: number }
const limited = new Map<string, ProviderLimits>()
export const statusListeners = new Set<(limits: ProviderLimits) => void>()

/** RFC 9110 Retry-After permits a delay in seconds or an HTTP date. */
export function retryAfterMilliseconds(value: string | null | undefined, now = Date.now()): number | null {
  if (!value?.trim()) return null
  const text = value.trim()
  const ms = /^\d+$/.test(text) ? Number(text) * 1000 :
    /^[A-Za-z]/.test(text) ? Date.parse(text) - now : NaN
  return Number.isFinite(ms) ? Math.max(0, ms) : null
}

export function recordModelRateLimit(error: APIError, model: string): void {
  if (error.status !== 429) return
  const delay = retryAfterMilliseconds(error.headers?.get('retry-after'))
  const resetsAt = delay === null ? undefined : Math.ceil((Date.now() + delay) / 1000)
  const prev = limited.get(model)
  if (prev && prev.resetsAt === resetsAt) return
  const next: ProviderLimits = { model, status: 'rejected', ...(resetsAt !== undefined && { resetsAt }) }
  limited.set(model, next)
  for (const listener of statusListeners) listener(next)
}

export function markModelRequestSucceeded(model: string): void {
  if (limited.delete(model)) {
    for (const listener of statusListeners) listener({ model, status: 'allowed' })
  }
}

export function getModelRateLimit(model: string): ProviderLimits | undefined {
  const entry = limited.get(model)
  if (!entry || (entry.resetsAt !== undefined && entry.resetsAt <= Date.now() / 1000)) return undefined
  return entry
}
