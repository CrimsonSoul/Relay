import type { BridgeGroup } from '@shared/ipc';
import { LiveSdpQueues } from '../features/tickets/LiveSdpQueues';
import type { TicketNavigation } from '../features/tickets/ticketNavigation';
import '../features/tickets/tickets.css';

export type TicketOpenRequest = Extract<TicketNavigation, { destination: 'ticket' }> & {
  sequence: number;
};
export function TicketsTab({
  groups,
  request,
}: Readonly<{ groups: BridgeGroup[]; request?: TicketOpenRequest }>) {
  return <LiveSdpQueues groups={groups} request={request} />;
}
