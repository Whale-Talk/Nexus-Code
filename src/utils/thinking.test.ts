import { describe, expect, test } from 'bun:test'
import {
  findThinkingTriggerPositions,
  getRainbowColor,
  hasUltrathinkKeyword,
} from './thinking.js'

describe('hasUltrathinkKeyword', () => {
  test('matches plain keyword in lowercase', () => {
    expect(hasUltrathinkKeyword('ultrathink')).toBe(true)
  })

  test('matches uppercase keyword', () => {
    expect(hasUltrathinkKeyword('ULTRATHINK')).toBe(true)
  })

  test('matches mixed case', () => {
    expect(hasUltrathinkKeyword('UltraThink')).toBe(true)
  })

  test('matches keyword embedded in a sentence', () => {
    expect(hasUltrathinkKeyword('please use ultrathink mode')).toBe(true)
  })

  test('matches keyword adjacent to CJK characters', () => {
    expect(hasUltrathinkKeyword('你好 ultrathink 世界')).toBe(true)
    expect(hasUltrathinkKeyword('你好ultrathink世界')).toBe(true)
  })

  test('matches keyword adjacent to punctuation', () => {
    expect(hasUltrathinkKeyword('ultrathink.')).toBe(true)
    expect(hasUltrathinkKeyword('(ultrathink)')).toBe(true)
  })

  test('rejects word-boundary violations (longer word)', () => {
    expect(hasUltrathinkKeyword('ultrathinking')).toBe(false)
  })

  test('rejects word-boundary violations (prefixed word)', () => {
    expect(hasUltrathinkKeyword('myultrathink')).toBe(false)
  })

  test('rejects hyphenated form', () => {
    expect(hasUltrathinkKeyword('ultra-think')).toBe(false)
  })

  test('rejects empty string', () => {
    expect(hasUltrathinkKeyword('')).toBe(false)
  })

  test('rejects unrelated text', () => {
    expect(hasUltrathinkKeyword('hello world')).toBe(false)
  })
})

describe('findThinkingTriggerPositions', () => {
  test('returns single match at start with correct range', () => {
    expect(findThinkingTriggerPositions('ultrathink')).toEqual([
      { word: 'ultrathink', start: 0, end: 10 },
    ])
  })

  test('preserves original casing in word field', () => {
    expect(findThinkingTriggerPositions('Use ULTRATHINK now')).toEqual([
      { word: 'ULTRATHINK', start: 4, end: 14 },
    ])
  })

  test('returns all matches with correct positions', () => {
    expect(
      findThinkingTriggerPositions('a ultrathink b ULTRATHINK c'),
    ).toEqual([
      { word: 'ultrathink', start: 2, end: 12 },
      { word: 'ULTRATHINK', start: 15, end: 25 },
    ])
  })

  test('handles CJK-adjacent match positions', () => {
    expect(findThinkingTriggerPositions('请 ultrathink 处理')).toEqual([
      { word: 'ultrathink', start: 2, end: 12 },
    ])
  })

  test('returns empty array when no match', () => {
    expect(findThinkingTriggerPositions('hello world')).toEqual([])
  })

  test('returns empty array for empty string', () => {
    expect(findThinkingTriggerPositions('')).toEqual([])
  })

  test('returns empty array when only word-boundary violations exist', () => {
    expect(findThinkingTriggerPositions('ultrathinking')).toEqual([])
  })
})

describe('getRainbowColor', () => {
  test('cycles through palette starting at red', () => {
    expect(getRainbowColor(0)).toBe('rainbow_red')
    expect(getRainbowColor(1)).toBe('rainbow_orange')
    expect(getRainbowColor(2)).toBe('rainbow_yellow')
    expect(getRainbowColor(3)).toBe('rainbow_green')
    expect(getRainbowColor(4)).toBe('rainbow_blue')
    expect(getRainbowColor(5)).toBe('rainbow_indigo')
    expect(getRainbowColor(6)).toBe('rainbow_violet')
  })

  test('wraps around modulo 7', () => {
    expect(getRainbowColor(7)).toBe('rainbow_red')
    expect(getRainbowColor(14)).toBe('rainbow_red')
    expect(getRainbowColor(8)).toBe('rainbow_orange')
  })

  test('handles large indices', () => {
    expect(getRainbowColor(7003)).toBe('rainbow_green')
    expect(getRainbowColor(1000000)).toBe(
      (['rainbow_red', 'rainbow_orange', 'rainbow_yellow', 'rainbow_green', 'rainbow_blue', 'rainbow_indigo', 'rainbow_violet'] as const)[
        1000000 % 7
      ],
    )
  })

  test('shimmer flag selects shimmer palette', () => {
    expect(getRainbowColor(0, true)).toBe('rainbow_red_shimmer')
    expect(getRainbowColor(6, true)).toBe('rainbow_violet_shimmer')
    expect(getRainbowColor(7, true)).toBe('rainbow_red_shimmer')
  })

  test('shimmer defaults to false (non-shimmer palette)', () => {
    expect(getRainbowColor(0)).toBe('rainbow_red')
    expect(getRainbowColor(0, false)).toBe('rainbow_red')
  })

  // DOCUMENTED SOURCE BUG (unfixed, per task scope): charIndex % 7 is negative
  // for negative input and JS arrays do not support negative indexing, so the
  // runtime value is `undefined` — the `!` assertion in getRainbowColor masks
  // the fact that the return type (`keyof Theme`) is violated. Not reachable
  // from current callers (all pass `i - t.start` with i >= t.start), hence
  // latent; asserted here to pin down current behavior.
  test('negative indices fall through to undefined (documented bug)', () => {
    expect(getRainbowColor(-1)).toBeUndefined()
    expect(getRainbowColor(-8)).toBeUndefined()
  })
})
