import type { OfflineMutationApplied } from '@shared/ipc';
import {
  CollectionStore,
  type CollectionQueryOptions,
  type CollectionRecord,
} from './collectionStore';

const DISPOSAL_GRACE_MS = 5_000;

interface RegistryEntry {
  collectionName: string;
  store: CollectionStore<CollectionRecord>;
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
    if (entry.collectionName === event.collection) {
      entry.store.applyOptimisticMutation(event.action, event.record as CollectionRecord);
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
  ]);
}

export function getCollectionStore<T extends CollectionRecord>(
  collectionName: string,
  options: CollectionQueryOptions = {},
): CollectionStore<T> {
  ensureOfflineMutationListener();
  const key = normalizeCollectionQuery(collectionName, options);
  const existing = stores.get(key);
  if (existing) return asTypedStore<T>(existing.store);

  const entry: RegistryEntry = {
    collectionName,
    store: undefined as unknown as CollectionStore<CollectionRecord>,
    disposalTimer: null,
  };
  const store = new CollectionStore<CollectionRecord>(
    collectionName,
    options,
    (subscriberCount) => {
      if (subscriberCount > 0) {
        if (entry.disposalTimer) clearTimeout(entry.disposalTimer);
        entry.disposalTimer = null;
        return;
      }
      entry.disposalTimer = setTimeout(() => {
        entry.disposalTimer = null;
        if (entry.store.subscriberCount === 0) entry.store.dispose();
      }, DISPOSAL_GRACE_MS);
    },
  );
  entry.store = store;
  stores.set(key, entry);
  return asTypedStore<T>(store);
}

export function resetCollectionStoreRegistry(): void {
  for (const entry of stores.values()) {
    if (entry.disposalTimer) clearTimeout(entry.disposalTimer);
    entry.store.dispose();
  }
  stores.clear();
  appliedMutationIds.clear();
  offlineMutationUnsubscribe?.();
  offlineMutationUnsubscribe = null;
}

export function collectionStoreRegistrySize(): number {
  return stores.size;
}
