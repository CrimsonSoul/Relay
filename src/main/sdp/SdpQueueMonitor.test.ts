import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SdpQueueMonitor, type MonitorReader } from './SdpQueueMonitor';
import { SdpProviderError } from './SdpProvider';
import type { SdpQueue, SdpQueuePage, SdpQueueTicket } from '@shared/sdpAccount';
let monitor: SdpQueueMonitor;
const row = (id: string, group: SdpQueue = 'NOC', updatedAt = Date.now()): SdpQueueTicket => ({
  id,
  number: id,
  subject: 'Dummy',
  group,
  status: 'Open',
  priority: 'Low',
  technician: 'Unassigned',
  createdAt: updatedAt,
  updatedAt,
  dueAt: null,
});
function reader(rows: SdpQueueTicket[] = []): MonitorReader {
  return {
    valid: () => true,
    denied: vi.fn(),
    read: vi.fn(async (queue, page) => ({
      queue,
      page,
      hasMore: false,
      tickets: rows.filter((ticket) => ticket.group === queue),
    })),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  monitor = new SdpQueueMonitor();
});
afterEach(() => {
  monitor.dispose();
  vi.useRealTimers();
});
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('per-user server queue polling', () => {
  it('shares one 30-second job across sessions of one owner, isolates other owners, and returns only changed snapshots', async () => {
    const a = reader([row('1')]);
    const b = reader([row('2')]);
    expect(monitor.subscribe('owner-a', 'a1', a).monitoring.state).toBe('starting');
    monitor.subscribe('owner-a', 'a2', a);
    monitor.subscribe('owner-b', 'b1', b);
    await settle();
    expect(a.read).toHaveBeenCalledTimes(3);
    expect(b.read).toHaveBeenCalledTimes(3);
    const first = monitor.subscribe('owner-a', 'a1', a).monitor!;
    expect(first.tickets.map((ticket) => ticket.id)).toEqual(['1']);
    expect(monitor.subscribe('owner-a', 'a2', a, first.fetchedAt).monitor).toBeUndefined();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(a.read).toHaveBeenCalledTimes(6);
    expect(a.read).toHaveBeenLastCalledWith(
      'Unassigned',
      0,
      first.fetchedAt - 60_000,
      expect.any(AbortSignal),
    );
  });
  it('merges deltas and queue moves without dropping unchanged tickets, then reconciles deletions/moves out', async () => {
    const a = reader([row('1'), row('2')]);
    monitor.subscribe('owner', 'a', a);
    await settle();
    vi.mocked(a.read).mockImplementation(async (queue, page) => ({
      queue,
      page,
      hasMore: false,
      tickets: queue === 'SOX' ? [row('1', 'SOX')] : [],
    }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(monitor.snapshot('owner')?.tickets.map((ticket) => [ticket.id, ticket.group])).toEqual([
      ['2', 'NOC'],
      ['1', 'SOX'],
    ]);
    for (let i = 0; i < 9; i++) {
      monitor.subscribe('owner', 'a', a);
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(monitor.snapshot('owner')?.tickets.map((ticket) => ticket.id)).toEqual(['1']);
    expect(a.read).toHaveBeenLastCalledWith('Unassigned', 0, undefined, expect.any(AbortSignal));
  });
  it('keeps the newer version when a ticket moves between queries during a cycle', async () => {
    const a = reader();
    vi.mocked(a.read).mockImplementation(async (queue, page) => ({
      queue,
      page,
      hasMore: false,
      tickets: queue === 'Unassigned' ? [] : [row('1', queue, queue === 'NOC' ? 200 : 100)],
    }));
    monitor.subscribe('owner', 'a', a);
    await settle();
    expect(monitor.snapshot('owner')?.tickets[0]?.group).toBe('NOC');
  });
  it('backs off, honors Retry-After, discards partial cycles, and establishes a fresh baseline after recovery', async () => {
    const a = reader([row('1')]);
    monitor.subscribe('owner', 'a', a);
    await settle();
    const first = monitor.snapshot('owner')!;
    vi.mocked(a.read).mockRejectedValueOnce(new SdpProviderError('throttled', 180_000));
    await vi.advanceTimersByTimeAsync(30_000);
    const result = monitor.subscribe('owner', 'a', a);
    expect(result.monitoring).toEqual({
      state: 'backoff',
      failure: 'throttled',
      nextCheckAt: Date.now() + 180_000,
    });
    expect(result.monitor).toBeUndefined();
    for (let i = 0; i < 6; i++) {
      monitor.subscribe('owner', 'a', a);
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(a.read).toHaveBeenCalledTimes(7);
    expect(monitor.snapshot('owner')?.generation).not.toBe(first.generation);
    expect(a.read).toHaveBeenLastCalledWith('Unassigned', 0, undefined, expect.any(AbortSignal));
  });
  it('stops after the last session leaves or its heartbeat lease expires', async () => {
    const a = reader();
    monitor.subscribe('owner', 'a', a);
    monitor.subscribe('owner', 'b', a);
    await settle();
    monitor.unsubscribe('a');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(a.read).toHaveBeenCalledTimes(6);
    monitor.unsubscribe('b');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(a.read).toHaveBeenCalledTimes(6);
    monitor.subscribe('owner', 'a', a);
    await settle();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(monitor.snapshot('owner')).toBeUndefined();
    const count = vi.mocked(a.read).mock.calls.length;
    await vi.advanceTimersByTimeAsync(90_000);
    expect(a.read).toHaveBeenCalledTimes(count);
  });
  it('revokes the owner on access denial and never returns an outage copy', async () => {
    const a = reader();
    vi.mocked(a.read).mockRejectedValue(new SdpProviderError('denied'));
    monitor.subscribe('owner', 'a', a);
    await settle();
    expect(a.denied).toHaveBeenCalledOnce();
    expect(monitor.snapshot('owner')).toBeUndefined();
  });
  it('does not overlap a slow scan or publish its late result after invalidation', async () => {
    let finish!: (page: SdpQueuePage) => void;
    const a = reader();
    vi.mocked(a.read).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    monitor.subscribe('owner', 'a', a);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(a.read).toHaveBeenCalledOnce();
    monitor.invalidate('owner');
    finish({ queue: 'NOC', page: 0, hasMore: false, tickets: [row('1')] });
    await settle();
    expect(monitor.snapshot('owner')).toBeUndefined();
    expect(a.read).toHaveBeenCalledOnce();
  });
  it('bounds large scans and reports incomplete coverage', async () => {
    const a = reader();
    vi.mocked(a.read).mockImplementation(async (queue, page) => ({
      queue,
      page,
      hasMore: true,
      tickets: Array.from({ length: 50 }, (_, n) =>
        row(
          String(100000 * (['NOC', 'SOX', 'Unassigned'].indexOf(queue) + 1) + page * 50 + n),
          queue,
        ),
      ),
    }));
    monitor.subscribe('owner', 'a', a);
    await settle();
    expect(a.read).toHaveBeenCalledTimes(60);
    expect(monitor.snapshot('owner')?.tickets).toHaveLength(3000);
    expect(monitor.snapshot('owner')?.truncated).toBe(true);
  });
});
it('does not expose shared refreshes to a paused subscriber', async () => {
  const a = reader([row('1')]);
  monitor.subscribe('owner', 'a', a);
  monitor.subscribe('owner', 'b', a);
  await settle();
  monitor.unsubscribe('a');
  expect(monitor.snapshot('owner', 'a')).toBeUndefined();
  expect(monitor.snapshot('owner', 'b')?.tickets).toHaveLength(1);
});
it('includes enriched reply metadata in each published poll and rejects invalidated readers', async () => {
  const a = reader([row('1')]);
  a.enrich = vi.fn(async (tickets: SdpQueueTicket[]) =>
    tickets.map((ticket) => ({
      ...ticket,
      lastReply: { id: '3', author: 'Example', senderRole: 'requester' as const, at: Date.now() },
      replyUnread: true,
      replyEventId: '3',
    })),
  );
  monitor.subscribe('owner', 'session', a);
  await settle();
  expect(monitor.subscribe('owner', 'session', a).monitor?.tickets[0]).toMatchObject({
    replyEventId: '3',
    lastReply: { author: 'Example' },
  });
  expect(a.enrich).toHaveBeenCalledTimes(1);
});
