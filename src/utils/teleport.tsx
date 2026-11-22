import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type { Message } from '../types/message.js'
import type { TeleportRemoteResponse } from './conversationRecovery.js'

export type TeleportResult = { messages: Message[]; branchName: string }
export type TeleportProgressStep = 'validating' | 'fetching_logs' | 'fetching_branch' | 'checking_out' | 'done'
export type TeleportProgressCallback = (step: TeleportProgressStep) => void

// Dormant task records may reference a hosted session. Reject it before reading credentials.
const unavailable = 'Hosted sessions are unavailable. Use a local session instead.'

export async function teleportResumeCodeSession(_id: string, _progress?: TeleportProgressCallback): Promise<TeleportRemoteResponse> {
  throw new Error(unavailable)
}

export function processMessagesForTeleportResume(messages: Message[], _error: Error | null): Message[] {
  return messages
}

export async function checkOutTeleportedSessionBranch(_branch?: string): Promise<{ branchName: string; branchError: Error | null }> {
  throw new Error(unavailable)
}

export type PollRemoteSessionResponse = {
  newEvents: SDKMessage[];
  lastEventId: string | null;
  branch?: string;
  sessionStatus?: 'idle' | 'running' | 'requires_action' | 'archived';
};


export async function pollRemoteSessionEvents(_id: string, _afterId: string | null = null, _options?: { skipMetadata?: boolean }): Promise<PollRemoteSessionResponse> {
  throw new Error(unavailable)
}

export async function archiveRemoteSession(_id: string): Promise<void> {
  throw new Error(unavailable)
}
