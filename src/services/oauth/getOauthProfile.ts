import type { OAuthProfileResponse } from './types.js'

/** The local runtime has no hosted profile to retrieve with a model credential. */
export async function getOauthProfileFromOauthToken(_token: string): Promise<OAuthProfileResponse | undefined> {
  return undefined
}
