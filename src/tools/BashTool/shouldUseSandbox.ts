import { getFeatureValue } from 'src/services/analytics/featureFlags.js'
import { splitCommand_DEPRECATED } from '../../utils/bash/commands.js'
import { tryParseShellCommand } from '../../utils/bash/shellQuote.js'
import { SandboxManager } from '../../utils/sandbox/sandbox-adapter.js'
import { getSettings_DEPRECATED } from '../../utils/settings/settings.js'
import {
  BINARY_HIJACK_VARS,
  bashPermissionRule,
  matchWildcardPattern,
  stripAllLeadingEnvVars,
  stripSafeWrappers,
} from './bashPermissions.js'

type SandboxInput = {
  command?: string
  dangerouslyDisableSandbox?: boolean
}

function isExcludedCommand(command: string): boolean {
  const userExcludedCommands = getSettings_DEPRECATED().sandbox?.excludedCommands ?? []
  const internalExclusions = process.env.NEXUS_BUILD_FLAVOR === 'development'
    ? getFeatureValue('nexus_sandbox_disabled_commands', {
        commands: [] as string[], substrings: [] as string[],
      })
    : undefined
  if (!userExcludedCommands.length && !internalExclusions) return false

  // The legacy splitter omits some shell syntax such as redirections. Keep
  // complex input isolated rather than applying an exception to a partial parse.
  if (/[<>()`{}]/.test(command) || !tryParseShellCommand(command).success) return false

  let subcommands: string[]
  try {
    subcommands = splitCommand_DEPRECATED(command)
  } catch {
    return false
  }
  return subcommands.length > 0 && subcommands.every(subcommand => {
    const trimmed = subcommand.trim()
    const [baseCommand] = trimmed.split(/\s+/, 1)
    if (internalExclusions?.commands.includes(baseCommand ?? '') ||
      internalExclusions?.substrings.some(substring => trimmed.includes(substring))) {
      return true
    }
    // Also try matching with env var prefixes and wrapper commands stripped, so
    // that `FOO=bar bazel ...` and `timeout 30 bazel ...` match `bazel:*`. Not a
    // security boundary (see NOTE at top); the &&-split above already lets
    // `export FOO=bar && bazel ...` match. BINARY_HIJACK_VARS kept as a heuristic.
    //
    // We iteratively apply both stripping operations until no new candidates are
    // produced (fixed-point), matching the approach in filterRulesByContentsMatchingInput.
    // This handles interleaved patterns like `timeout 300 FOO=bar bazel run`
    // where single-pass composition would fail.
    const candidates = [trimmed]
    const seen = new Set(candidates)
    let startIdx = 0
    while (startIdx < candidates.length) {
      const endIdx = candidates.length
      for (let i = startIdx; i < endIdx; i++) {
        const cmd = candidates[i]!
        const envStripped = stripAllLeadingEnvVars(cmd, BINARY_HIJACK_VARS)
        if (!seen.has(envStripped)) {
          candidates.push(envStripped)
          seen.add(envStripped)
        }
        const wrapperStripped = stripSafeWrappers(cmd)
        if (!seen.has(wrapperStripped)) {
          candidates.push(wrapperStripped)
          seen.add(wrapperStripped)
        }
      }
      startIdx = endIdx
    }

    for (const pattern of userExcludedCommands) {
      const rule = bashPermissionRule(pattern)
      for (const cand of candidates) {
        switch (rule.type) {
          case 'prefix':
            if (cand === rule.prefix || cand.startsWith(rule.prefix + ' ')) {
              return true
            }
            break
          case 'exact':
            if (cand === rule.command) {
              return true
            }
            break
          case 'wildcard':
            if (matchWildcardPattern(rule.pattern, cand)) {
              return true
            }
            break
        }
      }
    }
    return false
  })
}

export function shouldUseSandbox(input: Partial<SandboxInput>): boolean {
  if (!SandboxManager.isSandboxingEnabled() || !input.command) {
    return false
  }
  // Strict policy takes precedence over both the explicit flag and exclusions.
  if (!SandboxManager.areUnsandboxedCommandsAllowed()) return true
  return !input.dangerouslyDisableSandbox && !isExcludedCommand(input.command)
}
