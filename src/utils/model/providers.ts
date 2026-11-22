import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { isEnvTruthy } from '../envUtils.js'

export type APIProvider = 'channel' | 'bedrock' | 'vertex' | 'foundry'

export function getAPIProvider(): APIProvider {
  return isEnvTruthy(process.env.NEXUS_USE_BEDROCK)
    ? 'bedrock'
    : isEnvTruthy(process.env.NEXUS_USE_VERTEX)
      ? 'vertex'
      : isEnvTruthy(process.env.NEXUS_USE_FOUNDRY)
        ? 'foundry'
        : 'channel'
}

export function getAPIProviderForTelemetry(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/** Nexus model channels authenticate inference requests only. */
export function hasHostedAccountService(): boolean {
  return false
}
