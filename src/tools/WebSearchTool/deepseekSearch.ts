import { z } from 'zod/v4'
import { requestDeepSeekWeb } from '../../services/web/deepseekWeb.js'
const responseSchema = z.object({ results: z.array(z.object({
  title: z.string(), url: z.string(), summary: z.string().optional(), snippet: z.string().optional(),
})) })

export type SearchInput = { query: string; allowed_domains?: string[]; blocked_domains?: string[] }

function siteOperators(domains: string[] | undefined, prefix: 'site:' | '-site:'): string[] {
  return (domains ?? []).map(raw => {
    const domain = raw.trim().toLowerCase().replace(/^\*\./, '').replace(/\.$/, '')
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
      throw new Error('DeepSeek 搜索的域名限制需要域名，例如 example.org。')
    }
    return prefix + domain
  })
}

export async function searchDeepSeek(input: SearchInput, apiKey: string, parentSignal: AbortSignal) {
  const allowed = siteOperators(input.allowed_domains, 'site:').join(' OR ')
  const blocked = siteOperators(input.blocked_domains, '-site:').join(' ')
  const term = input.query.trim()
  const query = [term, allowed, blocked].filter(Boolean).join(' ')
  if (!term || [...query].length > 128) {
    throw new Error('DeepSeek 搜索词连同域名限制须为 1 至 128 个字符，请缩短后重试。')
  }
  const result = responseSchema.safeParse(await requestDeepSeekWeb('search', { query, count: 10 }, apiKey, parentSignal))
  if (!result.success) throw new Error('DeepSeek 搜索返回了无效的结果。')
  return result.data.results.map(hit => ({
    title: hit.title, url: hit.url, excerpt: hit.summary || hit.snippet || '',
  }))
}
