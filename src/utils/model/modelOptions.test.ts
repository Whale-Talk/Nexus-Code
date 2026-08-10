import { describe, expect, test } from 'bun:test'
import {
  getAtomOption,
  getElectronOption,
  getOpus41Option,
  getOpusPlanOption,
  getQuarkOption,
  isDeepSeekRelay,
} from './modelOptions.js'

describe('isDeepSeekRelay', () => {
  test('returns false when base URL is unset and no deepseek settings model', () => {
    expect(isDeepSeekRelay(undefined, undefined)).toBe(false)
  })

  test('returns false for a first-party Anthropic base URL', () => {
    expect(isDeepSeekRelay('https://api.anthropic.com', undefined)).toBe(false)
  })

  test('treats an empty base URL like an unset one', () => {
    expect(isDeepSeekRelay('', '')).toBe(false)
  })

  test('detects a custom relay via base URL', () => {
    expect(isDeepSeekRelay('https://relay.internal', undefined)).toBe(true)
    expect(isDeepSeekRelay('https://deepseek.example.com', undefined)).toBe(true)
  })

  test('detects a relay via settings model string even with first-party URL', () => {
    expect(
      isDeepSeekRelay('https://api.anthropic.com', 'deepseek-v4-pro[1m]'),
    ).toBe(true)
  })

  test('treats a null settings model as an empty string', () => {
    expect(isDeepSeekRelay('https://api.anthropic.com', null)).toBe(false)
    expect(isDeepSeekRelay(undefined, null)).toBe(false)
  })
})

describe('Nexus model option factories (static structure)', () => {
  test('Quark option targets the deep-reasoning model ID', () => {
    const option = getQuarkOption()
    expect(option.value).toBe('deepseek-v4-pro[1m]')
    expect(option.label).toBe('Nexus Quark (1M context)')
    expect(option.description).toContain('deep reasoning')
    expect(option.descriptionForModel).toBeTruthy()
  })

  test('Atom option targets the balanced daily model ID', () => {
    const option = getAtomOption()
    expect(option.value).toBe('deepseek-v4-flash[1m]')
    expect(option.label).toBe('Nexus Atom (1M context)')
  })

  test('Electron option targets the fast sub-agent model ID', () => {
    const option = getElectronOption()
    expect(option.value).toBe('deepseek-v4-flash[1m]')
    expect(option.label).toBe('Nexus Electron (1M context)')
    expect(option.description).toContain('sub-agents')
  })

  test('Opus 4.1 legacy option', () => {
    const option = getOpus41Option()
    expect(option.value).toBe('opus')
    expect(option.label).toBe('Opus 4.1')
    expect(option.descriptionForModel).toContain('legacy')
  })

  test('Opus Plan Mode option', () => {
    const option = getOpusPlanOption()
    expect(option.value).toBe('opusplan')
    expect(option.label).toBe('Opus Plan Mode')
  })

  test('all static options expose the ModelOption shape', () => {
    const options = [
      getQuarkOption(),
      getAtomOption(),
      getElectronOption(),
      getOpus41Option(),
      getOpusPlanOption(),
    ]
    for (const option of options) {
      expect(typeof option.value).toBe('string')
      expect(typeof option.label).toBe('string')
      expect(typeof option.description).toBe('string')
    }
  })
})
