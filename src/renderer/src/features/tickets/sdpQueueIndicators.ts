import type { SdpQueueTicket } from '@shared/sdpAccount';

export type SdpConversationState = {
  tone: 'none' | 'technician' | 'requester' | 'forwarded' | 'other';
  label: string;
  /** Requester replies still waiting for a technician reply. */
  waiting?: number;
};

/**
 * SDP's list-view envelope, from SDP's own conversation status and unreplied count: no replies,
 * technician replied, requester replied (with how many replies wait), or forwarded.
 */
export function conversationState(ticket: SdpQueueTicket): SdpConversationState | undefined {
  if (ticket.notificationStatus === undefined && ticket.unrepliedCount === undefined)
    return undefined;
  const status = (ticket.notificationStatus ?? '').toUpperCase();
  const waiting = ticket.unrepliedCount ?? 0;
  if (waiting > 0 || status.startsWith('REQ'))
    return {
      tone: 'requester',
      label: waiting > 1 ? `${waiting} requester replies waiting` : 'Requester replied',
      ...(waiting > 0 ? { waiting } : {}),
    };
  if (status.includes('FORWARD')) return { tone: 'forwarded', label: 'Forwarded' };
  if (status.startsWith('TECH')) return { tone: 'technician', label: 'Technician replied' };
  if (!status) return { tone: 'none', label: 'No replies' };
  const words = status.toLowerCase().replaceAll('_', ' ');
  return { tone: 'other', label: words.charAt(0).toUpperCase() + words.slice(1) };
}
