import { expect, test } from 'bun:test'
import { MODEL_SELECTIONS, MODEL_ROLES, isModelSelection, isModelRole } from './roles.js'

test('orchestration has exactly three independent native roles', () => {
  expect([...MODEL_ROLES]).toEqual(['quark', 'atom', 'electron'])
  for (const role of MODEL_ROLES) {
    expect(isModelRole(role)).toBe(true)
    expect(isModelSelection(role)).toBe(true)
  }
})

test('shortcuts and context modifiers are distinct from a role', () => {
  for (const name of ['quarkplan', 'atom[1m]', 'quark[1m]', 'electron[1m]']) {
    expect(isModelRole(name)).toBe(false)
    expect(isModelSelection(name)).toBe(true)
  }
  for (const name of MODEL_SELECTIONS) expect(isModelSelection(name)).toBe(true)
})

test('unrecognized and channel-qualified IDs are never role aliases', () => {
  for (const value of ['electron-worker', 'atombot', 'best', 'deepseek', 'flash', 'opus', 'sonnet', 'haiku', 'channel::quark', '', 'Atom', ' atom', 'deepseek-v4-pro', '  ']) {
    expect(isModelRole(value)).toBe(false)
    expect(isModelSelection(value)).toBe(false)
  }
})
