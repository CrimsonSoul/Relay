import type { SdpQueueTicket } from '@shared/sdpAccount';
import { DueTime, technicianLabel } from './sdpQueueFormat';

/** The ticket's key properties at a glance; Edit Ticket changes them. */
export function SdpTicketOverview({ ticket }: Readonly<{ ticket: SdpQueueTicket }>) {
  return (
    <dl className="ticket-metadata sdp-live-summary">
      <div>
        <dt>Status</dt>
        <dd>{ticket.status}</dd>
      </div>
      <div>
        <dt>Priority</dt>
        <dd>{ticket.priority}</dd>
      </div>
      <div>
        <dt>Support group</dt>
        <dd>{ticket.group}</dd>
      </div>
      <div>
        <dt>Technician</dt>
        <dd>{technicianLabel(ticket.technician)}</dd>
      </div>
      <div>
        <dt>Due</dt>
        <dd>
          <DueTime dueAt={ticket.dueAt} focusable />
        </dd>
      </div>
    </dl>
  );
}
