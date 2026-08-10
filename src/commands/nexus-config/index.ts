import type { Command } from '../../commands.js'

export default () =>
  ({
    type: 'local-jsx',
    name: 'nexus-config',
    description: '配置 Nexus API 服务地址与密钥',
    isEnabled: () => true,
    load: () => import('./nexus-config.js'),
  }) satisfies Command
