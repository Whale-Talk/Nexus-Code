import { describe, expect, test } from 'bun:test'
import {
  MODEL_ALIASES,
  MODEL_FAMILY_ALIASES,
  isModelAlias,
  isModelFamilyAlias,
} from './aliases.js'

describe('MODEL_ALIASES', () => {
  test('exports the expected alias list', () => {
    expect([...MODEL_ALIASES]).toEqual([
      'atom',
      'quark',
      'electron',
      'best',
      'deepseek',
      'flash',
      'atom[1m]',
      'quark[1m]',
      'quarkplan',
    ])
  })

  test('isModelAlias returns true for every valid alias', () => {
    for (const alias of MODEL_ALIASES) {
      expect(isModelAlias(alias)).toBe(true)
    }
  })

  test('isModelAlias returns false for non-alias model identifiers', () => {
    for (const input of [
      'claude-opus-4-5',
      'opus',
      'claude-sonnet-4',
      'gpt-4o',
      'deepseek-v3',
      'sonnet[1m]',
    ]) {
      expect(isModelAlias(input)).toBe(false)
    }
  })

  test('isModelAlias is case-sensitive', () => {
    for (const input of [
      'Atom',
      'BEST',
      'DeepSeek',
      'FLASH',
      'ATOM[1M]',
      'Quarkplan',
    ]) {
      expect(isModelAlias(input)).toBe(false)
    }
  })

  test('isModelAlias rejects empty, whitespace, and [1m]-suffixed lookalikes', () => {
    for (const input of ['', '   ', 'atom ', ' atom', 'best[1m]', 'flash[1m]', 'quarkplan[1m]']) {
      expect(isModelAlias(input)).toBe(false)
    }
  })
})

describe('MODEL_FAMILY_ALIASES', () => {
  test('exports exactly the three family aliases', () => {
    expect([...MODEL_FAMILY_ALIASES]).toEqual(['atom', 'quark', 'electron'])
  })

  test('isModelFamilyAlias returns true for every family alias', () => {
    for (const alias of MODEL_FAMILY_ALIASES) {
      expect(isModelFamilyAlias(alias)).toBe(true)
    }
  })

  test('isModelFamilyAlias rejects full model aliases that are not family aliases', () => {
    for (const input of [
      'best',
      'deepseek',
      'flash',
      'atom[1m]',
      'quark[1m]',
      'quarkplan',
    ]) {
      expect(isModelFamilyAlias(input)).toBe(false)
    }
  })

  test('isModelFamilyAlias rejects unknown models, is case-sensitive, and rejects empty input', () => {
    for (const input of ['opus', 'claude-opus-4', 'Atom', 'Quark', 'atom ', '', '  ']) {
      expect(isModelFamilyAlias(input)).toBe(false)
    }
  })
})
