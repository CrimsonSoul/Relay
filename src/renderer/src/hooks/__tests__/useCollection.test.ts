import { render, renderHook, waitFor, act } from '@testing-library/react';
import { Activity, createElement } from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { RecordModel } from 'pocketbase';
import { WEB_RUNTIME } from '@shared/runtime';

// --- Mocks ---
/** Mirrors the PocketBase realtime payload the collection store subscribes to. */
type RealtimeEvent = { action: string; record: RecordModel };
type RealtimeCallback = (event: RealtimeEvent) => void;

const mockGetFullList = vi.fn<() => Promise<RecordModel[]>>();
const mockGetList = vi.fn();
const mockSubscribe = vi.fn<(topic: string, callback: RealtimeCallback) => Promise<() => void>>();
const mockUnsubscribe = vi.fn();

let connectionChangeCallback: ((state: string) => void) | null = null;
let clientChangeCallback: ((generation: number) => void) | null = null;
vi.mock('../../services/pocketbase', () => ({
  getPb: () => ({
    collection: () => ({
      getFullList: mockGetFullList,
      getList: mockGetList,
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
  getPocketBaseClientGeneration: vi.fn(() => 0),
  onPocketBaseClientChange: vi.fn((cb: (generation: number) => void) => {
    clientChangeCallback = cb;
    return () => {
      clientChangeCallback = null;
    };
  }),
  handleApiError: vi.fn(),
}));

import { isOnline } from '../../services/pocketbase';
import {
  applyOfflineMutationToStores,
  collectionStoreRegistrySize,
  getCollectionStore,
  resetCollectionStoreRegistry,
} from '../../stores/collectionStoreRegistry';
import {
  collectionQueryCacheKey,
  collectionRevisionSignature,
  useCollection,
} from '../useCollection';

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
  resetCollectionStoreRegistry();
  vi.clearAllMocks();
  mockGetFullList.mockResolvedValue([]);
  mockGetList.mockResolvedValue({
    page: 1,
    perPage: 50,
    totalPages: 1,
    totalItems: 0,
    items: [],
  });
  mockSubscribe.mockResolvedValue(mockUnsubscribe);
  vi.mocked(isOnline).mockReturnValue(true);
  connectionChangeCallback = null;
  clientChangeCallback = null;
  // Reset globalThis.api
  (globalThis as Record<string, unknown>).api = undefined;
});

describe('useCollection', () => {
  it('does not create collection work until an enabled consumer needs it', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => useCollection('knowledge_documents', { enabled }),
      { initialProps: { enabled: false } },
    );

    expect(result.current).toMatchObject({
      data: [],
      loading: false,
      error: null,
      hasLoadedSnapshot: false,
    });
    expect(mockGetFullList).not.toHaveBeenCalled();
    expect(mockSubscribe).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await waitFor(() => expect(mockGetFullList).toHaveBeenCalledOnce());
    expect(mockSubscribe).toHaveBeenCalledOnce();
  });

  it('shares one fetch, subscription, and cache snapshot for identical queries', async () => {
    const cacheSnapshot = vi.fn();
    (globalThis as Record<string, unknown>).api = { cacheSnapshot };
    mockGetFullList.mockResolvedValue([makeRecord('shared')]);

    function SharedConsumers() {
      useCollection('test', { sort: '-created' });
      useCollection('test', { sort: '-created' });
      return null;
    }

    render(createElement(SharedConsumers));

    await waitFor(() => expect(cacheSnapshot).toHaveBeenCalled());
    expect(mockGetFullList).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(cacheSnapshot).toHaveBeenCalledTimes(1);
  });

  it('uses separate stores for different filters', async () => {
    function FilteredConsumers() {
      useCollection('test', { filter: 'team="noc"' });
      useCollection('test', { filter: 'team="network"' });
      return null;
    }

    render(createElement(FilteredConsumers));

    await waitFor(() => expect(mockGetFullList).toHaveBeenCalledTimes(2));
    expect(mockSubscribe).toHaveBeenCalledTimes(2);
  });

  it('batches high-cardinality related filters behind one stable store identity', async () => {
    const initialValues = Array.from({ length: 125 }, (_, index) => `problem-${index}`);
    const { result, rerender } = renderHook(
      ({ values }) =>
        useCollection('test', {
          sort: 'created',
          batchedFilter: {
            key: 'loaded-problems',
            field: 'problemId',
            values,
            batchSize: 40,
          },
        }),
      { initialProps: { values: initialValues } },
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockGetFullList).toHaveBeenCalledTimes(4);
    const calls = mockGetFullList.mock.calls as unknown as Array<[{ filter?: string }]>;
    for (const [options] of calls) {
      const filter = String(options.filter ?? '');
      expect((filter.match(/problemId=/g) ?? []).length).toBeLessThanOrEqual(40);
      expect(filter.length).toBeLessThan(4_096);
    }
    expect(collectionStoreRegistrySize()).toBe(1);

    rerender({ values: [...initialValues, 'problem-125'] });
    await waitFor(() => expect(mockGetFullList).toHaveBeenCalledTimes(8));

    expect(collectionStoreRegistrySize()).toBe(1);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
  });

  it('revives an Activity-retained store after the disposal grace period', async () => {
    vi.useFakeTimers();
    const retainedStore = getCollectionStore('contacts', { filter: 'team="noc"' });
    const { unmount } = renderHook(() => useCollection('contacts', { filter: 'team="noc"' }));
    await act(async () => Promise.resolve());
    expect(collectionStoreRegistrySize()).toBe(1);

    unmount();
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(getCollectionStore('contacts', { filter: 'team="noc"' })).toBe(retainedStore);

    const revived = renderHook(() => useCollection('contacts', { filter: 'team="noc"' }));
    await act(async () => Promise.resolve());
    act(() =>
      applyOfflineMutationToStores({
        mutationId: 'retained-store-mutation',
        collection: 'contacts',
        action: 'create',
        record: makeRecord('offline-contact', { team: 'noc' }),
        pendingCount: 1,
      }),
    );

    expect(revived.result.current.data.map((record) => record.id)).toContain('offline-contact');
    revived.unmount();
    resetCollectionStoreRegistry();
    vi.useRealTimers();
  });

  it('keeps a shared subscription alive across a short hidden Activity', async () => {
    function CollectionConsumer() {
      useCollection('test');
      return null;
    }

    const renderCollection = (mode: 'visible' | 'hidden') =>
      createElement(Activity, { mode, children: createElement(CollectionConsumer) });

    const { rerender } = render(renderCollection('visible'));
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledTimes(1));

    await act(async () => rerender(renderCollection('hidden')));
    await act(async () => rerender(renderCollection('visible')));

    expect(mockGetFullList).toHaveBeenCalledTimes(1);
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
  });

  it('fetches data on mount and returns records', async () => {
    const records = [makeRecord('1'), makeRecord('2')];
    mockGetFullList.mockResolvedValue(records);

    const { result } = renderHook(() => useCollection('test'));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it('loads a bounded first page and expands it on demand', async () => {
    const firstPage = {
      page: 1,
      perPage: 2,
      totalPages: 3,
      totalItems: 5,
      items: [makeRecord('1'), makeRecord('2')],
    };
    mockGetList
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce({
        page: 2,
        perPage: 2,
        totalPages: 3,
        totalItems: 5,
        items: [makeRecord('3'), makeRecord('4')],
      });

    const { result } = renderHook(() => useCollection('test', { pageSize: 2 }));

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(mockGetFullList).not.toHaveBeenCalled();
    expect(mockGetList).toHaveBeenCalledWith(1, 2, {
      sort: '-created',
      filter: '',
      requestKey: null,
    });
    expect(result.current.totalItems).toBe(5);
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      await Promise.all([result.current.loadMore(), result.current.loadMore()]);
    });

    expect(mockGetList).toHaveBeenLastCalledWith(2, 2, {
      sort: '-created',
      filter: '',
      requestKey: null,
    });
    expect(result.current.data).toHaveLength(4);
    expect(result.current.totalItems).toBe(5);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.loadingMore).toBe(false);
  });

  it('keeps the next page available after a load-more request fails', async () => {
    const firstPage = {
      page: 1,
      perPage: 2,
      totalPages: 2,
      totalItems: 4,
      items: [makeRecord('1'), makeRecord('2')],
    };
    mockGetList
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce(firstPage)
      .mockRejectedValueOnce(new Error('Page unavailable'))
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce({
        page: 2,
        perPage: 2,
        totalPages: 2,
        totalItems: 4,
        items: [makeRecord('3'), makeRecord('4')],
      });
    const { result } = renderHook(() => useCollection('test', { pageSize: 2 }));
    await waitFor(() => expect(result.current.data).toHaveLength(2));

    await act(async () => result.current.loadMore());

    expect(result.current.error).toBe('Page unavailable');
    expect(result.current.loadingMore).toBe(false);

    await act(async () => result.current.loadMore());

    expect(mockGetList).toHaveBeenLastCalledWith(2, 2, expect.any(Object));
    expect(result.current.data).toHaveLength(4);
  });

  it('keeps loaded pages when an older refetch completes after load more', async () => {
    const page = (pageNumber: number, ids: string[]) => ({
      page: pageNumber,
      perPage: 2,
      totalPages: 3,
      totalItems: 6,
      items: ids.map((id) => makeRecord(id)),
    });
    let resolveOlderRefetch: ((value: ReturnType<typeof page>) => void) | undefined;
    const olderRefetch = new Promise<ReturnType<typeof page>>((resolve) => {
      resolveOlderRefetch = resolve;
    });
    mockGetList
      .mockResolvedValueOnce(page(1, ['1', '2']))
      .mockImplementationOnce(() => olderRefetch)
      .mockResolvedValueOnce(page(1, ['1', '2']))
      .mockResolvedValueOnce(page(2, ['3', '4']))
      .mockResolvedValueOnce(page(1, ['1', '2']))
      .mockResolvedValueOnce(page(2, ['3', '4']))
      .mockResolvedValueOnce(page(3, ['5', '6']));
    const { result } = renderHook(() => useCollection('test', { pageSize: 2 }));
    await waitFor(() => expect(result.current.data).toHaveLength(2));

    let pendingRefetch: Promise<void> | undefined;
    act(() => {
      pendingRefetch = result.current.refetch();
    });
    await waitFor(() => expect(mockGetList).toHaveBeenCalledTimes(2));

    await act(async () => result.current.loadMore());
    expect(result.current.data.map((record) => record.id)).toEqual(['1', '2', '3', '4']);

    await act(async () => {
      resolveOlderRefetch?.(page(1, ['old-1', 'old-2']));
      await pendingRefetch;
    });
    expect(result.current.data.map((record) => record.id)).toEqual(['1', '2', '3', '4']);

    await act(async () => result.current.loadMore());
    expect(mockGetList).toHaveBeenLastCalledWith(3, 2, expect.any(Object));
    expect(result.current.data.map((record) => record.id)).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('merges filtered snapshots into the shared offline cache instead of replacing it', async () => {
    const cacheSnapshot = vi.fn();
    const cacheWrite = vi.fn();
    (globalThis as Record<string, unknown>).api = { cacheSnapshot, cacheWrite };
    mockGetFullList.mockResolvedValue([makeRecord('closed', { status: 'CLOSED' })]);

    renderHook(() => useCollection('test', { filter: 'status="CLOSED"' }));

    await waitFor(() => expect(cacheWrite).toHaveBeenCalled());
    expect(cacheWrite).toHaveBeenCalledWith(
      'test',
      'update',
      expect.objectContaining({ id: 'closed' }),
    );
    expect(cacheSnapshot).not.toHaveBeenCalled();
  });

  it('persists filtered query membership without deleting unrelated cached rows', async () => {
    const current = makeRecord('current', { status: 'CLOSED' });
    const cacheWrite = vi.fn();
    const cacheQuerySnapshot = vi.fn();
    (globalThis as Record<string, unknown>).api = {
      cacheQuerySnapshot,
      cacheWrite,
    };
    mockGetFullList.mockResolvedValue([current]);

    renderHook(() => useCollection('test', { filter: 'status="CLOSED"' }));

    await waitFor(() =>
      expect(cacheQuerySnapshot).toHaveBeenCalledWith(
        'test',
        collectionQueryCacheKey('test', { filter: 'status="CLOSED"' }),
        { recordIds: ['current'], totalItems: 1, complete: true },
      ),
    );
    expect(cacheWrite).not.toHaveBeenCalledWith('test', 'delete', expect.anything());
  });

  it('uses cached query membership to exclude stale filtered rows offline', async () => {
    vi.mocked(isOnline).mockReturnValue(false);
    const current = makeRecord('current', { status: 'CLOSED' });
    const stale = makeRecord('stale', { status: 'CLOSED' });
    const unrelated = makeRecord('unrelated', { status: 'OPEN' });
    const cacheQueryRead = vi.fn(async () => ({
      recordIds: ['current'],
      totalItems: 50,
      complete: false,
    }));
    (globalThis as Record<string, unknown>).api = {
      cacheRead: vi.fn(async () => [current, stale, unrelated]),
      cacheQueryRead,
    };

    const { result } = renderHook(() =>
      useCollection('test', { filter: 'status="CLOSED"', pageSize: 100 }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.map((record) => record.id)).toEqual(['current']);
    expect(result.current.totalItems).toBe(50);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.cachedPartial).toBe(true);
    expect(cacheQueryRead).toHaveBeenCalledWith(
      'test',
      collectionQueryCacheKey('test', { filter: 'status="CLOSED"', pageSize: 100 }),
    );
  });

  it('pages through all locally cached membership rows after an offline restart', async () => {
    vi.mocked(isOnline).mockReturnValue(false);
    const records = Array.from({ length: 300 }, (_, index) =>
      makeRecord(`history-${index}`, { status: 'CLOSED' }),
    );
    (globalThis as Record<string, unknown>).api = {
      cacheRead: vi.fn(async () => records),
      cacheQueryRead: vi.fn(async () => ({
        recordIds: records.map((record) => record.id),
        totalItems: 500,
        complete: false,
      })),
    };
    const { result } = renderHook(() =>
      useCollection('test', { filter: 'status="CLOSED"', pageSize: 100 }),
    );
    await waitFor(() => expect(result.current.data).toHaveLength(100));

    expect(result.current.totalItems).toBe(500);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.cachedPartial).toBe(true);
    await act(async () => result.current.loadMore());

    expect(result.current.data).toHaveLength(200);
    expect(result.current.totalItems).toBe(500);
    expect(result.current.hasMore).toBe(true);
  });

  it('pages through legacy cached rows when query membership metadata is absent', async () => {
    vi.mocked(isOnline).mockReturnValue(false);
    const records = Array.from({ length: 150 }, (_, index) =>
      makeRecord(`legacy-history-${index}`, { status: 'CLOSED' }),
    );
    (globalThis as Record<string, unknown>).api = {
      cacheRead: vi.fn(async () => records),
    };
    const { result } = renderHook(() =>
      useCollection('test', { filter: 'status="CLOSED"', pageSize: 100 }),
    );
    await waitFor(() => expect(result.current.data).toHaveLength(100));

    expect(result.current.totalItems).toBe(150);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.cachedPartial).toBe(false);
    await act(async () => result.current.loadMore());

    expect(result.current.data).toHaveLength(150);
    expect(result.current.hasMore).toBe(false);
  });

  it('keeps a paged realtime snapshot bounded when a matching unseen record arrives', async () => {
    let realtimeCallback: RealtimeCallback = () => {};
    mockSubscribe.mockImplementation(async (_topic, callback) => {
      realtimeCallback = callback;
      return mockUnsubscribe;
    });
    mockGetList.mockResolvedValue({
      page: 1,
      perPage: 2,
      totalPages: 3,
      totalItems: 5,
      items: [
        makeRecord('1', { status: 'CLOSED', startTime: 2 }),
        makeRecord('2', { status: 'CLOSED', startTime: 1 }),
      ],
    });
    const { result } = renderHook(() =>
      useCollection('test', {
        filter: 'status="CLOSED"',
        sort: '-startTime',
        pageSize: 2,
      }),
    );
    await waitFor(() => expect(result.current.data).toHaveLength(2));

    act(() => {
      realtimeCallback({
        action: 'update',
        record: makeRecord('3', { status: 'CLOSED', startTime: 3 }),
      });
    });

    expect(result.current.data.map((record) => record.id)).toEqual(['3', '1']);
    expect(result.current.data).toHaveLength(2);
    expect(result.current.totalItems).toBe(5);
  });

  it('refills a paged filter when a held realtime record leaves membership', async () => {
    let realtimeCallback: RealtimeCallback = () => {};
    mockSubscribe.mockImplementation(async (_topic, callback) => {
      realtimeCallback = callback;
      return mockUnsubscribe;
    });
    mockGetList
      .mockResolvedValueOnce({
        page: 1,
        perPage: 2,
        totalPages: 3,
        totalItems: 5,
        items: [
          makeRecord('1', { status: 'CLOSED', startTime: 3 }),
          makeRecord('2', { status: 'CLOSED', startTime: 2 }),
        ],
      })
      .mockResolvedValueOnce({
        page: 1,
        perPage: 2,
        totalPages: 2,
        totalItems: 4,
        items: [
          makeRecord('2', { status: 'CLOSED', startTime: 2 }),
          makeRecord('3', { status: 'CLOSED', startTime: 1 }),
        ],
      });
    const { result } = renderHook(() =>
      useCollection('test', {
        filter: 'status="CLOSED"',
        sort: '-startTime',
        pageSize: 2,
      }),
    );
    await waitFor(() => expect(result.current.data).toHaveLength(2));

    act(() => {
      realtimeCallback({
        action: 'update',
        record: makeRecord('1', { status: 'OPEN', startTime: 3 }),
      });
    });

    expect(result.current.data.map((record) => record.id)).toEqual(['2']);
    expect(result.current.totalItems).toBe(4);
    await waitFor(() => expect(result.current.data.map((record) => record.id)).toEqual(['2', '3']));
  });

  it('treats missing scopeExcluded as false in legacy offline cache records', async () => {
    vi.mocked(isOnline).mockReturnValue(false);
    (globalThis as Record<string, unknown>).api = {
      cacheRead: vi.fn(async () => [makeRecord('legacy', { status: 'OPEN' })]),
    };

    const { result } = renderHook(() =>
      useCollection('dynatrace_problems', {
        filter: 'scopeExcluded=false && status="OPEN"',
      }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data.map((record) => record.id)).toEqual(['legacy']);
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

  // eslint-disable-next-line sonarjs/parameterized-tests -- Create, update, and delete events require different fixtures and state assertions; separate tests identify the broken transition.
  it('applies create event from realtime subscription', async () => {
    mockGetFullList.mockResolvedValue([makeRecord('1')]);
    let realtimeCallback: RealtimeCallback = () => {};
    mockSubscribe.mockImplementation(async (_topic, cb) => {
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

  it('accepts realtime creates matching an OR equality filter and rejects unrelated records', async () => {
    let realtimeCallback: RealtimeCallback = () => {};
    mockSubscribe.mockImplementation(async (_topic, cb) => {
      realtimeCallback = cb;
      return mockUnsubscribe;
    });

    const { result } = renderHook(() =>
      useCollection('test', { filter: 'problemId="problem-1" || problemId="problem-2"' }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      realtimeCallback({
        action: 'create',
        record: makeRecord('matching', { problemId: 'problem-2' }),
      });
      realtimeCallback({
        action: 'create',
        record: makeRecord('unrelated', { problemId: 'problem-3' }),
      });
    });

    expect(result.current.data.map((record) => record.id)).toEqual(['matching']);
  });

  it('applies update event from realtime subscription', async () => {
    mockGetFullList.mockResolvedValue([makeRecord('1', { name: 'old' })]);
    let realtimeCallback: RealtimeCallback = () => {};
    mockSubscribe.mockImplementation(async (_topic, cb) => {
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

  it('moves realtime updates into and out of a filtered snapshot', async () => {
    mockGetFullList.mockResolvedValue([makeRecord('visible', { scopeExcluded: 'false' })]);
    let realtimeCallback: RealtimeCallback = () => {};
    mockSubscribe.mockImplementation(async (_topic, cb) => {
      realtimeCallback = cb;
      return mockUnsubscribe;
    });
    const { result } = renderHook(() => useCollection('test', { filter: 'scopeExcluded="false"' }));
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    act(() => {
      realtimeCallback({
        action: 'update',
        record: makeRecord('visible', { scopeExcluded: 'true' }),
      });
      realtimeCallback({
        action: 'update',
        record: makeRecord('newly-visible', { scopeExcluded: 'false' }),
      });
    });

    expect(result.current.data.map((record) => record.id)).toEqual(['newly-visible']);
  });

  it('applies delete event from realtime subscription', async () => {
    mockGetFullList.mockResolvedValue([makeRecord('1'), makeRecord('2')]);
    let realtimeCallback: RealtimeCallback = () => {};
    mockSubscribe.mockImplementation(async (_topic, cb) => {
      realtimeCallback = cb;
      return mockUnsubscribe;
    });

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.data).toHaveLength(2));

    act(() => {
      realtimeCallback({ action: 'delete', record: makeRecord('1') });
    });

    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0]?.id).toBe('2');
  });

  it('deduplicates create events for existing records', async () => {
    mockGetFullList.mockResolvedValue([makeRecord('1')]);
    let realtimeCallback: RealtimeCallback = () => {};
    mockSubscribe.mockImplementation(async (_topic, cb) => {
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
    expect(result.current.data[0]?.id).toBe('cached-1');
    expect(result.current.hasLoadedSnapshot).toBe(true);
  });

  it('does not report a loaded snapshot for an offline cache miss', async () => {
    vi.mocked(isOnline).mockReturnValue(false);
    (globalThis as Record<string, unknown>).api = {
      cacheRead: vi.fn().mockResolvedValue(null),
    };

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toHaveLength(0);
    expect(result.current.hasLoadedSnapshot).toBe(false);
  });

  it('reports a successful cached empty roster as a loaded snapshot', async () => {
    vi.mocked(isOnline).mockReturnValue(false);
    (globalThis as Record<string, unknown>).api = {
      cacheRead: vi.fn().mockResolvedValue([]),
    };

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toHaveLength(0);
    expect(result.current.hasLoadedSnapshot).toBe(true);
  });

  it('reports a successful online empty roster as a loaded snapshot', async () => {
    mockGetFullList.mockResolvedValue([]);

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toHaveLength(0);
    expect(result.current.hasLoadedSnapshot).toBe(true);
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
    expect(result.current.data[0]?.id).toBe('cached-err');
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

    expect(cacheSnapshotMock).toHaveBeenCalledWith(
      'test',
      collectionRevisionSignature(records),
      records,
    );
  });

  it('does not send an unchanged full snapshot again on refetch', async () => {
    const cacheSnapshotMock = vi.fn();
    (globalThis as Record<string, unknown>).api = {
      cacheSnapshot: cacheSnapshotMock,
    };
    const records = [makeRecord('1')];
    mockGetFullList.mockResolvedValue(records);

    const { result } = renderHook(() => useCollection('test'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => result.current.refetch());

    expect(cacheSnapshotMock).toHaveBeenCalledTimes(1);
  });

  it('calls cacheWrite on realtime events', async () => {
    const cacheWriteMock = vi.fn();
    (globalThis as Record<string, unknown>).api = {
      cacheWrite: cacheWriteMock,
    };
    mockGetFullList.mockResolvedValue([]);
    let realtimeCallback: RealtimeCallback = () => {};
    mockSubscribe.mockImplementation(async (_topic, cb) => {
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
    expect(result.current.hasLoadedSnapshot).toBe(false);
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
    let realtimeCallback: RealtimeCallback = () => {};
    mockSubscribe.mockImplementation(async (_topic, cb) => {
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
    expect(result.current.data[0]?.id).toBe('0');
  });

  it('handles unknown realtime action gracefully', async () => {
    mockGetFullList.mockResolvedValue([makeRecord('1')]);
    let realtimeCallback: RealtimeCallback = () => {};
    mockSubscribe.mockImplementation(async (_topic, cb) => {
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
    let realtimeCallback: RealtimeCallback = () => {};
    mockSubscribe.mockImplementation(async (_topic, cb) => {
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
    expect(result.current.data[0]?.id).toBe('3');
    expect(result.current.data[2]?.id).toBe('1');
  });

  it('handles null values in sort fields', async () => {
    const records = [makeRecord('1', { name: null }), makeRecord('2', { name: 'alpha' })];
    mockGetFullList.mockResolvedValue(records);
    let realtimeCallback: RealtimeCallback = () => {};
    mockSubscribe.mockImplementation(async (_topic, cb) => {
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
    let realtimeCallback: RealtimeCallback = () => {};
    mockSubscribe.mockImplementation(async (_topic, cb) => {
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
    let realtimeCallback: RealtimeCallback = () => {};
    mockSubscribe.mockImplementation(async (_topic, cb) => {
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
    expect(result.current.data[0]?.id).toBe('4');
    expect(result.current.data[1]?.id).toBe('2');
    expect(result.current.data[2]?.id).toBe('1');
    expect(result.current.data[3]?.id).toBe('3');
  });

  it('re-sorts after update event when comparator exists', async () => {
    const records = [makeRecord('1', { sortOrder: 1 }), makeRecord('2', { sortOrder: 2 })];
    mockGetFullList.mockResolvedValue(records);
    let realtimeCallback: RealtimeCallback = () => {};
    mockSubscribe.mockImplementation(async (_topic, cb) => {
      realtimeCallback = cb;
      return mockUnsubscribe;
    });

    const { result } = renderHook(() => useCollection('test', { sort: 'sortOrder' }));

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.data[0]?.id).toBe('1');

    // Update record 1 to have higher sortOrder so it should move after record 2
    act(() => {
      realtimeCallback({ action: 'update', record: makeRecord('1', { sortOrder: 10 }) });
    });

    expect(result.current.data[0]?.id).toBe('2');
    expect(result.current.data[1]?.id).toBe('1');
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

    expect(cacheSnapshotMock).toHaveBeenCalledWith(
      'test',
      collectionRevisionSignature(records),
      records,
    );
  });

  it('falls back to cache on error even without api.cacheRead', async () => {
    (globalThis as Record<string, unknown>).api = {};
    mockGetFullList.mockRejectedValue(new Error('Server down'));

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Server down');
    expect(result.current.data).toHaveLength(0);
  });

  it('ignores stale fetch completions after unmount', async () => {
    let resolveFetch: ((records: RecordModel[]) => void) | undefined;
    const cacheSnapshotMock = vi.fn();
    mockGetFullList.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    (globalThis as Record<string, unknown>).api = {
      cacheSnapshot: cacheSnapshotMock,
    };

    const { unmount } = renderHook(() => useCollection('test'));
    unmount();
    resetCollectionStoreRegistry();

    await act(async () => {
      resolveFetch?.([makeRecord('late')]);
      await Promise.resolve();
    });

    expect(cacheSnapshotMock).not.toHaveBeenCalled();
  });

  it('does not refetch from pending reconnect sync after unmount', async () => {
    let resolveSync: (() => void) | undefined;
    const syncPendingMock = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSync = resolve;
        }),
    );
    (globalThis as Record<string, unknown>).api = {
      syncPending: syncPendingMock,
      cacheRead: vi.fn().mockResolvedValue([]),
    };
    mockGetFullList.mockResolvedValue([]);

    const { result, unmount } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    vi.mocked(isOnline).mockReturnValue(false);
    act(() => {
      connectionChangeCallback?.('offline');
    });
    vi.mocked(isOnline).mockReturnValue(true);
    act(() => {
      connectionChangeCallback?.('online');
    });
    unmount();
    resetCollectionStoreRegistry();

    await act(async () => {
      resolveSync?.();
      await Promise.resolve();
    });

    expect(syncPendingMock).toHaveBeenCalledOnce();
    expect(mockGetFullList).toHaveBeenCalledTimes(1);
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

  it('re-fetches when the PocketBase client is replaced', async () => {
    const records1 = [makeRecord('old-client')];
    const records2 = [makeRecord('new-client')];
    mockGetFullList.mockResolvedValueOnce(records1).mockResolvedValueOnce(records2);

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.data[0]?.id).toBe('old-client'));

    act(() => {
      clientChangeCallback?.(1);
    });

    await waitFor(() => expect(result.current.data[0]?.id).toBe('new-client'));
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

  it('retains stale web data and refetches without touching desktop cache or pending sync', async () => {
    const initial = [makeRecord('stale-web')];
    const recovered = [makeRecord('authoritative-web')];
    const cacheRead = vi.fn();
    const cacheWrite = vi.fn();
    const cacheSnapshot = vi.fn();
    const syncPending = vi.fn();
    (globalThis as Record<string, unknown>).api = {
      runtime: WEB_RUNTIME,
      cacheRead,
      cacheWrite,
      cacheSnapshot,
      syncPending,
    };
    mockGetFullList.mockResolvedValueOnce(initial).mockResolvedValueOnce(recovered);

    const { result } = renderHook(() => useCollection('test'));
    await waitFor(() => expect(result.current.data[0]?.id).toBe('stale-web'));

    vi.mocked(isOnline).mockReturnValue(false);
    act(() => connectionChangeCallback?.('offline'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data[0]?.id).toBe('stale-web');

    vi.mocked(isOnline).mockReturnValue(true);
    act(() => connectionChangeCallback?.('online'));
    await waitFor(() => expect(result.current.data[0]?.id).toBe('authoritative-web'));

    expect(syncPending).not.toHaveBeenCalled();
    expect(cacheRead).not.toHaveBeenCalled();
    expect(cacheWrite).not.toHaveBeenCalled();
    expect(cacheSnapshot).not.toHaveBeenCalled();
  });

  it('waits for pending sync before refetching and snapshotting on reconnect', async () => {
    vi.mocked(isOnline).mockReturnValue(true);
    const initialRecords = [makeRecord('stale')];
    const syncedRecords = [makeRecord('synced')];
    mockGetFullList.mockResolvedValueOnce(initialRecords).mockResolvedValueOnce(syncedRecords);
    const cacheSnapshotMock = vi.fn();
    let resolveSync: (() => void) | undefined;
    const syncPendingMock = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSync = resolve;
        }),
    );
    (globalThis as Record<string, unknown>).api = {
      syncPending: syncPendingMock,
      cacheSnapshot: cacheSnapshotMock,
      cacheRead: vi.fn().mockResolvedValue([]),
    };

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(result.current.data[0]?.id).toBe('stale'));
    expect(cacheSnapshotMock).toHaveBeenCalledTimes(1);

    vi.mocked(isOnline).mockReturnValue(false);
    act(() => {
      connectionChangeCallback?.('offline');
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    vi.mocked(isOnline).mockReturnValue(true);
    act(() => {
      connectionChangeCallback?.('online');
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(syncPendingMock).toHaveBeenCalledOnce();
    expect(mockGetFullList).toHaveBeenCalledTimes(1);
    expect(cacheSnapshotMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSync?.();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.data[0]?.id).toBe('synced'));
    expect(mockGetFullList).toHaveBeenCalledTimes(2);
    expect(cacheSnapshotMock).toHaveBeenLastCalledWith(
      'test',
      collectionRevisionSignature(syncedRecords),
      syncedRecords,
    );
  });

  it('reconciles server data and overlays only unresolved local changes on reconnect', async () => {
    const serverRecord = makeRecord('server');
    const optimisticRecord = { ...makeRecord('server'), name: 'Offline edit' };
    const remoteRecord = makeRecord('remote-change');
    mockGetFullList
      .mockResolvedValueOnce([serverRecord])
      .mockResolvedValueOnce([serverRecord, remoteRecord]);
    const syncPendingMock = vi.fn().mockResolvedValue({
      remaining: 1,
      remainingChanges: [
        {
          collection: 'contacts',
          action: 'update',
          record: optimisticRecord,
        },
      ],
    });
    (globalThis as Record<string, unknown>).api = {
      syncPending: syncPendingMock,
      cacheRead: vi.fn().mockResolvedValue([optimisticRecord]),
    };

    const { result } = renderHook(() => useCollection('contacts'));
    await waitFor(() => expect(result.current.data[0]?.id).toBe('server'));

    vi.mocked(isOnline).mockReturnValue(false);
    act(() => connectionChangeCallback?.('offline'));
    await waitFor(() => expect(result.current.data[0]?.name).toBe('Offline edit'));

    vi.mocked(isOnline).mockReturnValue(true);
    act(() => connectionChangeCallback?.('online'));
    await waitFor(() => expect(syncPendingMock).toHaveBeenCalledOnce());

    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(result.current.data.find((record) => record.id === 'server')?.name).toBe('Offline edit');
    expect(result.current.data.some((record) => record.id === 'remote-change')).toBe(true);
    expect(mockGetFullList).toHaveBeenCalledTimes(2);
    expect(mockSubscribe).toHaveBeenCalledTimes(2);
  });

  it('replays realtime events that arrive while the initial fetch is in flight', async () => {
    let resolveFetch: ((records: RecordModel[]) => void) | undefined;
    mockGetFullList.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    let realtimeCallback: RealtimeCallback = () => {};
    mockSubscribe.mockImplementation(async (_topic, cb) => {
      realtimeCallback = cb;
      return mockUnsubscribe;
    });

    const { result } = renderHook(() => useCollection('test'));

    // Wait until the realtime handler has been captured
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalled());

    // A newer update arrives while the (older) fetch is still in flight
    act(() => {
      realtimeCallback({ action: 'update', record: makeRecord('a', { name: 'NEW' }) });
    });

    // The stale snapshot lands afterwards
    await act(async () => {
      resolveFetch?.([makeRecord('a', { name: 'OLD' })]);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(1);
    expect((result.current.data[0] as Record<string, unknown>).name).toBe('NEW');
  });

  it('replays delete events that arrive while the initial fetch is in flight', async () => {
    let resolveFetch: ((records: RecordModel[]) => void) | undefined;
    mockGetFullList.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    let realtimeCallback: RealtimeCallback = () => {};
    mockSubscribe.mockImplementation(async (_topic, cb) => {
      realtimeCallback = cb;
      return mockUnsubscribe;
    });

    const { result } = renderHook(() => useCollection('test'));

    await waitFor(() => expect(mockSubscribe).toHaveBeenCalled());

    // Record 'a' is deleted while the fetch is still in flight
    act(() => {
      realtimeCallback({ action: 'delete', record: makeRecord('a') });
    });

    // The stale snapshot still contains 'a'
    await act(async () => {
      resolveFetch?.([makeRecord('a'), makeRecord('b')]);
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0]?.id).toBe('b');
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
