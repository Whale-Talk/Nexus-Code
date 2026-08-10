// Nexus: feature flag shim that enables select agent features whose code is
// complete but gated behind bun:bundle's feature() which always returns false
// in dev mode (restored build, no compilation step).

const ENABLED = new Set([
  'BUILTIN_EXPLORE_PLAN_AGENTS',  // Explore + Plan subagent types
  'VERIFICATION_AGENT',           // Verification subagent type
])

export function feature(name: string): boolean {
  return ENABLED.has(name)
}
