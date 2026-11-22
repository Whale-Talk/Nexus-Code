import type { ChannelConnection, ProviderKind } from './catalog.js'

export type ProviderPreset = Readonly<{
  id: string
  label: string
  protocol: ProviderKind
  baseURL: string
  apiKeyEnv: string
  models: readonly string[]
}>

export const providerPresets: readonly ProviderPreset[] = [
  { id: 'deepseek', label: 'DeepSeek 官方', protocol: 'messages',
    baseURL: 'https://api.deepseek.com/anthropic', apiKeyEnv: 'DEEPSEEK_API_KEY',
    models: ['deepseek-v4-pro', 'deepseek-flash'] },
  { id: 'glm', label: '智谱 GLM 开放平台', protocol: 'openai-compatible',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4', apiKeyEnv: 'ZAI_API_KEY',
    models: ['glm-5.3', 'glm-5.3-flash', 'glm-5.2'] },
  { id: 'kimi', label: 'Kimi 开放平台', protocol: 'openai-compatible',
    baseURL: 'https://api.moonshot.cn/v1', apiKeyEnv: 'MOONSHOT_API_KEY',
    models: ['kimi-k3.1-pro', 'kimi-k3'] },
  { id: 'mimo', label: '小米 MiMo 开放平台', protocol: 'openai-compatible',
    baseURL: 'https://api.xiaomimimo.com/v1', apiKeyEnv: 'MIMO_API_KEY',
    models: ['mimo-v2.6-pro', 'mimo-v2.6-flash'] },
  { id: 'minimax', label: 'MiniMax 开放平台', protocol: 'messages',
    baseURL: 'https://api.minimax.cn/anthropic', apiKeyEnv: 'MINIMAX_API_KEY',
    models: ['MiniMax-M3.1-Flash', 'MiniMax-M3'] },
  { id: 'qwen', label: '通义千问 · 阿里云百炼', protocol: 'openai-compatible',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKeyEnv: 'DASHSCOPE_API_KEY',
    models: ['qwen4-max', 'qwen3.8-flash'] },
  { id: 'doubao', label: '豆包 · 火山方舟', protocol: 'openai-compatible',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3', apiKeyEnv: 'ARK_API_KEY',
    models: ['doubao-seed-2-1-pro-260915', 'doubao-seed-2-1-lite-260915', 'doubao-seed-2-1-turbo-260628'] },
  { id: 'stepfun', label: '阶跃星辰开放平台', protocol: 'openai-compatible',
    baseURL: 'https://api.stepfun.com/v1', apiKeyEnv: 'STEP_API_KEY',
    models: ['step-3.7-flash'] },
  { id: 'claude', label: 'Claude 官方 API', protocol: 'messages',
    baseURL: 'https://api.anthropic.com', apiKeyEnv: 'NEXUS_CLAUDE_API_KEY',
    models: [] },
  { id: 'kimi-code', label: 'Kimi Code 套餐', protocol: 'messages',
    baseURL: 'https://api.kimi.com/coding', apiKeyEnv: 'KIMI_CODE_API_KEY',
    models: ['k3.1-pro', 'k3-256k'] },
  { id: 'mimo-token', label: 'MiMo Token Plan（国内）', protocol: 'openai-compatible',
    baseURL: 'https://token-plan-cn.xiaomimimo.com/v1', apiKeyEnv: 'MIMO_TOKEN_PLAN_API_KEY',
    models: ['mimo-v2.6-pro', 'mimo-v2.6-flash'] },
]

export function displayChannelName(id: string, channel: ChannelConnection): string {
  const parsed = channel.baseURL.replace(/\/+$/, '')
  const preset = providerPresets.find(item => item.id === id &&
    item.protocol === channel.protocol && item.baseURL === parsed)
  return preset?.label ?? id
}
