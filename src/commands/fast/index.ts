import type { Command } from '../../commands.js'
import {
  isFastModeAvailable,
  isFastModeEnabled,
} from '../../utils/fastMode.js'
import { shouldInferenceConfigCommandBeImmediate } from '../../utils/immediateCommand.js'

const fast = {
  type: 'local-jsx',
  name: 'fast',
  get description() {
    return '切换模型渠道提供的快速模式'
  },
  isEnabled: () => isFastModeEnabled(),
  get isHidden() {
    return !isFastModeAvailable()
  },
  argumentHint: '[on|off]',
  get immediate() {
    return shouldInferenceConfigCommandBeImmediate()
  },
  load: () => import('./fast.js'),
} satisfies Command

export default fast
