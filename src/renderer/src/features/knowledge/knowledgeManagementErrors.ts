import type { PrivilegedCommandError, PrivilegedCommandResult } from '@shared/privilegedCommands';

// A total record keeps renderer copy synchronized when a command error is added.
export const KNOWLEDGE_MANAGEMENT_ERRORS: Record<PrivilegedCommandError, string> = {
  unauthorized: 'Wiki publisher access is required.',
  locked: 'Publisher access is signed out. Sign in again.',
  offline: 'Wiki management is unavailable while Relay is offline.',
  'pairing-required': 'Pair this workstation before managing the Wiki.',
  'invalid-request': 'Relay rejected the Wiki request.',
  'insufficient-storage': 'Relay does not have enough storage to complete that action.',
  'duplicate-file-name':
    'A published document with this PDF filename already exists. Replace it or rename the PDF.',
  expired: 'The request expired. Try again.',
  replayed: 'Relay could not safely repeat that request.',
  conflict: 'This item changed on the server. Review the refreshed information and try again.',
  'rate-limited': 'Too many Wiki requests. Wait a few minutes and try again.',
  'server-error': 'Relay could not complete the Wiki request.',
};

export function knowledgeCommandError(
  result: Extract<PrivilegedCommandResult, { ok: false }>,
): string {
  return KNOWLEDGE_MANAGEMENT_ERRORS[result.error];
}
