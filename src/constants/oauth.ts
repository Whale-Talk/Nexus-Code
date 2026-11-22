export const HOSTED_ACCOUNT_INFERENCE_SCOPE = 'user:inference' as const
export const HOSTED_ACCOUNT_PROFILE_SCOPE = 'user:profile' as const
const CONSOLE_SCOPE = 'org:create_api_key' as const
export const OAUTH_BETA_HEADER = 'oauth-2025-04-20' as const

// Console OAuth scopes - for API key creation via Console
export const CONSOLE_OAUTH_SCOPES = [
  CONSOLE_SCOPE,
  HOSTED_ACCOUNT_PROFILE_SCOPE,
] as const

export const HOSTED_ACCOUNT_OAUTH_SCOPES = [
  HOSTED_ACCOUNT_PROFILE_SCOPE,
  HOSTED_ACCOUNT_INFERENCE_SCOPE,
  'user:sessions:nexus_code',
  'user:mcp_servers',
  'user:file_upload',
] as const

// All OAuth scopes - union of all scopes used in Nexus CLI
// Ensure that `OAuthConsentPage` in apps repo is kept in sync with this list.
export const ALL_OAUTH_SCOPES = Array.from(
  new Set([...CONSOLE_OAUTH_SCOPES, ...HOSTED_ACCOUNT_OAUTH_SCOPES]),
)

type OauthConfig = {
  BASE_API_URL: string
  CONSOLE_AUTHORIZE_URL: string
  HOSTED_ACCOUNT_AUTHORIZE_URL: string
  /**
   */
  HOSTED_ACCOUNT_ORIGIN: string
  TOKEN_URL: string
  API_KEY_URL: string
  ROLES_URL: string
  CONSOLE_SUCCESS_URL: string
  HOSTED_ACCOUNT_SUCCESS_URL: string
  MANUAL_REDIRECT_URL: string
  CLIENT_ID: string
  OAUTH_FILE_SUFFIX: string
  MCP_PROXY_URL: string
  MCP_PROXY_PATH: string
}

/** Hosted login and remote-session services are retired. MCP OAuth discovers its own endpoints. */
export function getOauthConfig(): OauthConfig {
  throw new Error('Nexus does not provide a hosted account service')
}
