import type { SdpQueueTicket } from '@shared/sdpAccount';
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
      {ticket.replyState === 'ready' && !reply && <span>No email replies</span>}
    </span>
  );
}
