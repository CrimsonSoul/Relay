import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SdpQueueMonitor, type MonitorReader } from './SdpQueueMonitor';
import { SdpProviderError } from './SdpProvider';
import type { SdpQueue, SdpQueueTicket } from '@shared/sdpAccount';
let monitor: SdpQueueMonitor;
const row = (
  id: string,
  group: SdpQueue = 'NOC',
  updatedAt = Date.now(),
  status = 'Open',
): SdpQueueTicket => ({
  id,
  number: id,
  subject: 'Dummy',
  group,
  status,
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
    read: vi.fn(async (queues) => ({
      hasMore: false,
      tickets: rows.filter((ticket) => queues.includes(ticket.group)),
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
const DEFAULTS = ['NOC', 'SOX', 'Unassigned'];

describe('per-user server queue polling', () => {
  it('shares one 30-second read of every queue across sessions of one owner, isolates other owners, and returns only changed snapshots', async () => {
    const a = reader([row('1')]);
    const b = reader([row('2')]);
    expect(monitor.subscribe('owner-a', 'a1', a).monitoring.state).toBe('starting');
    monitor.subscribe('owner-a', 'a2', a);
    monitor.subscribe('owner-b', 'b1', b);
    await settle();
    expect(a.read).toHaveBeenCalledOnce();
    expect(b.read).toHaveBeenCalledOnce();
    const first = monitor.subscribe('owner-a', 'a1', a).monitor!;
    expect(first.tickets.map((ticket) => ticket.id)).toEqual(['1']);
    expect(monitor.subscribe('owner-a', 'a2', a, first.fetchedAt).monitor).toBeUndefined();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(a.read).toHaveBeenCalledTimes(2);
    expect(a.read).toHaveBeenLastCalledWith(
      DEFAULTS,
      0,
      first.fetchedAt - 60_000,
      expect.any(AbortSignal),
    );
  });
  it('merges deltas and queue moves without dropping unchanged tickets, then reconciles deletions/moves out', async () => {
    const a = reader([row('1'), row('2')]);
    monitor.subscribe('owner', 'a', a);
    await settle();
    vi.mocked(a.read).mockImplementation(async () => ({
      hasMore: false,
      tickets: [row('1', 'SOX')],
    }));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(monitor.snapshot('owner')?.tickets.map((ticket) => [ticket.id, ticket.group])).toEqual([
      ['2', 'NOC'],
      ['1', 'SOX'],
    ]);
    // Deletions and moves out of the monitored queues wait for the 10-minute full scan.
    for (let i = 0; i < 18; i++) {
      monitor.subscribe('owner', 'a', a);
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(monitor.snapshot('owner')?.tickets.map((ticket) => ticket.id)).toEqual(['2', '1']);
    monitor.subscribe('owner', 'a', a);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(monitor.snapshot('owner')?.tickets.map((ticket) => ticket.id)).toEqual(['1']);
    expect(a.read).toHaveBeenLastCalledWith(DEFAULTS, 0, undefined, expect.any(AbortSignal));
  });
  it('alerts a resolution from a change scan, keeps resolved tickets out of a full scan, and never adds one already done', async () => {
    const a = reader([row('1'), row('2')]);
    monitor.subscribe('owner', 'a', a);
    await settle();
    // A change scan lists every status: ticket 1 was just resolved; ticket 9 was done long ago.
    vi.mocked(a.read).mockResolvedValue({
      hasMore: false,
      tickets: [row('1', 'NOC', Date.now(), 'Resolved'), row('9', 'NOC', Date.now(), 'Closed')],
      done: ['1', '9'],
    });
    monitor.subscribe('owner', 'a', a);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(monitor.snapshot('owner')?.tickets.map((ticket) => [ticket.id, ticket.status])).toEqual([
      ['2', 'Open'],
      ['1', 'Resolved'],
    ]);
    // The full scan lists unresolved tickets only; the resolved one stays a day after its last
    // change, so its alert still opens it.
    vi.mocked(a.read).mockResolvedValue({ hasMore: false, tickets: [row('2')] });
    const resolvedAt = Date.now();
    for (let i = 0; i < 19; i++) {
      monitor.subscribe('owner', 'a', a);
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(a.read).toHaveBeenLastCalledWith(DEFAULTS, 0, undefined, expect.any(AbortSignal));
    expect(monitor.snapshot('owner')?.tickets.map((ticket) => [ticket.id, ticket.status])).toEqual([
      ['2', 'Open'],
      ['1', 'Resolved'],
    ]);
    vi.setSystemTime(resolvedAt + 24 * 60 * 60_000);
    monitor.subscribe('owner', 'a', a);
    await vi.advanceTimersByTimeAsync(1000);
    expect(monitor.snapshot('owner')?.tickets.map((ticket) => ticket.id)).toEqual(['2']);
  });
  it('keeps the newer version when a ticket moves between pages during a scan', async () => {
    const a = reader();
    vi.mocked(a.read).mockImplementation(async (_queues, page) => ({
      hasMore: page === 0,
      tickets: [row('1', page === 0 ? 'SOX' : 'NOC', page === 0 ? 100 : 200)],
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
    expect(a.read).toHaveBeenCalledTimes(3);
    expect(monitor.snapshot('owner')?.generation).not.toBe(first.generation);
    expect(a.read).toHaveBeenLastCalledWith(DEFAULTS, 0, undefined, expect.any(AbortSignal));
  });
  it('stops after the last session leaves or its heartbeat lease expires', async () => {
    const a = reader();
    monitor.subscribe('owner', 'a', a);
    monitor.subscribe('owner', 'b', a);
    await settle();
    monitor.unsubscribe('a');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(a.read).toHaveBeenCalledTimes(2);
    monitor.unsubscribe('b');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(a.read).toHaveBeenCalledTimes(2);
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
    let finish!: (page: { tickets: SdpQueueTicket[]; hasMore: boolean }) => void;
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
    finish({ hasMore: false, tickets: [row('1')] });
    await settle();
    expect(monitor.snapshot('owner')).toBeUndefined();
    expect(a.read).toHaveBeenCalledOnce();
  });
  it('bounds large scans and reports incomplete coverage', async () => {
    const a = reader();
    vi.mocked(a.read).mockImplementation(async (queues, page) => ({
      hasMore: true,
      tickets: Array.from({ length: 100 }, (_, n) =>
        row(String(100000 + page * 100 + n), queues[page % queues.length]),
      ),
    }));
    monitor.subscribe('owner', 'a', a);
    await settle();
    // Ten pages per monitored queue, read together.
    expect(a.read).toHaveBeenCalledTimes(30);
    expect(monitor.snapshot('owner')?.tickets).toHaveLength(3000);
    expect(monitor.snapshot('owner')?.truncated).toBe(true);
  });
  it('rescans in full only when a delta runs out of pages, not when a full queue keeps its newest 1,000', async () => {
    const full = Array.from({ length: 1000 }, (_, n) => row(String(10_000 + n), 'NOC', 1000 + n));
    const a = reader(full);
    vi.mocked(a.read).mockImplementation(async (_queues, page) => ({
      hasMore: page < 9,
      tickets: full.slice(page * 100, page * 100 + 100),
    }));
    monitor.subscribe('owner', 'a', a);
    await settle();
    // A new ticket pushes the oldest out of the newest 1,000: reported, but no full rescan.
    vi.mocked(a.read).mockResolvedValue({ hasMore: false, tickets: [row('20000')] });
    for (let i = 0; i < 2; i++) {
      monitor.subscribe('owner', 'a', a);
      await vi.advanceTimersByTimeAsync(30_000);
    }
    const since = vi
      .mocked(a.read)
      .mock.calls.slice(-2)
      .map((call) => call[2]);
    expect(since.every((value) => typeof value === 'number')).toBe(true);
    expect(monitor.snapshot('owner')?.tickets).toHaveLength(1000);
    expect(monitor.snapshot('owner')?.tickets[0]?.id).toBe('20000');
    // A delta that fills every page may have missed changes, so the next poll is a full scan.
    vi.mocked(a.read).mockImplementation(async (_queues, page) => ({
      hasMore: true,
      tickets: [row(String(30000 + page))],
    }));
    monitor.subscribe('owner', 'a', a);
    await vi.advanceTimersByTimeAsync(30_000);
    vi.mocked(a.read).mockClear();
    monitor.subscribe('owner', 'a', a);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(vi.mocked(a.read).mock.calls[0]?.[2]).toBeUndefined();
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
it('hands the job to a remaining session when the scanning session leaves mid-scan', async () => {
  let leaving = true;
  const a = reader();
  a.valid = () => leaving;
  vi.mocked(a.read).mockImplementation(async () => {
    leaving = false;
    throw new DOMException('This operation was aborted', 'AbortError');
  });
  const b = reader([row('2')]);
  monitor.subscribe('owner', 'a', a);
  monitor.subscribe('owner', 'b', b);
  await settle();
  await vi.advanceTimersByTimeAsync(1000);
  expect(b.read).toHaveBeenCalled();
  const result = monitor.subscribe('owner', 'b', b);
  expect(result.monitoring).toMatchObject({ state: 'live' });
  expect(result.monitoring).not.toHaveProperty('failure');
  expect(monitor.snapshot('owner', 'b')?.tickets.map((ticket) => ticket.id)).toEqual(['2']);
});

describe('added queues', () => {
  it('scans a queue one session added and shows it only to that session', async () => {
    const shared = reader([row('1'), row('2', 'Network Ops')]);
    monitor.subscribe('owner', 'old-client', shared);
    await settle();
    expect(shared.read).toHaveBeenCalledOnce();
    // A newer client adds a support group; the next poll reconciles every queue in full.
    monitor.subscribe('owner', 'new-client', shared, undefined, ['Network Ops', 'noc']);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(shared.read).toHaveBeenLastCalledWith(
      [...DEFAULTS, 'Network Ops'],
      0,
      undefined,
      expect.any(AbortSignal),
    );
    const ids = (id: string) =>
      monitor.snapshot('owner', id)?.tickets.map((ticket) => [ticket.id, ticket.group]);
    expect(ids('new-client')).toEqual([
      ['1', 'NOC'],
      ['2', 'Network Ops'],
    ]);
    // An older client never receives a queue name outside its own schema.
    expect(ids('old-client')).toEqual([['1', 'NOC']]);
    expect(
      monitor.subscribe('owner', 'old-client', shared).monitor?.tickets.map((t) => t.id),
    ).toEqual(['1']);
    // When no session needs the added queue, deltas stop reading it.
    monitor.unsubscribe('new-client');
    monitor.subscribe('owner', 'old-client', shared);
    vi.mocked(shared.read).mockClear();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(vi.mocked(shared.read).mock.calls.map(([queues]) => queues)).toEqual([DEFAULTS]);
  });
});
