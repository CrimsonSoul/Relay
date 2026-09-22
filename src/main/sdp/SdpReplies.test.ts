import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SdpQueueTicket } from '@shared/sdpAccount';
import { latestReply, SdpReplyTracker } from './SdpReplies';
import { SdpProvider, SdpProviderError } from './SdpProvider';
const ticket: SdpQueueTicket = {
  id: '123',
  number: '42',
  subject: 'Dummy',
  status: 'Open',
  priority: 'Low',
  group: 'NOC',
  technician: 'Example',
  createdAt: 100,
  dueAt: null,
  updatedAt: 100,
};
const message = { id: '51', author: 'Example sender', senderRole: 'requester' as const, at: 1000 };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
});
afterEach(() => vi.useRealTimers());
it('uses the SDP email-only feed and projects sender role without contacts or body', async () => {
  const provider = new SdpProvider();
  const json = vi.spyOn(provider, 'json').mockResolvedValue({
    conversations: [
      {
        id: '51',
        type: 'REQREPLY',
        created_time: { value: '1000' },
        created_by: {
          name: 'Example sender',
          is_technician: true,
          email_id: 'private@example.test',
          phone: 'private',
        },
        description: 'private body',
      },
    ],
  });
  expect(await latestReply(provider, 'test', new AbortController().signal, '123')).toEqual({
    ...message,
    senderRole: 'technician',
  });
  const url = new URL(json.mock.calls[0]![0]);
  expect(url.pathname).toBe('/app/itdesk/api/v3/requests/123/conversations');
  expect(JSON.parse(url.searchParams.get('input_data')!).list_info).toMatchObject({
    row_count: 1,
    sort_field: 'created_time',
    sort_order: 'desc',
    search_criteria: {
      field: 'type',
      values: ['NOTES'],
      children: [
        { field: 'created_by.user_type', values: ['1'] },
        { field: 'type', values: ['ApprovalComments'] },
      ],
    },
  });
  json.mockResolvedValue({
    conversations: [{ id: '51', type: 'NOTES', created_by: {}, created_time: { value: '1000' } }],
  });
  await expect(
    latestReply(provider, 'test', new AbortController().signal, '123'),
  ).rejects.toThrow();
  await expect(
    latestReply(provider, 'test', new AbortController().signal, '../other'),
  ).rejects.toThrow();
});
it('baselines silently, detects real replies, and only clears unread for delivered message IDs', async () => {
  const tracker = new SdpReplyTracker();
  const read = vi.fn().mockResolvedValue(message);
  let [row] = await tracker.update('a', [ticket], read, true);
  expect(row).toMatchObject({ lastReply: message, replyUnread: false, replyState: 'ready' });
  expect(row!.replyEventId).toBeUndefined();
  [row] = await tracker.update('a', [{ ...ticket, updatedAt: 200 }], read);
  expect(row!.replyEventId).toBeUndefined();
  read.mockResolvedValue({ ...message, id: '52', at: 11000 });
  vi.setSystemTime(12000);
  [row] = await tracker.update('a', [{ ...ticket, updatedAt: 300 }], read);
  expect(row).toMatchObject({ replyUnread: true, replyEventId: '52' });
  tracker.markRead('a', ticket.id, ['51']);
  expect(tracker.decorate('a', [ticket])[0]!.replyUnread).toBe(true);
  tracker.markRead('a', ticket.id, ['52']);
  expect(tracker.decorate('a', [ticket])[0]!.replyUnread).toBe(false);
  await tracker.update('a', [{ ...ticket, updatedAt: 400 }], read);
  expect(tracker.decorate('a', [ticket])[0]!.replyUnread).toBe(false);
  read.mockResolvedValue({ ...message, id: '53', at: 13000, senderRole: 'technician' });
  [row] = await tracker.update('a', [{ ...ticket, updatedAt: 500 }], read);
  expect(row).toMatchObject({
    replyUnread: true,
    replyEventId: '53',
    lastReply: { senderRole: 'technician' },
  });
});
it('polls visible conversations without relying on request timestamps and bounds work fairly', async () => {
  const tracker = new SdpReplyTracker();
  const read = vi.fn().mockResolvedValue(message);
  const rows = Array.from({ length: 25 }, (_, i) => ({ ...ticket, id: String(i + 1) }));
  await tracker.update('a', rows, read);
  expect(read).not.toHaveBeenCalled();
  await tracker.update('a', rows, read, true);
  expect(read).toHaveBeenCalledTimes(12);
  vi.setSystemTime(40000);
  await tracker.update('a', rows, read);
  expect(read).toHaveBeenCalledTimes(24);
  expect(new Set(read.mock.calls.map(([id]) => id)).size).toBe(24);
  vi.setSystemTime(70000);
  await tracker.update('a', rows, read);
  expect(new Set(read.mock.calls.map(([id]) => id)).size).toBe(25);
});
it('backoffs on metadata failure without inventing no replies, then recovers', async () => {
  const tracker = new SdpReplyTracker();
  const read = vi.fn().mockRejectedValue(new SdpProviderError('throttled', 60000));
  const [row] = await tracker.update('a', [ticket], read, true);
  expect(row!.replyState).toBe('unavailable');
  vi.setSystemTime(40000);
  await tracker.update('a', [ticket], read);
  expect(read).toHaveBeenCalledTimes(1);
  read.mockResolvedValue(message);
  vi.setSystemTime(71000);
  expect((await tracker.update('a', [ticket], read))[0]).toMatchObject({
    replyState: 'ready',
    lastReply: message,
  });
});
it('shares work only within an owner and discards in-flight metadata after clear', async () => {
  const tracker = new SdpReplyTracker();
  let finish!: (value: typeof message) => void;
  const read = vi.fn(
    () =>
      new Promise<typeof message>((resolve) => {
        finish = resolve;
      }),
  );
  const first = tracker.update('a', [ticket], read, true);
  const second = tracker.update('a', [ticket], read, true);
  await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(1);
  tracker.clear('a');
  finish(message);
  await Promise.all([first, second]);
  expect(tracker.decorate('a', [ticket])[0]!.lastReply).toBeUndefined();
  expect(tracker.decorate('b', [ticket])[0]!.lastReply).toBeUndefined();
});
it('rejects authorization failures instead of retaining an apparently live reply', async () => {
  const tracker = new SdpReplyTracker();
  const read = vi.fn().mockRejectedValue(new SdpProviderError('denied'));
  await expect(tracker.update('a', [ticket], read, true)).rejects.toMatchObject({ kind: 'denied' });
});
it('prioritizes the open ticket and does not confuse a generic SDP unread change with an unread email', async () => {
  const tracker = new SdpReplyTracker();
  const read = vi.fn().mockResolvedValue(message);
  const [initial] = await tracker.update('a', [{ ...ticket, providerUnread: true }], read, true);
  expect(initial!.replyUnread).toBe(false);
  const focused = { ...ticket, id: '99' };
  await tracker.refreshTicket('a', focused, read);
  const rows = Array.from({ length: 25 }, (_, i) => ({ ...ticket, id: String(i + 1) }));
  await tracker.update('a', rows, read, true);
  // Queue navigation can change the visible rows; the open ticket remains a priority.
  vi.setSystemTime(41000);
  read.mockClear();
  await tracker.update('a', [focused, ...rows], read);
  expect(read.mock.calls[0]![0]).toBe('99');
});
it('does not announce older messages exposed by deleting the latest reply', async () => {
  const tracker = new SdpReplyTracker();
  const read = vi.fn().mockResolvedValue({ ...message, at: 5000 });
  await tracker.update('a', [ticket], read, true);
  read.mockResolvedValue({ ...message, id: '50', at: 1000 });
  const [row] = await tracker.update('a', [{ ...ticket, updatedAt: 200 }], read);
  expect(row!.replyEventId).toBeUndefined();
  expect(row!.replyUnread).toBe(false);
});
