import { renderHook, waitFor, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { RecordModel } from 'pocketbase';

// --- Mocks ---
const mockGetFullList = vi.fn<() => Promise<RecordModel[]>>();
const mockSubscribe = vi.fn<() => Promise<() => void>>();
const mockUnsubscribe = vi.fn();

let connectionChangeCallback: ((state: string) => void) | null = null;
vi.mock('../../services/pocketbase', () => ({
  getPb: () => ({
    collection: () => ({
      getFullList: mockGetFullList,
      subscribe: mockSubscribe,
    }),
  }),
  isOnline: vi.fn(() => true),
  onConnectionStateChange: vi.fn((cb: (state: string) => void) => {
    connectionChangeCallback = cb;
    return () => {
      connectionChangeCallback = null;
    };
  }),
  handleApiError: vi.fn(),
}));

import { isOnline } from '../../services/pocketbase';
import { useCollection } from '../useCollection';

function makeRecord(id: string, extra: Record<string, unknown> = {}): RecordModel {
  return {
    id,
    collectionId: 'col1',
    collectionName: 'test',
    created: '2026-01-01',
    updated: '2026-01-01',
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetFullList.mockResolvedValue([]);
  mockSubscribe.mockResolvedValue(mockUnsubscribe);
  vi.mocked(isOnline).mockReturnValue(true);
  connectionChangeCallback = null;
  // Reset globalThis.api
  (globalThis as Record<string, unknown>).api = undefined;
});

describe('useCollection', () => {
  it('fetches data on mount and returns records', async () => {
    const records = [makeRecord('1'), makeRecord('2')];
    mockGetFullList.mockResolvedValue(records);

    const { result } = renderHook(() => useCollection('test'));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it('sets error state on fetch failure', async () => {
    mockGetFullList.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Network error');
  });

  it('ignores autocancelled errors from PB SDK', async () => {
    mockGetFullList.mockRejectedValue(new Error('The request was autocancelled'));

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    // autocancelled should not set error
    expect(result.current.error).toBeNull();
  });

  it('subscribes to realtime updates when online', async () => {
    mockGetFullList.mockResolvedValue([]);

    renderHook(() => useCollection('test'));

    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledWith('*', expect.any(Function)));
  });

  it('applies create event from realtime subscription', async () => {
    mockGetFullList.mockResolvedValue([makeRecord('1')]);
    let realtimeCallback: (e: { action: string; record: RecordModel }) => void = () => {};
    mockSubscribe.mockImplementation(async (_topic: string, cb: typeof realtimeCallback) => {
      realtimeCallback = cb;
      return mockUnsubscribe;
    });

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.data).toHaveLength(1));

    act(() => {
      realtimeCallback({ action: 'create', record: makeRecord('2') });
    });

    expect(result.current.data).toHaveLength(2);
  });

  it('applies update event from realtime subscription', async () => {
    mockGetFullList.mockResolvedValue([makeRecord('1', { name: 'old' })]);
    let realtimeCallback: (e: { action: string; record: RecordModel }) => void = () => {};
    mockSubscribe.mockImplementation(async (_topic: string, cb: typeof realtimeCallback) => {
      realtimeCallback = cb;
      return mockUnsubscribe;
    });

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.data).toHaveLength(1));

    act(() => {
      realtimeCallback({ action: 'update', record: makeRecord('1', { name: 'new' }) });
    });

    expect((result.current.data[0] as Record<string, unknown>).name).toBe('new');
  });

  it('applies delete event from realtime subscription', async () => {
    mockGetFullList.mockResolvedValue([makeRecord('1'), makeRecord('2')]);
    let realtimeCallback: (e: { action: string; record: RecordModel }) => void = () => {};
    mockSubscribe.mockImplementation(async (_topic: string, cb: typeof realtimeCallback) => {
      realtimeCallback = cb;
      return mockUnsubscribe;
    });

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.data).toHaveLength(2));

    act(() => {
      realtimeCallback({ action: 'delete', record: makeRecord('1') });
    });

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0].id).toBe('2');
  });

  it('deduplicates create events for existing records', async () => {
    mockGetFullList.mockResolvedValue([makeRecord('1')]);
    let realtimeCallback: (e: { action: string; record: RecordModel }) => void = () => {};
    mockSubscribe.mockImplementation(async (_topic: string, cb: typeof realtimeCallback) => {
      realtimeCallback = cb;
      return mockUnsubscribe;
    });

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.data).toHaveLength(1));

    act(() => {
      realtimeCallback({ action: 'create', record: makeRecord('1') });
    });

    // Should still be 1 — deduplicated
    expect(result.current.data).toHaveLength(1);
  });

  it('uses offline cache when not online', async () => {
    vi.mocked(isOnline).mockReturnValue(false);
    const cachedRecords = [makeRecord('cached-1')];
    (globalThis as Record<string, unknown>).api = {
      cacheRead: vi.fn().mockResolvedValue(cachedRecords),
    };

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0].id).toBe('cached-1');
  });

  it('refetch re-fetches data from collection', async () => {
    vi.mocked(isOnline).mockReturnValue(true);
    const records1 = [makeRecord('1')];
    const records2 = [makeRecord('1'), makeRecord('2')];
    mockGetFullList.mockResolvedValue(records1);

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.data).toHaveLength(1);
    });

    // Now change what getFullList returns
    mockGetFullList.mockResolvedValue(records2);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.data).toHaveLength(2);
  });

  it('unsubscribes on unmount', async () => {
    mockGetFullList.mockResolvedValue([]);

    const { result, unmount } = renderHook(() => useCollection('test'));

    // Wait for fetch to finish
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Give subscribe promise time to resolve
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    unmount();
  });

  it('falls back to offline cache on fetch error', async () => {
    const cachedRecords = [makeRecord('cached-err')];
    (globalThis as Record<string, unknown>).api = {
      cacheRead: vi.fn().mockResolvedValue(cachedRecords),
    };
    mockGetFullList.mockRejectedValue(new Error('Server down'));

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Server down');
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0].id).toBe('cached-err');
  });

  it('handles non-Error objects in catch', async () => {
    mockGetFullList.mockRejectedValue('string error');

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('string error');
  });

  it('calls cacheSnapshot after successful fetch', async () => {
    const cacheSnapshotMock = vi.fn();
    (globalThis as Record<string, unknown>).api = {
      cacheSnapshot: cacheSnapshotMock,
    };
    const records = [makeRecord('1')];
    mockGetFullList.mockResolvedValue(records);

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(cacheSnapshotMock).toHaveBeenCalledWith('test', records);
  });

  it('calls cacheWrite on realtime events', async () => {
    const cacheWriteMock = vi.fn();
    (globalThis as Record<string, unknown>).api = {
      cacheWrite: cacheWriteMock,
    };
    mockGetFullList.mockResolvedValue([]);
    let realtimeCallback: (e: { action: string; record: RecordModel }) => void = () => {};
    mockSubscribe.mockImplementation(async (_topic: string, cb: typeof realtimeCallback) => {
      realtimeCallback = cb;
      return mockUnsubscribe;
    });

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      realtimeCallback({ action: 'create', record: makeRecord('new') });
    });

    expect(cacheWriteMock).toHaveBeenCalledWith(
      'test',
      'create',
      expect.objectContaining({ id: 'new' }),
    );
  });

  it('does not subscribe when offline', async () => {
    vi.mocked(isOnline).mockReturnValue(false);
    (globalThis as Record<string, unknown>).api = {
      cacheRead: vi.fn().mockResolvedValue([]),
    };

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Should not have attempted to subscribe
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('handles offline cache failure gracefully', async () => {
    vi.mocked(isOnline).mockReturnValue(false);
    (globalThis as Record<string, unknown>).api = {
      cacheRead: vi.fn().mockRejectedValue(new Error('cache broken')),
    };

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toHaveLength(0);
  });

  it('sorts records with custom sort option', async () => {
    const records = [makeRecord('2', { sortOrder: 2 }), makeRecord('1', { sortOrder: 1 })];
    mockGetFullList.mockResolvedValue(records);

    const { result } = renderHook(() => useCollection('test', { sort: 'sortOrder' }));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toHaveLength(2);
  });

  it('re-sorts after create event when comparator exists', async () => {
    const records = [makeRecord('1', { sortOrder: 1 })];
    mockGetFullList.mockResolvedValue(records);
    let realtimeCallback: (e: { action: string; record: RecordModel }) => void = () => {};
    mockSubscribe.mockImplementation(async (_topic: string, cb: typeof realtimeCallback) => {
      realtimeCallback = cb;
      return mockUnsubscribe;
    });

    const { result } = renderHook(() => useCollection('test', { sort: 'sortOrder' }));

    await waitFor(() => expect(result.current.data).toHaveLength(1));

    act(() => {
      realtimeCallback({ action: 'create', record: makeRecord('0', { sortOrder: 0 }) });
    });

    expect(result.current.data).toHaveLength(2);
    // The record with sortOrder 0 should come first
    expect(result.current.data[0].id).toBe('0');
  });

  it('handles unknown realtime action gracefully', async () => {
    mockGetFullList.mockResolvedValue([makeRecord('1')]);
    let realtimeCallback: (e: { action: string; record: RecordModel }) => void = () => {};
    mockSubscribe.mockImplementation(async (_topic: string, cb: typeof realtimeCallback) => {
      realtimeCallback = cb;
      return mockUnsubscribe;
    });

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.data).toHaveLength(1));

    act(() => {
      realtimeCallback({ action: 'unknown', record: makeRecord('1') });
    });

    // Data should be unchanged
    expect(result.current.data).toHaveLength(1);
  });

  it('handles descending sort fields with correct order after create', async () => {
    const records = [makeRecord('2', { sortOrder: 2 }), makeRecord('1', { sortOrder: 1 })];
    mockGetFullList.mockResolvedValue(records);
    let realtimeCallback: (e: { action: string; record: RecordModel }) => void = () => {};
    mockSubscribe.mockImplementation(async (_topic: string, cb: typeof realtimeCallback) => {
      realtimeCallback = cb;
      return mockUnsubscribe;
    });

    const { result } = renderHook(() => useCollection('test', { sort: '-sortOrder' }));

    await waitFor(() => expect(result.current.data).toHaveLength(2));

    act(() => {
      realtimeCallback({ action: 'create', record: makeRecord('3', { sortOrder: 3 }) });
    });

    expect(result.current.data).toHaveLength(3);
    // Descending sort: 3, 2, 1
    expect(result.current.data[0].id).toBe('3');
    expect(result.current.data[2].id).toBe('1');
  });

  it('handles null values in sort fields', async () => {
    const records = [makeRecord('1', { name: null }), makeRecord('2', { name: 'alpha' })];
    mockGetFullList.mockResolvedValue(records);
    let realtimeCallback: (e: { action: string; record: RecordModel }) => void = () => {};
    mockSubscribe.mockImplementation(async (_topic: string, cb: typeof realtimeCallback) => {
      realtimeCallback = cb;
      return mockUnsubscribe;
    });

    const { result } = renderHook(() => useCollection('test', { sort: 'name' }));

    await waitFor(() => expect(result.current.data).toHaveLength(2));

    // Update to trigger re-sort with null values
    act(() => {
      realtimeCallback({ action: 'update', record: makeRecord('1', { name: null }) });
    });

    expect(result.current.data).toHaveLength(2);
  });

  it('handles null values in descending sort (null sorts last in desc)', async () => {
    const records = [makeRecord('1', { name: 'alpha' }), makeRecord('2', { name: null })];
    mockGetFullList.mockResolvedValue(records);
    let realtimeCallback: (e: { action: string; record: RecordModel }) => void = () => {};
    mockSubscribe.mockImplementation(async (_topic: string, cb: typeof realtimeCallback) => {
      realtimeCallback = cb;
      return mockUnsubscribe;
    });

    const { result } = renderHook(() => useCollection('test', { sort: '-name' }));

    await waitFor(() => expect(result.current.data).toHaveLength(2));

    act(() => {
      realtimeCallback({ action: 'create', record: makeRecord('3', { name: 'beta' }) });
    });

    expect(result.current.data).toHaveLength(3);
  });

  it('sorts with multi-field comparator', async () => {
    const records = [
      makeRecord('1', { category: 'a', sortOrder: 2 }),
      makeRecord('2', { category: 'a', sortOrder: 1 }),
      makeRecord('3', { category: 'b', sortOrder: 1 }),
    ];
    mockGetFullList.mockResolvedValue(records);
    let realtimeCallback: (e: { action: string; record: RecordModel }) => void = () => {};
    mockSubscribe.mockImplementation(async (_topic: string, cb: typeof realtimeCallback) => {
      realtimeCallback = cb;
      return mockUnsubscribe;
    });

    const { result } = renderHook(() => useCollection('test', { sort: 'category,sortOrder' }));

    await waitFor(() => expect(result.current.data).toHaveLength(3));

    act(() => {
      realtimeCallback({
        action: 'create',
        record: makeRecord('4', { category: 'a', sortOrder: 0 }),
      });
    });

    expect(result.current.data).toHaveLength(4);
    // category 'a' first, then by sortOrder ascending: 0, 1, 2
    expect(result.current.data[0].id).toBe('4');
    expect(result.current.data[1].id).toBe('2');
    expect(result.current.data[2].id).toBe('1');
    expect(result.current.data[3].id).toBe('3');
  });

  it('re-sorts after update event when comparator exists', async () => {
    const records = [makeRecord('1', { sortOrder: 1 }), makeRecord('2', { sortOrder: 2 })];
    mockGetFullList.mockResolvedValue(records);
    let realtimeCallback: (e: { action: string; record: RecordModel }) => void = () => {};
    mockSubscribe.mockImplementation(async (_topic: string, cb: typeof realtimeCallback) => {
      realtimeCallback = cb;
      return mockUnsubscribe;
    });

    const { result } = renderHook(() => useCollection('test', { sort: 'sortOrder' }));

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.data[0].id).toBe('1');

    // Update record 1 to have higher sortOrder so it should move after record 2
    act(() => {
      realtimeCallback({ action: 'update', record: makeRecord('1', { sortOrder: 10 }) });
    });

    expect(result.current.data[0].id).toBe('2');
    expect(result.current.data[1].id).toBe('1');
  });

  it('writes cache snapshot on successful online fetch', async () => {
    const cacheSnapshotMock = vi.fn();
    const cacheWriteMock = vi.fn();
    (globalThis as Record<string, unknown>).api = {
      cacheSnapshot: cacheSnapshotMock,
      cacheWrite: cacheWriteMock,
    };
    const records = [makeRecord('1'), makeRecord('2')];
    mockGetFullList.mockResolvedValue(records);

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(cacheSnapshotMock).toHaveBeenCalledWith('test', records);
  });

  it('falls back to cache on error even without api.cacheRead', async () => {
    (globalThis as Record<string, unknown>).api = {};
    mockGetFullList.mockRejectedValue(new Error('Server down'));

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Server down');
    expect(result.current.data).toHaveLength(0);
  });

  it('does not duplicate when receiving online event while already online', async () => {
    mockGetFullList.mockResolvedValue([makeRecord('1')]);

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Simulate "online" event while already online — should not crash
    if (connectionChangeCallback) {
      act(() => {
        connectionChangeCallback!('online');
      });
    }

    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });

  it('re-fetches when connection goes from offline to online', async () => {
    mockGetFullList.mockResolvedValue([makeRecord('1')]);

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Simulate going offline then online
    const records2 = [makeRecord('1'), makeRecord('2')];
    mockGetFullList.mockResolvedValue(records2);

    // Trigger online event via the connection change callback
    if (connectionChangeCallback) {
      act(() => {
        connectionChangeCallback!('offline');
      });
      act(() => {
        connectionChangeCallback!('online');
      });
    }

    await waitFor(() => expect(result.current.data).toHaveLength(2));
  });

  it('triggers re-subscribe when going offline', async () => {
    mockGetFullList.mockResolvedValue([]);

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    if (connectionChangeCallback) {
      act(() => {
        connectionChangeCallback!('offline');
      });
    }

    // Should not crash
    expect(result.current.error).toBeNull();
  });

  it('calls syncPending when coming back online', async () => {
    const syncPendingMock = vi.fn();
    (globalThis as Record<string, unknown>).api = {
      syncPending: syncPendingMock,
    };
    mockGetFullList.mockResolvedValue([]);

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    if (connectionChangeCallback) {
      // First go offline
      act(() => {
        connectionChangeCallback!('offline');
      });
      // Then come back online
      act(() => {
        connectionChangeCallback!('online');
      });
    }

    expect(syncPendingMock).toHaveBeenCalled();
  });

  it('handles subscribe error gracefully', async () => {
    mockGetFullList.mockResolvedValue([]);
    mockSubscribe.mockRejectedValue(new Error('subscribe failed'));

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Should not crash - error is caught internally
    expect(result.current.data).toHaveLength(0);
  });
});
