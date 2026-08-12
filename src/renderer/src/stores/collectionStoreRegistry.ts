import type { OfflineMutationApplied } from '@shared/ipc';
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
      store.applyOptimisticMutation(event.action, event.record as CollectionRecord);
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
