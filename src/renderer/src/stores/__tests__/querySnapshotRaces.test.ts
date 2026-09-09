import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import type { CachedQueryMembership } from '@shared/ipc';
import { CollectionStore, type CollectionQueryOptions } from '../collectionStore';
type Row = { id: string; team?: string; value?: number };
const transport = vi.hoisted(() => ({
  online: true,
  list: vi.fn(),
  page: vi.fn(),
  connection: (_state: string) => {},
  realtime: (_event: { action: string; record: Row }) => {},
}));
vi.mock('../../services/pocketbase', () => ({
  getPb: () => ({
    collection: () => ({
      getFullList: transport.list,
      getList: transport.page,
      subscribe: async (_topic: string, listener: typeof transport.realtime) => {
        transport.realtime = listener;
        return vi.fn();
      },
    }),
  }),
  isOnline: () => transport.online,
  getPocketBaseClientGeneration: () => 0,
  handleApiError: vi.fn(),
  onConnectionStateChange: (listener: typeof transport.connection) => {
    transport.connection = listener;
    return vi.fn();
  },
  onPocketBaseClientChange: () => vi.fn(),
}));
let store: CollectionStore<Row>;
let disk: Map<string, Row>;
let membership: CachedQueryMembership | null;
let write: ReturnType<typeof vi.fn>;
const saved = { ok: true, persisted: true };
const rows: Row[] = [
  { id: 'a', team: 'alpha', value: 1 },
  { id: 'b', team: 'beta', value: 1 },
];
function start(options: CollectionQueryOptions = { filter: 'value="1" || value="2"' }) {
  store = new CollectionStore<Row>('contacts', options);
  store.subscribe(() => {});
}
beforeEach(() => {
  transport.online = true;
  transport.list.mockReset().mockResolvedValue(rows);
  transport.page.mockReset();
  disk = new Map();
  membership = null;
  write = vi.fn(async (_collection: string, action: string, record: Row) => {
    if (action === 'delete') disk.delete(record.id);
    else disk.set(record.id, { ...record });
    return saved;
  });
  vi.stubGlobal('api', {
    cacheRead: async () => [...disk.values()],
    cacheQueryRead: async () => membership,
    cacheQuerySnapshot: async (_collection: string, _key: string, next: CachedQueryMembership) => {
      membership = next;
      return saved;
    },
    cacheWrite: write,
    cacheSnapshotStatus: async () => ({ complete: false, supported: true }),
  });
});
afterEach(() => {
  store?.dispose();
  vi.unstubAllGlobals();
});
it.each(['realtime update', 'realtime delete', 'queued update', 'queued delete'])(
  'preserves a later-row %s while an earlier query write awaits acknowledgement',
  async (kind) => {
    let acknowledge!: (result: typeof saved) => void;
    write.mockImplementationOnce(async (_collection: string, _action: string, record: Row) => {
      disk.set(record.id, { ...record });
      return new Promise((resolve) => {
        acknowledge = resolve;
      });
    });
    start();
    await waitFor(() => expect(write).toHaveBeenCalledOnce());
    const action = kind.endsWith('delete') ? 'delete' : 'update';
    const changed = { ...rows[1]!, value: 2 };
    if (kind.startsWith('queued')) {
      if (action === 'delete') disk.delete('b');
      else disk.set('b', changed);
      store.applyOptimisticMutation(action, changed);
    } else transport.realtime({ action, record: changed });
    acknowledge(saved);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(disk.get('b')).toEqual(action === 'delete' ? undefined : changed);
    expect(store.getSnapshot().offlineReadiness).toBe('incomplete');
    await store.retryOfflineSave();
    expect(store.getSnapshot().offlineReadiness).toBe('ready');
    expect(membership).toMatchObject({
      recordIds: action === 'delete' ? ['a'] : ['a', 'b'],
      totalItems: action === 'delete' ? 1 : 2,
      complete: true,
    });
  },
);
function batchedOptions(): CollectionQueryOptions {
  return { sort: 'id', batchedFilter: { key: 'teams', field: 'team', values: ['alpha', 'beta'] } };
}
it('restores saved related records after offline filter shrink and expansion', async () => {
  start(batchedOptions());
  await waitFor(() => expect(store.getSnapshot().offlineReadiness).toBe('ready'));
  transport.online = false;
  transport.connection('offline');
  store.updateBatchedFilterValues(['alpha']);
  await waitFor(() => expect(store.getSnapshot().data.map((row) => row.id)).toEqual(['a']));
  store.updateBatchedFilterValues(['alpha', 'beta']);
  await waitFor(() => expect(store.getSnapshot().data.map((row) => row.id)).toEqual(['a', 'b']));
  expect(store.getSnapshot().offlineReadiness).toBe('ready');
  store.updateBatchedFilterValues(['alpha', 'beta', 'uncached-team']);
  expect(store.getSnapshot().offlineReadiness).toBe('incomplete');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(store.getSnapshot().offlineReadiness).toBe('incomplete');
});
it('preserves a newer unsaved related row when offline scope expansion reads an older disk copy', async () => {
  start(batchedOptions());
  await waitFor(() => expect(store.getSnapshot().offlineReadiness).toBe('ready'));
  write.mockResolvedValueOnce({ ok: false, persisted: false, error: 'Disk unavailable' });
  transport.realtime({ action: 'update', record: { ...rows[1]!, value: 2 } });
  await waitFor(() => expect(store.getSnapshot().offlineReadiness).toBe('incomplete'));
  transport.online = false;
  transport.connection('offline');
  store.updateBatchedFilterValues(['alpha']);
  await waitFor(() => expect(store.getSnapshot().data).toHaveLength(1));
  store.updateBatchedFilterValues(['alpha', 'beta']);
  await waitFor(() => expect(store.getSnapshot().data).toHaveLength(2));
  expect(store.getSnapshot().data.find((row) => row.id === 'b')?.value).toBe(2);
  expect(store.getSnapshot().offlineReadiness).toBe('incomplete');
});
it('loads a saved next page offline without downgrading a newer visible row', async () => {
  transport.page.mockResolvedValue({ items: [rows[0]], totalItems: 2 });
  start({ sort: 'id', pageSize: 1 });
  await waitFor(() => expect(store.getSnapshot().offlineReadiness).toBe('incomplete'));
  disk = new Map(rows.map((row) => [row.id, row]));
  membership = { recordIds: ['a', 'b'], totalItems: 2, complete: true };
  write.mockResolvedValueOnce({ ok: false, persisted: false, error: 'Disk unavailable' });
  transport.realtime({ action: 'update', record: { ...rows[0]!, value: 2 } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  transport.online = false;
  transport.connection('offline');
  await store.loadMore();
  expect(store.getSnapshot().data).toEqual([{ ...rows[0], value: 2 }, rows[1]]);
  expect(store.getSnapshot().offlineReadiness).toBe('incomplete');
});
it('does not restore a newer deletion or claim its stale disk projection ready after offline expansion', async () => {
  start(batchedOptions());
  await waitFor(() => expect(store.getSnapshot().offlineReadiness).toBe('ready'));
  write.mockResolvedValueOnce({ ok: false, persisted: false, error: 'Disk unavailable' });
  transport.realtime({ action: 'delete', record: rows[1]! });
  await waitFor(() => expect(store.getSnapshot().offlineReadiness).toBe('incomplete'));
  transport.online = false;
  transport.connection('offline');
  store.updateBatchedFilterValues(['alpha']);
  await new Promise((resolve) => setTimeout(resolve, 0));
  store.updateBatchedFilterValues(['alpha', 'beta']);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(store.getSnapshot().data).toEqual([rows[0]]);
  expect(store.getSnapshot().offlineReadiness).toBe('incomplete');
});
