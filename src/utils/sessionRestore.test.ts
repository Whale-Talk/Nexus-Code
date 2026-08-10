import { describe, expect, test } from 'bun:test'
import { TODO_WRITE_TOOL_NAME } from '../tools/TodoWriteTool/constants.js'
import type { Message } from '../types/message.js'
import {
  computeStandaloneAgentContext,
  extractTodosFromTranscript,
} from './sessionRestore.js'

function todoWriteMessage(todos: unknown): Message {
  return {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          name: TODO_WRITE_TOOL_NAME,
          input: { todos },
        },
      ],
    },
  }
}

const validTodos = [
  { content: 'First task', status: 'pending' as const, activeForm: 'First task' },
  {
    content: 'Second task',
    status: 'in_progress' as const,
    activeForm: 'Second task',
  },
]

describe('extractTodosFromTranscript', () => {
  test('returns an empty list for an empty transcript', () => {
    expect(extractTodosFromTranscript([])).toEqual([])
  })

  test('ignores non-assistant messages', () => {
    const messages: Message[] = [
      { type: 'user', message: { content: 'hello' } },
      { type: 'system', message: 'ignored' },
    ]
    expect(extractTodosFromTranscript(messages)).toEqual([])
  })

  test('returns an empty list when the assistant has no TodoWrite block', () => {
    const messages: Message[] = [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: 'Read', input: { file_path: '/a' } },
          ],
        },
      },
    ]
    expect(extractTodosFromTranscript(messages)).toEqual([])
  })

  test('returns todos from the last TodoWrite block in the transcript', () => {
    const messages = [
      todoWriteMessage([validTodos[0]]),
      todoWriteMessage(validTodos),
    ]
    expect(extractTodosFromTranscript(messages)).toEqual(validTodos)
  })

  test('returns an empty list when the last TodoWrite input is null', () => {
    const messages: Message[] = [
      todoWriteMessage(validTodos),
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'tool_use', name: TODO_WRITE_TOOL_NAME, input: null },
          ],
        },
      },
    ]
    expect(extractTodosFromTranscript(messages)).toEqual([])
  })

  test('returns an empty list when the last TodoWrite todos fail validation', () => {
    const messages = [
      todoWriteMessage(validTodos),
      todoWriteMessage([{ content: 'missing status and activeForm' }]),
    ]
    expect(extractTodosFromTranscript(messages)).toEqual([])
  })

  test('returns an empty list for an empty todos array', () => {
    expect(extractTodosFromTranscript([todoWriteMessage([])])).toEqual([])
  })
})

describe('computeStandaloneAgentContext', () => {
  test('returns undefined when no name or color is set', () => {
    expect(computeStandaloneAgentContext(undefined, undefined)).toBeUndefined()
  })

  test('treats an empty name like an unset one', () => {
    expect(computeStandaloneAgentContext('', undefined)).toBeUndefined()
  })

  test('keeps the name and leaves color unset when only the name exists', () => {
    expect(computeStandaloneAgentContext('agent-a', undefined)).toEqual({
      name: 'agent-a',
      color: undefined,
    })
  })

  test('maps the "default" color to undefined', () => {
    expect(computeStandaloneAgentContext('agent-a', 'default')).toEqual({
      name: 'agent-a',
      color: undefined,
    })
  })

  test('preserves a named color', () => {
    expect(computeStandaloneAgentContext('agent-a', 'pink')).toEqual({
      name: 'agent-a',
      color: 'pink',
    })
  })

  test('fills an empty name when only a color is set', () => {
    expect(computeStandaloneAgentContext(undefined, 'blue')).toEqual({
      name: '',
      color: 'blue',
    })
  })
})
