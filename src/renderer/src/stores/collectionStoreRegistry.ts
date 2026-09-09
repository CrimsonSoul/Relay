import type { OfflineMutationApplied, PendingMutationOverlay } from '@shared/ipc';
import {
  CollectionStore,
  type CollectionQueryOptions,
  type CollectionRecord,
} from './collectionStore';

const DISPOSAL_GRACE_MS = 5_000;

interface RegistryEntry {
  collectionName: string;
  strongStore: CollectionStore<CollectionRecord> | null;
  storeRef: WeakRef<CollectionStore<CollectionRecord>>;
  disposalTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * The registry deliberately erases the record type: one store per
 * (collection, query) serves every caller, and each caller already knows the
 * shape it asked for. `CollectionStore` is invariant in its record type — its
 * comparator is `(a: T, b: T) => number` — so the erasure cannot be expressed
 * without this single, contained hop.
 */
function asTypedStore<T extends CollectionRecord>(
  store: CollectionStore<CollectionRecord>,
): CollectionStore<T> {
  return store as unknown as CollectionStore<T>;
}

const stores = new Map<string, RegistryEntry>();
const readinessListeners = new Set<() => void>();
const directories = new Set(['contacts', 'servers', 'oncall', 'bridge_groups']);
interface OfflineReadiness {
  state: 'saving' | 'ready' | 'incomplete';
  reason?: string;
}
let offlineReadiness: OfflineReadiness | null = null;
export const getOfflineReadiness = () => offlineReadiness;
export function subscribeOfflineReadiness(listener: () => void): () => void {
  readinessListeners.add(listener);
  return () => {
    readinessListeners.delete(listener);
  };
}
function activeDirectories(): CollectionStore<CollectionRecord>[] {
  return [...stores.values()].flatMap((entry) => {
    const store = entry.strongStore ?? entry.storeRef.deref();
    return directories.has(entry.collectionName) &&
      store?.subscriberCount &&
      store.isOfflineDirectory
      ? [store]
      : [];
  });
}
function publishOfflineReadiness(): void {
  const snapshots = activeDirectories()
    .map((store) => store.getSnapshot())
    .filter((snapshot) => snapshot.offlineSupported !== false);
  if (!snapshots.some((snapshot) => snapshot.offlineSupported === true)) snapshots.length = 0;
  const failed = snapshots.find((snapshot) => snapshot.offlineReadiness === 'incomplete');
  let next: OfflineReadiness | null = null;
  if (failed) next = { state: 'incomplete', reason: failed.offlineError };
  else if (snapshots.length > 0)
    next = {
      state: snapshots.every((snapshot) => snapshot.offlineReadiness === 'ready')
        ? 'ready'
        : 'saving',
    };
  if (next?.state === offlineReadiness?.state && next?.reason === offlineReadiness?.reason) return;
  offlineReadiness = next;
  readinessListeners.forEach((listener) => listener());
}
export async function retryOfflineCopies(): Promise<void> {
  await Promise.all(
    activeDirectories()
      .filter((store) => store.getSnapshot().offlineReadiness === 'incomplete')
      .map((store) => store.retryOfflineSave()),
  );
}

const collectedStores = new FinalizationRegistry<{ key: string; entry: RegistryEntry }>(
  ({ key, entry }) => {
    if (stores.get(key) === entry && !entry.storeRef.deref()) stores.delete(key);
  },
);
const appliedMutationIds = new Set<string>();
let offlineMutationUnsubscribe: (() => void) | null = null;

function applyMutation(event: OfflineMutationApplied): void {
  if (appliedMutationIds.has(event.mutationId)) return;
  appliedMutationIds.add(event.mutationId);
  if (appliedMutationIds.size > 1_000) {
    const oldest = appliedMutationIds.values().next().value;
    if (oldest) appliedMutationIds.delete(oldest);
  }
  for (const entry of stores.values()) {
    const store = entry.strongStore ?? entry.storeRef.deref();
    if (entry.collectionName === event.collection && store) {
      store.applyOptimisticMutation(
        event.action,
        event.record as CollectionRecord,
        event.reconciled,
      );
    }
  }
}

function ensureOfflineMutationListener(): void {
  if (offlineMutationUnsubscribe || !globalThis.api?.onOfflineMutationApplied) return;
  offlineMutationUnsubscribe = globalThis.api.onOfflineMutationApplied(applyMutation);
}

export function applyOfflineMutationToStores(event: OfflineMutationApplied): void {
  applyMutation(event);
}

function normalizePart(value: string | undefined): string {
  return value?.trim() ?? '';
}

export function normalizeCollectionQuery(
  collectionName: string,
  options: CollectionQueryOptions = {},
): string {
  return JSON.stringify([
    collectionName.trim(),
    normalizePart(options.sort) || '-created',
    normalizePart(options.filter),
    options.pageSize ?? null,
    options.batchedFilter?.key ?? null,
    options.batchedFilter?.field ?? null,
    options.batchedFilter?.batchSize ?? null,
  ]);
}

export function getCollectionStore<T extends CollectionRecord>(
  collectionName: string,
  options: CollectionQueryOptions = {},
): CollectionStore<T> {
  ensureOfflineMutationListener();
  const key = normalizeCollectionQuery(collectionName, options);
  const existing = stores.get(key);
  const existingStore = existing?.strongStore ?? existing?.storeRef.deref();
  if (existingStore) return asTypedStore<T>(existingStore);
  if (existing) stores.delete(key);

  const entry: RegistryEntry = {
    collectionName,
    strongStore: null,
    storeRef: undefined as unknown as WeakRef<CollectionStore<CollectionRecord>>,
    disposalTimer: null,
  };
  const store = new CollectionStore<CollectionRecord>(
    collectionName,
    options,
    (subscriberCount) => {
      publishOfflineReadiness();
      const retainedStore = entry.strongStore ?? entry.storeRef.deref();
      if (subscriberCount > 0) {
        if (entry.disposalTimer) clearTimeout(entry.disposalTimer);
        entry.disposalTimer = null;
        if (retainedStore) entry.strongStore = retainedStore;
        stores.set(key, entry);
        return;
      }
      entry.disposalTimer = setTimeout(() => {
        entry.disposalTimer = null;
        const inactiveStore = entry.strongStore ?? entry.storeRef.deref();
        if (inactiveStore?.subscriberCount === 0) {
          inactiveStore.dispose();
          entry.strongStore = null;
        }
      }, DISPOSAL_GRACE_MS);
    },
    publishOfflineReadiness,
  );
  entry.strongStore = store;
  entry.storeRef = new WeakRef(store);
  collectedStores.register(store, { key, entry }, entry);
  stores.set(key, entry);
  return asTypedStore<T>(store);
}

export function resetCollectionStoreRegistry(): void {
  for (const entry of stores.values()) {
    if (entry.disposalTimer) clearTimeout(entry.disposalTimer);
    (entry.strongStore ?? entry.storeRef.deref())?.dispose();
    collectedStores.unregister(entry);
  }
  stores.clear();
  publishOfflineReadiness();
  appliedMutationIds.clear();
  offlineMutationUnsubscribe?.();
  offlineMutationUnsubscribe = null;
}

export function collectionStoreRegistrySize(): number {
  for (const [key, entry] of stores) {
    if (!entry.strongStore && !entry.storeRef.deref()) stores.delete(key);
  }
  return stores.size;
}

export async function refreshStoresAfterPendingSync(
  overlays: PendingMutationOverlay[],
): Promise<void> {
  await Promise.all(
    [...stores.values()].flatMap((entry) => {
      const store = entry.strongStore ?? entry.storeRef.deref();
      return store ? [store.refreshAfterPendingSync(overlays)] : [];
    }),
  );
}
