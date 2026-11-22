import { requireCatalogModel, getModelCatalog } from '../../services/api/provider/catalog.js'
import { getMainLoopModel } from '../../utils/model/model.js'

export async function authStatus(opts: { json?: boolean; text?: boolean }): Promise<void> {
  const catalog = getModelCatalog()
  const model = getMainLoopModel()
  const entry = catalog ? requireCatalogModel(model) : undefined
  const channel = entry && catalog?.config.channels[entry.channel]
  const keyEnv = channel?.apiKeyEnv
  const protocol = channel?.protocol ?? process.env.NEXUS_PROVIDER ?? 'messages'
  const hasApiKey = channel
    ? Boolean(keyEnv && process.env[keyEnv]?.trim())
    : Boolean(process.env.NEXUS_API_KEY || (protocol === 'openai-compatible' && process.env.NEXUS_AUTH_TOKEN))
  const loggedIn = channel
    ? hasApiKey || (!keyEnv && protocol === 'openai-compatible')
    : Boolean(process.env.NEXUS_BASE_URL && (hasApiKey || protocol === 'openai-compatible'))
  const status = {
    loggedIn,
    authMethod: hasApiKey ? 'api_key' : 'none',
    apiProvider: entry?.channel ?? protocol,
    model,
  }
  if (opts.text) {
    process.stdout.write(loggedIn
      ? '渠道 ' + status.apiProvider + '，模型 ' + status.model + '\n'
      : '请使用 /nexus-config 或 models.json 配置模型渠道及密钥。\n')
  } else {
    process.stdout.write(JSON.stringify(status, null, 2) + '\n')
  }
  process.exit(loggedIn ? 0 : 1)
}
