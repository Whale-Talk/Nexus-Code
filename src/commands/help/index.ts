import type { Command } from '../../commands.js'

const help = {
  type: 'local-jsx',
  name: 'help',
  description: '查看快捷键和可用命令',
  load: () => import('./help.js'),
} satisfies Command

export default help
