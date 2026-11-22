import type { ProviderKind } from './catalog.js'

export type OfficialModelService = 'deepseek' | 'glm' | 'kimi' | 'kimi-code' | 'mimo' |
  'minimax' | 'qwen' | 'doubao' | 'stepfun'

export function getOfficialModelService(protocol: ProviderKind, baseURL: string): OfficialModelService | undefined {
  let url: URL
  try {
    url = new URL(baseURL)
  } catch {
    return undefined
  }
  if (url.username || url.password || url.search || url.hash) return undefined
  const path = url.pathname.replace(/\/+$/, '')
  const messages = protocol === 'messages'
  switch (url.origin) {
    case 'https://api.deepseek.com':
      if ((messages ? ['/anthropic', '/anthropic/v1'] : ['', '/v1']).includes(path)) return 'deepseek'
      break
    case 'https://open.bigmodel.cn':
    case 'https://api.z.ai':
      if ((messages ? ['/api/anthropic', '/api/anthropic/v1'] : ['/api/paas/v4', '/api/coding/paas/v4']).includes(path)) return 'glm'
      break
    case 'https://api.moonshot.ai':
    case 'https://api.moonshot.cn':
      if ((messages ? ['/anthropic', '/anthropic/v1'] : ['', '/v1']).includes(path)) return 'kimi'
      break
    case 'https://api.kimi.com':
    case 'https://api.kimi.ai':
      if ((messages ? ['/coding', '/coding/v1'] : ['/coding/v1']).includes(path)) return 'kimi-code'
      break
    case 'https://api.xiaomimimo.com':
    case 'https://token-plan-cn.xiaomimimo.com':
    case 'https://token-plan-sgp.xiaomimimo.com':
    case 'https://token-plan-ams.xiaomimimo.com':
      if ((messages ? ['/anthropic', '/anthropic/v1'] : ['', '/v1']).includes(path)) return 'mimo'
      break
    case 'https://api.minimax.cn':
    case 'https://api.minimax.io':
      if ((messages ? ['/anthropic', '/anthropic/v1'] : ['/v1']).includes(path)) return 'minimax'
      break
    case 'https://dashscope.aliyuncs.com':
      if ((messages ? ['/apps/anthropic', '/apps/anthropic/v1'] : ['/compatible-mode/v1']).includes(path)) return 'qwen'
      break
    case 'https://ark.cn-beijing.volces.com':
      if (!messages && path === '/api/v3') return 'doubao'
      break
    case 'https://api.stepfun.com':
    case 'https://api.stepfun.ai':
      if (!messages && ['', '/v1'].includes(path)) return 'stepfun'
      break
  }
}
