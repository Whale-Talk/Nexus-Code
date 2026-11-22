import { expect, test } from 'bun:test'
import { type Command, formatDescriptionWithSource } from '../../commands.js'
import compact from '../../commands/compact/index.js'
import plan from '../../commands/plan/index.js'
import { generateCommandSuggestions } from './commandSuggestions.js'

test('slash suggestions and help show Chinese descriptions and preserve command IDs', () => {
  const commands = [compact, plan]
  const menu = generateCommandSuggestions('/', commands)
  const row = menu.find(item => item.displayText === '/compact')
  expect(row?.description).toBe(formatDescriptionWithSource(compact, 'zh'))
  expect(row?.description).toContain('压缩')
  expect(row?.metadata).toBe(compact)
  expect(generateCommandSuggestions('/压缩', commands).map(item => item.displayText)).toContain('/compact')
  expect(generateCommandSuggestions('/compact', commands)[0]?.metadata).toBe(compact)
})

test('project commands with a built-in name retain their author’s description', () => {
  const custom: Command = {
    type: 'prompt', name: 'compact', source: 'projectSettings', loadedFrom: 'skills',
    description: 'Team-specific compact procedure', argNames: ['target'], contentLength: 0, progressMessage: 'working',
    async getPromptForCommand() { return [] },
  }
  const row = generateCommandSuggestions('/', [custom])[0]!
  expect(row.description).toBe('Team-specific compact procedure（项目配置）（参数：target）')
  expect(formatDescriptionWithSource(custom)).toBe('Team-specific compact procedure (project)')
})
