import type { Command } from '../../commands.js'

const memory: Command = {
  type: 'local-jsx',
  name: 'memory',
  description: '查看自动记忆，打开项目或个人指令文件',
  load: () => import('./memory.js'),
}

export default memory
