/**
 * HTTP utility constants and helpers
 */

import { getNexusUserAgent } from './userAgent.js'
import { getWorkload } from './workloadContext.js'

export function getUserAgent(): string {
  const agentSdkVersion = process.env.NEXUS_SDK_VERSION
    ? `, agent-sdk/${process.env.NEXUS_SDK_VERSION}`
    : ''
  // SDK consumers can identify their app/library via NEXUS_SDK_CLIENT_APP
  // e.g., "my-app/1.0.0" or "my-library/2.1"
  const clientApp = process.env.NEXUS_SDK_CLIENT_APP
    ? `, client-app/${process.env.NEXUS_SDK_CLIENT_APP}`
    : ''
  const workload = getWorkload()
  const workloadSuffix = workload ? `, workload/${workload}` : ''
  return `nexus-cli/${MACRO.VERSION} (${process.env.NEXUS_ENTRYPOINT ?? 'cli'}${agentSdkVersion}${clientApp}${workloadSuffix})`
}

export function getMCPUserAgent(): string {
  const parts: string[] = []
  if (process.env.NEXUS_ENTRYPOINT) {
    parts.push(process.env.NEXUS_ENTRYPOINT)
  }
  if (process.env.NEXUS_SDK_VERSION) {
    parts.push(`agent-sdk/${process.env.NEXUS_SDK_VERSION}`)
  }
  if (process.env.NEXUS_SDK_CLIENT_APP) {
    parts.push(`client-app/${process.env.NEXUS_SDK_CLIENT_APP}`)
  }
  const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : ''
  return `nexus-code/${MACRO.VERSION}${suffix}`
}

export function getWebFetchUserAgent(): string {
  return `Nexus-User (${getNexusUserAgent()}; +https://github.com/Whale-Talk/Nexus-Code)`
}

export type AuthHeaders = {
  headers: Record<string, string>
  error?: string
}

/** Retired account endpoints never borrow a model channel credential. */
export function getAuthHeaders(): AuthHeaders {
  return { headers: {}, error: 'Hosted account authentication is unavailable' }
}
