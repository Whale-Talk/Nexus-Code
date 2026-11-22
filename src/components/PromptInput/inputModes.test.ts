import { expect, test } from 'bun:test'
import { getModeFromInput, getValueFromInput, isInputModeCharacter } from './inputModes.js'

test.each(['?', '？', '??', '？？', '?argument', '为什么？', '草稿?'])(
  '%s is ordinary prompt text during input, pastes, and history recall',
  text => {
    expect(isInputModeCharacter(text)).toBe(false)
    expect(getModeFromInput(text)).toBe('prompt')
    expect(getValueFromInput(text)).toBe(text)
  },
)
