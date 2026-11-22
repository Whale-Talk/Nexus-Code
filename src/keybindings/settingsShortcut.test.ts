import { expect, test } from 'bun:test'
import { InputEvent } from '../ink/events/input-event.js'
import { INITIAL_STATE, parseMultipleKeypresses } from '../ink/parse-keypress.js'
import { DEFAULT_BINDINGS } from './defaultBindings.js'
import { parseBindings } from './parser.js'
import { getBindingDisplayText, resolveKeyWithChordState } from './resolver.js'

const bindings = parseBindings(DEFAULT_BINDINGS)

function decodeAtSplit(sequence: string, split: number) {
  const [prefix, partial] = parseMultipleKeypresses(INITIAL_STATE, sequence.slice(0, split))
  const [suffix] = parseMultipleKeypresses(partial, sequence.slice(split))
  const keys = [...prefix, ...suffix]
  if (keys.length !== 1 || keys[0]?.kind !== 'key') throw new Error('Expected one keystroke')
  return new InputEvent(keys[0])
}

test('F2 opens settings across Windows Terminal, xterm and libuv key encodings', () => {
  for (const sequence of ['\x1b[Q', '\x1b[1Q', '\x1b[1;1Q', '\x1bOQ', '\x1b[12~', '\x1b[[B']) {
    for (let split = 0; split <= sequence.length; split++) {
      const { key, input } = decodeAtSplit(sequence, split)
      expect(input).toBe('')
      expect(resolveKeyWithChordState(input, key, ['Chat'], bindings, null))
        .toEqual({ type: 'match', action: 'command:config' })
    }
  }
})

test('Ctrl+P opens settings in chat and moves up inside menus', () => {
  for (const sequence of ['\x10', '\x1b[112;5u', '\x1b[27;5;112~']) {
    const { key, input } = decodeAtSplit(sequence, 0)
    expect(resolveKeyWithChordState(input, key, ['Chat'], bindings, null))
      .toEqual({ type: 'match', action: 'command:config' })
    expect(resolveKeyWithChordState(input, key, ['Select'], bindings, null))
      .toEqual({ type: 'match', action: 'select:previous' })
  }
  const { key, input } = decodeAtSplit('\x1b[A', 0)
  expect(resolveKeyWithChordState(input, key, ['Chat'], bindings, null))
    .toEqual({ type: 'match', action: 'history:previous' })
})

test('Enter modifies the selected setting and Ctrl+S saves', () => {
  for (const sequence of ['\r', ' ']) {
    const { key, input } = decodeAtSplit(sequence, 0)
    expect(resolveKeyWithChordState(input, key, ['Settings'], bindings, null))
      .toEqual({ type: 'match', action: 'select:accept' })
  }
  const { key, input } = decodeAtSplit('\x13', 0)
  expect(resolveKeyWithChordState(input, key, ['Settings'], bindings, null))
    .toEqual({ type: 'match', action: 'settings:close' })
})

test('shortcut hints use the active binding and omit an unbound permission action', () => {
  const overrides = [
    { context: 'Chat', bindings: { 'meta+m': 'chat:cycleMode' } },
    { context: 'Chat', bindings: { 'alt+m': null } },
    { context: 'Chat', bindings: { 'ctrl+g': 'chat:cycleMode' } },
  ] as unknown as Parameters<typeof parseBindings>[0]
  const withoutDefault = parseBindings(overrides.slice(0, 2))
  expect(getBindingDisplayText('chat:cycleMode', 'Chat', withoutDefault)).toBeUndefined()
  const remapped = parseBindings(overrides)
  expect(getBindingDisplayText('chat:cycleMode', 'Chat', remapped)).toBe('ctrl+g')
})
