import type { SdpQueueTicket } from '@shared/sdpAccount';
import { Tooltip } from '../../components/Tooltip';
import { elapsed } from './sdpQueueFormat';
export function SdpReplyStatus({ ticket }: Readonly<{ ticket: SdpQueueTicket }>) {
  const reply = ticket.lastReply;
  if (!ticket.replyState && !reply) return null;
  return (
    <span className="sdp-reply-status">
      {ticket.replyUnread && <strong className="sdp-unread-reply">Unread reply</strong>}
      {reply && (
        <span>
          Last message: {reply.author} · {reply.senderRole} ·{' '}
          <time dateTime={new Date(reply.at).toISOString()}>
            {new Date(reply.at).toLocaleString()}
          </time>
        </span>
      )}
      {ticket.replyState === 'pending' && <span>Checking replies…</span>}
      {ticket.replyState === 'unavailable' && <span>Reply updates unavailable · retrying</span>}
      {ticket.replyState === 'ready' && !reply && !ticket.replyUnread && (
        <span>No email replies</span>
      )}
    </span>
  );
}

/** Single-line queue cell; the complete last-message summary is a Tooltip here and visible text
    in the ticket workspace (SdpReplyStatus), so the row adds no extra tab stop. */
export function SdpReplyCell({ ticket }: Readonly<{ ticket: SdpQueueTicket }>) {
  const reply = ticket.lastReply;
  let text = '';
  if (reply) text = `${reply.author} · ${reply.senderRole} · ${elapsed(reply.at)}`;
  else if (ticket.replyState === 'pending') text = 'Checking…';
  else if (ticket.replyState === 'unavailable') text = 'Unavailable · retrying';
  else if (ticket.replyState === 'ready' && !ticket.replyUnread) text = 'No email replies';
  const cell = (
    <span className="sdp-reply-cell">
      {ticket.replyUnread && <strong className="sdp-unread-reply">Unread</strong>}
      {text && <span>{text}</span>}
    </span>
  );
  if (!reply) return cell;
  return (
    <Tooltip
      content={`Last message: ${reply.author} · ${reply.senderRole} · ${new Date(reply.at).toLocaleString()}`}
    >
      {cell}
    </Tooltip>
  );
}
