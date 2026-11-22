import axios from 'axios'
import z from 'zod/v4'
import { lazySchema } from '../lazySchema.js'

export function isTransientNetworkError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false
  }

  // Retry on network errors (no response received)
  if (!error.response) {
    return true
  }

  // Retry on server errors (5xx)
  if (error.response.status >= 500) {
    return true
  }

  // Don't retry on client errors (4xx) - they're not transient
  return false
}

export type SessionStatus = 'requires_action' | 'running' | 'idle' | 'archived'

export type GitSource = {
  type: 'git_repository'
  url: string
  revision?: string | null
  allow_unrestricted_git_push?: boolean
}

export type KnowledgeBaseSource = {
  type: 'knowledge_base'
  knowledge_base_id: string
}

export type SessionContextSource = GitSource | KnowledgeBaseSource

// Outcome types from api/schemas/sandbox.py
export type OutcomeGitInfo = {
  type: 'github'
  repo: string
  branches: string[]
}

export type GitRepositoryOutcome = {
  type: 'git_repository'
  git_info: OutcomeGitInfo
}

export type Outcome = GitRepositoryOutcome

export type SessionContext = {
  sources: SessionContextSource[]
  cwd: string
  outcomes: Outcome[] | null
  custom_system_prompt: string | null
  append_system_prompt: string | null
  model: string | null
  // Seed filesystem with a git bundle on Files API
  seed_bundle_file_id?: string
  github_pr?: { owner: string; repo: string; number: number }
  reuse_outcome_branches?: boolean
}

export type SessionResource = {
  type: 'session'
  id: string
  title: string | null
  session_status: SessionStatus
  environment_id: string
  created_at: string
  updated_at: string
  session_context: SessionContext
}

export type ListSessionsResponse = {
  data: SessionResource[]
  has_more: boolean
  first_id: string | null
  last_id: string | null
}

export const CodeSessionSchema = lazySchema(() =>
  z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    status: z.enum([
      'idle',
      'working',
      'waiting',
      'completed',
      'archived',
      'cancelled',
      'rejected',
    ]),
    repo: z
      .object({
        name: z.string(),
        owner: z.object({
          login: z.string(),
        }),
        default_branch: z.string().optional(),
      })
      .nullable(),
    turns: z.array(z.string()),
    created_at: z.string(),
    updated_at: z.string(),
  }),
)

// Export the inferred type from the Zod schema
export type CodeSession = z.infer<ReturnType<typeof CodeSessionSchema>>

export type RemoteMessageContent =
  | string
  | Array<{ type: string; [key: string]: unknown }>

const unavailable = 'Hosted sessions are unavailable in Nexus.'

export async function prepareApiRequest(): Promise<{
  accessToken: string
  orgUUID: string
}> {
  throw new Error(unavailable)
}

export async function fetchCodeSessionsFromSessionsAPI(): Promise<CodeSession[]> {
  return []
}

export function getOAuthHeaders(token: string): Record<string,string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

export async function fetchSession(
  sessionId: string,
): Promise<SessionResource> {
  throw new Error(unavailable)
}
