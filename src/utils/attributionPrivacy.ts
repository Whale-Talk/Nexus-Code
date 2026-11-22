import { isEnvTruthy } from './envUtils.js'

/** Optional privacy setting for commits, PRs, and model-identifying prompt text. */
export function isAttributionHidden(): boolean {
  return isEnvTruthy(process.env.NEXUS_HIDE_ATTRIBUTION)
}

export function getAttributionPrivacyInstructions(): string {
  return 'The user has disabled attribution. Omit automated attribution and model or channel identifiers from commit messages and pull requests.'
}
