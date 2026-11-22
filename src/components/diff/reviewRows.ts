import type { StructuredPatchHunk } from 'diff'
import { stringWidth } from '../../ink/stringWidth.js'

const MAX_PREVIEW_ROWS = 10_000

export type ReviewRow = {
  kind: 'header' | 'note' | 'context' | 'addition' | 'deletion'
  text: string
  lineNumber?: number
}

export function reviewText(text: string): string {
  return text.replace(/\t/g, '    ').replace(/[\u0000-\u001f\u007f-\u009f]/g, '�')
}

export function buildReviewRows(hunks: readonly StructuredPatchHunk[]) {
  const rows: ReviewRow[] = []
  const hunkStarts: number[] = []
  for (const hunk of hunks) {
    if (rows.length >= MAX_PREVIEW_ROWS) return { rows, hunkStarts, truncated: true }
    hunkStarts.push(rows.length)
    rows.push({
      kind: 'header',
      text: '@@ -' + hunk.oldStart + ',' + hunk.oldLines + ' +' + hunk.newStart + ',' + hunk.newLines + ' @@',
    })
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart
    for (const line of hunk.lines) {
      if (rows.length >= MAX_PREVIEW_ROWS) return { rows, hunkStarts, truncated: true }
      const text = reviewText(line.replace(/\r$/, ''))
      if (line.startsWith('\\')) {
        rows.push({ kind: 'note', text })
      } else if (line.startsWith('+')) {
        rows.push({ kind: 'addition', lineNumber: newLine++, text })
      } else if (line.startsWith('-')) {
        rows.push({ kind: 'deletion', lineNumber: oldLine++, text })
      } else {
        rows.push({ kind: 'context', lineNumber: newLine++, text })
        oldLine++
      }
    }
  }
  return { rows, hunkStarts, truncated: false }
}

export type ReviewMatch = { row: number; column: number }

/** Literal, case-insensitive search over the loaded patch, including off-screen lines. */
export function findReviewMatches(rows: readonly ReviewRow[], query: string): ReviewMatch[] {
  const needle = query.toLowerCase()
  if (!needle) return []
  // Store one match per matching line, even if a line repeats a short query many times.
  return rows.flatMap((row, index) => {
    const column = row.text.toLowerCase().indexOf(needle)
    return column < 0 ? [] : [{ row: index, column: stringWidth(row.text.slice(0, column)) }]
  })
}
