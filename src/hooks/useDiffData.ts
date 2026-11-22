import { useEffect, useMemo, useState } from 'react'
import {
  fetchGitDiff,
  type GitDiffResult,
  type GitDiffStats,
} from '../utils/gitDiff.js'

export type DiffFile = {
  path: string
  linesAdded: number
  linesRemoved: number
  isBinary: boolean
  isUntracked?: boolean
}

export type DiffData = {
  root?: string
  stats: GitDiffStats | null
  files: DiffFile[]
  loading: boolean
}

/** Load the file list on open. Read a patch only when its file is selected. */
export function useDiffData(): DiffData {
  const [result, setResult] = useState<GitDiffResult | null>()
  useEffect(() => {
    const controller = new AbortController()
    void fetchGitDiff(controller.signal).then(
      diff => { if (!controller.signal.aborted) setResult(diff) },
      () => { if (!controller.signal.aborted) setResult(null) },
    )
    return () => controller.abort()
  }, [])

  return useMemo(() => {
    if (!result) return { stats: null, files: [], loading: result === undefined }

    const { root, stats, perFileStats } = result
    const files = Array.from(perFileStats, ([path, file]) => ({
      path,
      linesAdded: file.added,
      linesRemoved: file.removed,
      isBinary: file.isBinary,
      isUntracked: file.isUntracked,
    })).sort((a, b) => a.path.localeCompare(b.path))
    return { root, stats, files, loading: false }
  }, [result])
}
