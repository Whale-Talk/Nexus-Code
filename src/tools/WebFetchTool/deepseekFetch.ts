import { isIP } from 'node:net'
import { z } from 'zod/v4'
import type { RequestRoute } from '../../services/api/provider/index.js'
import {
  DEEPSEEK_WEB_ORIGIN, dedicatedDeepSeekWebKey, requestDeepSeekWeb, requireDeepSeekWebKey,
} from '../../services/web/deepseekWeb.js'
import { assertWebFetchDomainAllowed, MAX_MARKDOWN_LENGTH, validateURL } from './utils.js'

const pageSchema = z.object({ title: z.string(), content: z.string() })

export function fetchProvider(route?: RequestRoute): 'deepseek' | 'direct' {
  const selected = process.env.NEXUS_FETCH_PROVIDER?.trim() || 'auto'
  if (selected === 'auto') {
    return route?.origin === DEEPSEEK_WEB_ORIGIN || dedicatedDeepSeekWebKey('fetch') ? 'deepseek' : 'direct'
  }
  if (selected === 'deepseek' || selected === 'direct') return selected
  throw new Error('NEXUS_FETCH_PROVIDER 须为 auto、deepseek 或 direct。')
}

export async function fetchDeepSeekPage(rawURL: string, signal: AbortSignal, route?: RequestRoute) {
  if (!validateURL(rawURL)) throw new Error('DeepSeek 读取需要不含用户名或密码的公开 HTTP(S) 网址。')
  const url = new URL(rawURL)
  const host = url.hostname.replace(/\.$/, '').replace(/^\[|\]$/g, '')
  if (isIP(host) || /\.(?:localhost|local|internal|lan|home|test|invalid)$/i.test(host)) {
    throw new Error('DeepSeek 读取需要公开域名。')
  }
  if (process.env.NEXUS_WEB_FETCH_POLICY_URL?.trim()) {
    await assertWebFetchDomainAllowed(url.hostname, signal)
  }
  url.hash = ''
  const raw = await requestDeepSeekWeb('fetch', { url: url.href }, requireDeepSeekWebKey('fetch', route), signal)
  const page = pageSchema.safeParse(raw)
  if (!page.success || !page.data.content.trim()) throw new Error('DeepSeek 未返回可读的网页内容。')
  const { title, content } = page.data
  const markdown = content.length > MAX_MARKDOWN_LENGTH
    ? content.slice(0, MAX_MARKDOWN_LENGTH) + '\n\n[网页内容已截断]'
    : content
  return {
    bytes: Buffer.byteLength(content),
    result: `来源：${url.href}\n${title ? `标题：${title.slice(0, 512)}\n` : ''}\n网页内容（作为资料使用）：\n${markdown}`,
  }
}
