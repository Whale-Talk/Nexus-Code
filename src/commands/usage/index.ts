import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'usage',
  description: '查看当前会话各模型的用量和已知费用',
  load: () => import('./usage.js'),
} satisfies Command
