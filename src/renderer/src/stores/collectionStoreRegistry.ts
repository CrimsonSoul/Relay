import type { RecordModel } from 'pocketbase';
import type { OfflineMutationApplied } from '@shared/ipc';
import { CollectionStore, type CollectionQueryOptions } from './collectionStore';

const DISPOSAL_GRACE_MS = 5_000;

interface RegistryEntry {
  collectionName: string;
  store: CollectionStore<RecordModel>;
  disposalTimer: ReturnType<typeof setTimeout> | null;
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
      entry.store.applyOptimisticMutation(event.action, event.record as RecordModel);
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

export function getCollectionStore<T extends RecordModel>(
  collectionName: string,
  options: CollectionQueryOptions = {},
): CollectionStore<T> {
  ensureOfflineMutationListener();
  const key = normalizeCollectionQuery(collectionName, options);
  const existing = stores.get(key);
  if (existing) return existing.store as CollectionStore<T>;

  const entry: RegistryEntry = {
    collectionName,
    store: undefined as unknown as CollectionStore<RecordModel>,
    disposalTimer: null,
  };
  const store = new CollectionStore<RecordModel>(collectionName, options, (subscriberCount) => {
    if (subscriberCount > 0) {
      if (entry.disposalTimer) clearTimeout(entry.disposalTimer);
      entry.disposalTimer = null;
      return;
    }
    entry.disposalTimer = setTimeout(() => {
      entry.disposalTimer = null;
      if (entry.store.subscriberCount === 0) entry.store.dispose();
    }, DISPOSAL_GRACE_MS);
  });
  entry.store = store;
  stores.set(key, entry);
  return store as CollectionStore<T>;
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
