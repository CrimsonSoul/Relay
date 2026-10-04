import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeIndexStatusService } from '../KnowledgeIndexStatusService';

describe('KnowledgeIndexStatusService', () => {
  const getFullList = vi.fn();
  const collection = vi.fn(() => ({ getFullList }));
  const pb = { collection };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a stable idle status before PocketBase is available', async () => {
    const service = new KnowledgeIndexStatusService(() => null);

    await expect(service.getStatus()).resolves.toEqual({
      state: 'idle',
      documentCount: 0,
      categoryCount: 0,
      lastIndexedAt: null,
    });
    expect(collection).not.toHaveBeenCalled();
  });

  it('returns an empty PocketBase-backed status without filesystem state', async () => {
    getFullList.mockResolvedValue([]);
    const service = new KnowledgeIndexStatusService(() => pb as never);

    await expect(service.getStatus()).resolves.toEqual({
      state: 'idle',
      documentCount: 0,
      categoryCount: 0,
      lastIndexedAt: null,
    });
    expect(getFullList).toHaveBeenCalledWith({
      fields: 'category,indexedAt,lifecycleState',
      requestKey: null,
    });
  });

  it('counts active documents and categories and uses the newest indexed timestamp', async () => {
    getFullList.mockResolvedValue([
      {
        category: 'Operations',
        indexedAt: '2026-07-12T12:00:00.000Z',
        lifecycleState: 'active',
      },
      {
        category: 'Operations',
        indexedAt: '2026-07-14T12:00:00.000Z',
        lifecycleState: 'active',
      },
      {
        category: 'Network',
        indexedAt: '2026-07-13T12:00:00.000Z',
        lifecycleState: 'active',
      },
      {
        category: 'Retired',
        indexedAt: '2026-07-15T12:00:00.000Z',
        lifecycleState: 'trashed',
      },
    ]);
    const service = new KnowledgeIndexStatusService(() => pb as never);

    await expect(service.getStatus()).resolves.toEqual({
      state: 'idle',
      documentCount: 3,
      categoryCount: 2,
      lastIndexedAt: '2026-07-14T12:00:00.000Z',
    });
  });

  it('returns a bounded error status when PocketBase cannot be read', async () => {
    getFullList.mockRejectedValue(new Error('token=secret source=/private/path'));
    const service = new KnowledgeIndexStatusService(() => pb as never);

    await expect(service.getStatus()).resolves.toEqual({
      state: 'error',
      documentCount: 0,
      categoryCount: 0,
      lastIndexedAt: null,
      message: 'Knowledge library status unavailable',
    });
  });

  describe('onChange', () => {
    const unsubscribeRealtime = vi.fn(async () => undefined);
    let realtimeListener: (() => void) | undefined;
    const subscribe = vi.fn(async (_topic: string, listener: () => void) => {
      realtimeListener = listener;
      return unsubscribeRealtime;
    });
    const watchedPb = { collection: vi.fn(() => ({ getFullList, subscribe })) };
    const record = (category: string, indexedAt: string) => ({
      category,
      indexedAt,
      lifecycleState: 'active',
    });

    beforeEach(() => {
      vi.useFakeTimers();
      realtimeListener = undefined;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('reports a document change once per burst and stays quiet while nothing changes', async () => {
      getFullList.mockResolvedValue([record('Operations', '2026-07-12T12:00:00.000Z')]);
      const service = new KnowledgeIndexStatusService(() => watchedPb as never);
      const listener = vi.fn();
      const stop = service.onChange(listener);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(subscribe).toHaveBeenCalledWith('*', expect.any(Function));

      realtimeListener?.();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(listener).toHaveBeenCalledTimes(1);

      getFullList.mockResolvedValue([
        record('Operations', '2026-07-12T12:00:00.000Z'),
        record('Network', '2026-07-13T12:00:00.000Z'),
      ]);
      const readsBefore = getFullList.mock.calls.length;
      realtimeListener?.();
      realtimeListener?.();
      realtimeListener?.();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(getFullList.mock.calls.length - readsBefore).toBe(1);
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenLastCalledWith({
        state: 'idle',
        documentCount: 2,
        categoryCount: 2,
        lastIndexedAt: '2026-07-13T12:00:00.000Z',
      });

      stop();
      await vi.advanceTimersByTimeAsync(0);
      expect(unsubscribeRealtime).toHaveBeenCalledOnce();
      getFullList.mockClear();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(getFullList).not.toHaveBeenCalled();
    });

    it('does not push a transient read failure over the last good status', async () => {
      getFullList.mockResolvedValue([record('Operations', '2026-07-12T12:00:00.000Z')]);
      const service = new KnowledgeIndexStatusService(() => watchedPb as never);
      const listener = vi.fn();
      const stop = service.onChange(listener);
      await vi.advanceTimersByTimeAsync(1_000);

      getFullList.mockRejectedValue(new Error('offline'));
      realtimeListener?.();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(listener).toHaveBeenCalledOnce();
      stop();
    });
  });
});
