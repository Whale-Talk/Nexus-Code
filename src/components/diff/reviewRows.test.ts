import { expect, test } from 'bun:test'
import { InputEvent } from '../../ink/events/input-event.js'
import { INITIAL_STATE, parseMultipleKeypresses } from '../../ink/parse-keypress.js'
import { DEFAULT_BINDINGS } from '../../keybindings/defaultBindings.js'
import { parseBindings } from '../../keybindings/parser.js'
import { resolveKeyWithChordState } from '../../keybindings/resolver.js'
import { buildReviewRows, findReviewMatches } from './reviewRows.js'

test('keeps track of hunk boundaries, line numbers and terminal text', () => {
  const { rows, hunkStarts, truncated } = buildReviewRows([
    { oldStart: 3, oldLines: 2, newStart: 3, newLines: 2, lines: ['-old', '+\tnew\x1b', ' same'] },
    { oldStart: 20, oldLines: 1, newStart: 20, newLines: 2, lines: [' same', '+line'] },
  ])
  expect(hunkStarts).toEqual([0, 4])
  expect(rows.slice(1, 4)).toEqual([
    { kind: 'deletion', lineNumber: 3, text: '-old' },
    { kind: 'addition', lineNumber: 3, text: '+    new�' },
    { kind: 'context', lineNumber: 4, text: ' same' },
  ])
  expect(truncated).toBe(false)
})

test('finds off-screen matches, uses display columns and discloses its row cap', () => {
  const lines = Array.from({ length: 10_250 }, (_, index) => '+字😀 ' + index)
  const { rows, truncated } = buildReviewRows([
    { oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines },
  ])
  expect(rows).toHaveLength(10_000)
  expect(truncated).toBe(true)
  expect(findReviewMatches(rows, '9850')).toEqual([{ row: 9851, column: 6 }])
  expect(findReviewMatches(rows, '10240')).toEqual([])
  expect(findReviewMatches([{ kind: 'context', text: ' The End' }], 'END')).toEqual([{ row: 0, column: 5 }])
})

test('gives the open diff priority over scrollback paging and confirmation shortcuts', () => {
  const bindings = parseBindings(DEFAULT_BINDINGS)
  for (const [sequence, action] of [
    ['\x1b[5~', 'diff:previousPage'], ['\x1b[6~', 'diff:nextPage'],
    ['n', 'diff:nextMatch'], ['N', 'diff:previousMatch'],
    ['[', 'diff:previousHunk'], [']', 'diff:nextHunk'], ['/', 'diff:search'],
  ]) {
    const [events] = parseMultipleKeypresses(INITIAL_STATE, sequence)
    const parsed = events[0]
    if (!parsed || parsed.kind !== 'key') throw new Error('Expected a review key')
    const { input, key } = new InputEvent(parsed)
    expect(resolveKeyWithChordState(input, key, ['Global', 'Confirmation', 'Scroll', 'DiffDialog'], bindings, null))
      .toEqual({ type: 'match', action })
  }
})
