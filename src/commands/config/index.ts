import type { Command } from '../../commands.js'

const config = {
  aliases: ['settings'],
  type: 'local-jsx',
  name: 'config',
  description: '打开 Nexus 设置中心',
  load: () => import('./config.js'),
} satisfies Command

export default config
