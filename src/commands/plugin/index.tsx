import type { Command } from '../../commands.js';
const plugin = {
  type: 'local-jsx',
  name: 'plugin',
  aliases: ['plugins', 'marketplace'],
  description: 'Manage Nexus Code plugins',
  immediate: true,
  load: () => import('./plugin.js')
} satisfies Command;
export default plugin;
