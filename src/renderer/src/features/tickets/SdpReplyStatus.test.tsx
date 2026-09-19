import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SdpQueueTicket } from '@shared/sdpAccount';
import { SdpReplyStatus } from './SdpReplyStatus';
const ticket: SdpQueueTicket = {
  id: '1',
  number: '42',
  subject: 'Dummy',
  status: 'Open',
  priority: 'Low',
  group: 'NOC',
  technician: 'Example',
  createdAt: 100,
  dueAt: null,
};
it('shows unread and sender identity/role/time and removes only the unread marker on read', () => {
  const row = {
    ...ticket,
    replyState: 'ready' as const,
    replyUnread: true,
    lastReply: { id: '2', author: 'Example requester', senderRole: 'requester' as const, at: 1000 },
  };
  const { rerender } = render(<SdpReplyStatus ticket={row} />);
  expect(screen.getByText('Unread reply')).toBeInTheDocument();
  expect(screen.getByText(/Last message: Example requester/)).toHaveTextContent('requester');
  expect(document.querySelector('time')).toHaveAttribute('datetime', new Date(1000).toISOString());
  rerender(<SdpReplyStatus ticket={{ ...row, replyUnread: false }} />);
  expect(screen.queryByText('Unread reply')).not.toBeInTheDocument();
  expect(screen.getByText(/Last message: Example requester/)).toBeInTheDocument();
});
it('distinguishes pending and unavailable from a confirmed empty conversation', () => {
  const { rerender } = render(<SdpReplyStatus ticket={{ ...ticket, replyState: 'pending' }} />);
  expect(screen.getByText('Checking replies…')).toBeInTheDocument();
  expect(screen.queryByText('No email replies')).not.toBeInTheDocument();
  rerender(<SdpReplyStatus ticket={{ ...ticket, replyState: 'unavailable' }} />);
  expect(screen.getByText(/Reply updates unavailable/)).toBeInTheDocument();
  rerender(<SdpReplyStatus ticket={{ ...ticket, replyState: 'ready', lastReply: null }} />);
  expect(screen.getByText('No email replies')).toBeInTheDocument();
});
