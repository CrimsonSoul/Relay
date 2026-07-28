import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RadarSnapshot } from '@shared/ipc';
import { RADAR_REFRESH_INTERVAL_MS, RadarManager } from './RadarManager';

vi.mock('../../logger', () => ({
  loggers: {
    main: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  },
}));

function snapshotWith(overrides: Partial<RadarSnapshot> = {}): RadarSnapshot {
  return {
    color: 'green',
    dispatchers: [],
    papa: [],
    metrics: [],
    xcenter: { ok: 1, pending: 2 },
    currentTime: null,
    lastUpdated: 1,
    signInRequired: false,
    error: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RadarManager', () => {
  it('polls on the dashboard’s own one-minute cadence', async () => {
    const fetchSnapshot = vi.fn(async () => snapshotWith());
    const manager = new RadarManager(fetchSnapshot);

    manager.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(RADAR_REFRESH_INTERVAL_MS);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(RADAR_REFRESH_INTERVAL_MS);
    expect(fetchSnapshot).toHaveBeenCalledTimes(3);

    manager.stop();
  });

  it('stops polling once stopped', async () => {
    const fetchSnapshot = vi.fn(async () => snapshotWith());
    const manager = new RadarManager(fetchSnapshot);

    manager.start();
    await vi.advanceTimersByTimeAsync(0);
    manager.stop();

    await vi.advanceTimersByTimeAsync(RADAR_REFRESH_INTERVAL_MS * 3);
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);
  });

  it('is idempotent on repeated starts, so it cannot double its poll rate', async () => {
    const fetchSnapshot = vi.fn(async () => snapshotWith());
    const manager = new RadarManager(fetchSnapshot);

    manager.start();
    manager.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(RADAR_REFRESH_INTERVAL_MS);

    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    manager.stop();
  });

  /** A manual refresh landing next to a scheduled tick must not double up. */
  it('coalesces concurrent refreshes onto one request', async () => {
    let release: (snapshot: RadarSnapshot) => void = () => {};
    const fetchSnapshot = vi.fn(
      () =>
        new Promise<RadarSnapshot>((resolve) => {
          release = resolve;
        }),
    );
    const manager = new RadarManager(fetchSnapshot);

    const first = manager.refresh();
    const second = manager.refresh();
    expect(fetchSnapshot).toHaveBeenCalledTimes(1);

    release(snapshotWith({ color: 'yellow' }));
    expect((await first).color).toBe('yellow');
    expect((await second).color).toBe('yellow');
  });

  it('notifies subscribers with each new snapshot', async () => {
    const fetchSnapshot = vi.fn(async () => snapshotWith({ color: 'red' }));
    const manager = new RadarManager(fetchSnapshot);
    const listener = vi.fn();

    manager.subscribe(listener);
    await manager.refresh();

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ color: 'red' }));
  });

  it('stops notifying after unsubscribe', async () => {
    const manager = new RadarManager(async () => snapshotWith());
    const listener = vi.fn();

    const unsubscribe = manager.subscribe(listener);
    unsubscribe();
    await manager.refresh();

    expect(listener).not.toHaveBeenCalled();
  });

  /** One bad listener must not stop the others from being told. */
  it('keeps notifying the remaining subscribers when one throws', async () => {
    const manager = new RadarManager(async () => snapshotWith());
    const healthy = vi.fn();

    manager.subscribe(() => {
      throw new Error('listener blew up');
    });
    manager.subscribe(healthy);

    await expect(manager.refresh()).resolves.toBeTruthy();
    expect(healthy).toHaveBeenCalledOnce();
  });

  it('keeps polling after a fetcher throws outright', async () => {
    const fetchSnapshot = vi
      .fn<() => Promise<RadarSnapshot>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(snapshotWith());
    const manager = new RadarManager(fetchSnapshot);

    manager.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(manager.getSnapshot().error).toBe('boom');

    await vi.advanceTimersByTimeAsync(RADAR_REFRESH_INTERVAL_MS);
    expect(manager.getSnapshot().error).toBeNull();

    manager.stop();
  });

  it('reports an empty snapshot before the first reading lands', () => {
    const manager = new RadarManager(async () => snapshotWith());

    expect(manager.getSnapshot()).toEqual({
      color: 'unknown',
      dispatchers: [],
      papa: [],
      metrics: [],
      xcenter: { ok: null, pending: null },
      currentTime: null,
      lastUpdated: 0,
      signInRequired: false,
      error: null,
    });
  });
});
