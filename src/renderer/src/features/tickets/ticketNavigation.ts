import type { SdpBridgeContext } from '@shared/sdpLinks';

export const TICKET_NAVIGATION_EVENT = 'relay:ticket-navigation';
export type TicketNavigation =
  | {
      destination: 'ticket';
      source?: 'sdp';
      ticketId?: string;
      problem?: { problemId: string; environmentUrl: string };
      major?: boolean;
    }
  | { destination: 'problem'; problemId: string }
  | { destination: 'bridge'; bridge: SdpBridgeContext };
export function navigateTicketWorkspace(detail: TicketNavigation): void {
  window.dispatchEvent(new CustomEvent(TICKET_NAVIGATION_EVENT, { detail }));
}
