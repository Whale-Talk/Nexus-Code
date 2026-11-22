import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { z } from 'zod/v4'
import type { RequestRoute } from '../../services/api/provider/index.js'
import { DEEPSEEK_WEB_ORIGIN, dedicatedDeepSeekWebKey, requireDeepSeekWebKey } from '../../services/web/deepseekWeb.js'
import { searchDeepSeek, type SearchInput } from './deepseekSearch.js'
type Hit = { url: string; title: string; excerpt: string }

const hitList = z.object({ results: z.array(z.object({
  url: z.string(), title: z.string().nullish(), excerpts: z.array(z.string()).optional(),
  text: z.string().optional(), highlights: z.array(z.string()).optional(),
})) })

function readHits(value: unknown): Hit[] | undefined {
  const parsed = hitList.safeParse(value)
  if (!parsed.success) return undefined
  return parsed.data.results.map(hit => ({
    title: hit.title || hit.url, url: hit.url,
    excerpt: (hit.excerpts ?? hit.highlights)?.join(' ') || hit.text || '',
  }))
}

function hitsFromText(text: string): Hit[] | undefined {
  try {
    const hits = readHits(JSON.parse(text))
    if (hits) return hits
  } catch { /* Exa also returns plain-text records. */ }
  const hits = text.split(/\r?\n(?=Title: )/).flatMap(block => {
    const url = /^URL:[ \t]*(https?:\/\/[^\s]+)[ \t]*$/im.exec(block)?.[1]
    if (!url) return []
    const title = /^Title:[ \t]*([^\r\n]+)/im.exec(block)?.[1]?.trim() || url
    const excerpt = block.split(/\r?\n/).filter(line => !/^(?:Title|URL|Author|Published):/i.test(line)).join('\n').trim()
    return [{ title, url, excerpt }]
  })
  return hits.length ? hits : undefined
}

function includeHit(hit: Hit, input: SearchInput): boolean {
  let url: URL
  try { url = new URL(hit.url) } catch { return false }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  const matches = (domain: string) => {
    const name = domain.trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '')
    return Boolean(name) && (host === name || host.endsWith('.' + name))
  }
  return (!input.allowed_domains?.length || input.allowed_domains.some(matches)) && !input.blocked_domains?.some(matches)
}

/** Connect only when WebSearch is invoked. Search and inference credentials have separate owners. */
export async function searchWeb(input: SearchInput, parentSignal: AbortSignal, route?: RequestRoute) {
  const selected = process.env.NEXUS_SEARCH_PROVIDER?.trim() || 'auto'
  const provider = selected === 'auto'
    ? (route?.origin === DEEPSEEK_WEB_ORIGIN || dedicatedDeepSeekWebKey('search') ? 'deepseek' : 'exa')
    : selected
  if (provider === 'deepseek') {
    const hits = await searchDeepSeek(input, requireDeepSeekWebKey('search', route), parentSignal)
    return { hits: hits.filter(hit => includeHit(hit, input)), text: '' }
  }
  if (provider !== 'exa' && provider !== 'parallel') {
    throw new Error('NEXUS_SEARCH_PROVIDER 须为 auto、deepseek、exa 或 parallel。')
  }
  const isExa = provider === 'exa'
  const filtered = Boolean(input.allowed_domains?.length || input.blocked_domains?.length)
  const endpoint = new URL(isExa ? 'https://mcp.exa.ai/mcp' : 'https://search.parallel.ai/mcp')
  const tool = isExa ? (filtered ? 'web_search_advanced_exa' : 'web_search_exa') : 'web_search'
  if (isExa && filtered) endpoint.searchParams.set('tools', tool)
  const headers = new Headers()
  if (isExa && process.env.EXA_API_KEY) headers.set('x-api-key', process.env.EXA_API_KEY)
  if (!isExa && process.env.PARALLEL_API_KEY) headers.set('authorization', 'Bearer ' + process.env.PARALLEL_API_KEY)
  const args = isExa ? {
    query: input.query, numResults: 5,
    ...(input.allowed_domains?.length && { includeDomains: input.allowed_domains }),
    ...(input.blocked_domains?.length && { excludeDomains: input.blocked_domains }),
  } : {
    objective: input.query,
    search_queries: input.allowed_domains?.length
      ? input.allowed_domains.map(domain => input.query + ' site:' + domain)
      : [input.query],
  }
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(25_000)])
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers },
    fetch: (url, init) => {
      if (new URL(url instanceof Request ? url.url : String(url)).origin !== endpoint.origin) {
        throw new Error('Unexpected search service origin')
      }
      return fetch(url, { ...init, redirect: 'error', signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal })
    },
  })
  const client = new Client({ name: 'nexus-web-search', version: '1' })
  try {
    signal.throwIfAborted()
    await client.connect(transport, { signal })
    const result = await client.callTool({ name: tool, arguments: args }, undefined, { signal })
    if (result.isError) throw new Error('Search tool returned an error')
    const texts = Array.isArray(result.content)
      ? result.content.flatMap(block => block.type === 'text' && typeof block.text === 'string' ? [block.text] : [])
      : []
    const structured = readHits(result.structuredContent)
    const parsedLists = texts.map(hitsFromText).filter((hits): hits is Hit[] => hits !== undefined)
    const hits = (structured ?? parsedLists.flat()).filter(hit => includeHit(hit, input))
    return { hits, text: !filtered && structured === undefined && !parsedLists.length ? texts.join('\n\n') : '' }
  } catch {
    if (parentSignal.aborted) parentSignal.throwIfAborted()
    throw new Error(`${isExa ? 'Exa' : 'Parallel'} 搜索${signal.aborted ? '超时' : '失败'}，请检查搜索服务的连接或凭据后重试。`)
  } finally {
    try {
      if (transport.sessionId && !signal.aborted) await transport.terminateSession()
    } catch { /* Session cleanup is best-effort on unavailable search services. */ }
    finally { await client.close() }
  }
}
