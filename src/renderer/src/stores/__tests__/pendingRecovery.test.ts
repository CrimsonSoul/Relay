import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import {
  applyOfflineMutationToStores,
  getCollectionStore,
  refreshStoresAfterPendingSync,
  resetCollectionStoreRegistry,
} from '../collectionStoreRegistry';
const pb = vi.hoisted(() => ({ getFullList: vi.fn(), subscribe: vi.fn(async () => () => {}) }));
vi.mock('../../services/pocketbase', () => ({
  getPb: () => ({ collection: () => pb }),
  isOnline: () => true,
  handleApiError: vi.fn(),
  onConnectionStateChange: () => () => {},
  onPocketBaseClientChange: () => () => {},
}));
beforeEach(() => {
  pb.getFullList.mockReset().mockResolvedValue([]);
  vi.stubGlobal('api', {
    onOfflineMutationApplied: () => () => {},
    cacheRead: async () => [],
    cacheSnapshot: vi.fn(),
  });
});
afterEach(() => resetCollectionStoreRegistry());
const event = (record: { id: string; name: string; updated: string }, reconciled = true) => ({
  mutationId: crypto.randomUUID(),
  collection: 'contacts' as const,
  action: 'update' as const,
  record,
  pendingCount: 0,
  reconciled,
});
it('reconciles same-id same-updated local content without retaining queue markers', async () => {
  const store = getCollectionStore('contacts');
  store.subscribe(() => {});
  await waitFor(() => expect(store.getSnapshot().hasLoadedSnapshot).toBe(true));
  store.applyOptimisticMutation('create', {
    id: 'one',
    name: 'Local',
    updated: 'same',
    queuedAt: 'local',
  } as never);
  applyOfflineMutationToStores(event({ id: 'one', name: 'Server', updated: 'same' }));
  expect(store.getSnapshot().data).toEqual([{ id: 'one', name: 'Server', updated: 'same' }]);
  expect(store.getSnapshot().isAuthoritative).toBe(false);
});
it('restores a locally deleted row when accepting the server version', async () => {
  const store = getCollectionStore('contacts');
  store.subscribe(() => {});
  await waitFor(() => expect(store.getSnapshot().hasLoadedSnapshot).toBe(true));
  applyOfflineMutationToStores(event({ id: 'one', name: 'Server', updated: 'same' }));
  expect(store.getSnapshot().data).toHaveLength(1);
});
it('retains remaining overlays after manual retry and does not mark them authoritative', async () => {
  const store = getCollectionStore('contacts');
  store.subscribe(() => {});
  await waitFor(() => expect(store.getSnapshot().hasLoadedSnapshot).toBe(true));
  pb.getFullList.mockResolvedValue([{ id: 'one', name: 'Server' }]);
  await refreshStoresAfterPendingSync([
    { collection: 'contacts', action: 'update', record: { id: 'one', name: 'Local' } },
  ]);
  expect(store.getSnapshot().data).toEqual([{ id: 'one', name: 'Local' }]);
  expect(store.getSnapshot().isAuthoritative).toBe(false);
});
it('does not let an older refresh overwrite reconciliation or a newer queued edit', async () => {
  const store = getCollectionStore('contacts');
  store.subscribe(() => {});
  await waitFor(() => expect(store.getSnapshot().hasLoadedSnapshot).toBe(true));
  let finish!: (records: unknown[]) => void;
  pb.getFullList.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const refreshing = refreshStoresAfterPendingSync([]);
  store.applyOptimisticMutation('create', {
    id: 'one',
    name: 'New local',
    updated: 'same',
  } as never);
  finish([{ id: 'one', name: 'Old server', updated: 'same' }]);
  await refreshing;
  expect(store.getSnapshot().data).toEqual([{ id: 'one', name: 'New local', updated: 'same' }]);
  expect(store.getSnapshot().isAuthoritative).toBe(false);
});
