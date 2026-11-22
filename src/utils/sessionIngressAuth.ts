// Hosted session ingress is retired. Local transcripts use sessionStorage.
export function getSessionIngressAuthToken(): string | null {
  return null
}

export function getSessionIngressAuthHeaders(): Record<string, string> {
  return {}
}

export function updateSessionIngressAuthToken(_token: string): void {}
