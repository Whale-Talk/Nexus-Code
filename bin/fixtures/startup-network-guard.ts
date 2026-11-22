// Preloaded only by the isolated CLI startup regression.
import { appendFileSync } from 'node:fs'
import axios from 'axios'

const allowedOrigin = process.env.NEXUS_TEST_MODEL_ORIGIN!
const log = process.env.NEXUS_TEST_NETWORK_LOG!
appendFileSync(log, 'guard-ready\n')

function checkDestination(input: string, headers?: HeadersInit) {
  const url = new URL(input)
  if (url.origin !== allowedOrigin) {
    const credentials = [...new Headers(headers)].some(([name, value]) =>
      name === 'authorization' || name === 'x-api-key' || value.includes(process.env.NEXUS_API_KEY!),
    ) || input.includes(process.env.NEXUS_API_KEY!)
    // Never log headers, bodies, or query parameters.
    appendFileSync(log, JSON.stringify({ host: url.hostname, path: url.pathname, credentials }) + '\n')
    throw new Error('Outbound request denied by the startup test')
  }
}

axios.interceptors.request.use(config => {
  checkDestination(axios.getUri(config), config.headers.toJSON(true) as Record<string, string>)
  return config
})

const fetch = globalThis.fetch
globalThis.fetch = Object.assign((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  checkDestination(input instanceof Request ? input.url : String(input),
    init?.headers ?? (input instanceof Request ? input.headers : undefined))
  return fetch(input, { ...init, redirect: 'error' })
}, fetch)
