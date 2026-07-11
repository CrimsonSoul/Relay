import type { RecordModel } from 'pocketbase';
import type { PendingMutationOverlay } from '@shared/ipc';
import {
  getPb,
  handleApiError,
  isOnline,
  onConnectionStateChange,
  onPocketBaseClientChange,
} from '../services/pocketbase';

export interface CollectionQueryOptions {
  sort?: string;
  filter?: string;
  /** Retained for API compatibility with the original collection hook. */
  offlineCacheChannel?: string;
}

export interface CollectionSnapshot<T extends RecordModel> {
  data: T[];
  loading: boolean;
  error: string | null;
}

interface ExtendedApi {
  cacheRead?: (collection: string) => Promise<RecordModel[] | null>;
  cacheWrite?: (collection: string, action: string, record: RecordModel) => void;
  cacheSnapshot?: (collection: string, signature: string, records: RecordModel[]) => void;
  syncPending?: () => Promise<{
    remaining?: number;
    remainingChanges?: PendingMutationOverlay[];
  }>;
}

type Listener = () => void;
type SubscriberCountListener = (count: number) => void;

function getApi(): ExtendedApi | undefined {
  return globalThis.api as (ExtendedApi & typeof globalThis.api) | undefined;
}

let pendingReconnectSync: Promise<
  { remaining?: number; remainingChanges?: PendingMutationOverlay[] } | undefined
> | null = null;

function syncPendingOnce(): Promise<
  { remaining?: number; remainingChanges?: PendingMutationOverlay[] } | undefined
> {
  pendingReconnectSync ??= Promise.resolve(getApi()?.syncPending?.()).finally(() => {
    pendingReconnectSync = null;
  });
  return pendingReconnectSync;
}

export function collectionRevisionSignature(
  records: Array<Pick<RecordModel, 'id' | 'updated'>>,
): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const record of records) {
    const revision = `${record.id}\u0000${record.updated ?? ''}\u0000`;
    for (let index = 0; index < revision.length; index += 1) {
      hash ^= BigInt(revision.charCodeAt(index));
      hash = (hash * prime) & mask;
    }
  }
  return `${records.length}:${hash.toString(16).padStart(16, '0')}`;
}

function compareField(aValue: unknown, bValue: unknown, descending: boolean): number {
  if (aValue === bValue) return 0;
  if (aValue == null) return descending ? -1 : 1;
  if (bValue == null) return descending ? 1 : -1;
  const comparison = aValue < bValue ? -1 : 1;
  return descending ? -comparison : comparison;
}

function buildComparator<T extends RecordModel>(
  sort: string | undefined,
): ((a: T, b: T) => number) | null {
  if (!sort) return null;
  const fields = sort.split(',').map((field) => {
    const trimmed = field.trim();
    const descending = trimmed.startsWith('-');
    return { key: descending ? trimmed.slice(1) : trimmed, descending };
  });
  return (a: T, b: T) => {
    for (const { key, descending } of fields) {
      const result = compareField(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        descending,
      );
      if (result !== 0) return result;
    }
    return 0;
  };
}

function applyRealtimeEvent<T extends RecordModel>(
  previous: T[],
  action: string,
  record: RecordModel,
  comparator: ((a: T, b: T) => number) | null,
): T[] {
  let next: T[];
  switch (action) {
    case 'create':
      if (previous.some((item) => item.id === record.id)) return previous;
      next = [...previous, record as T];
      break;
    case 'update':
      next = previous.map((item) => (item.id === record.id ? (record as T) : item));
      break;
    case 'delete':
      return previous.filter((item) => item.id !== record.id);
    default:
      return previous;
  }
  if (comparator) next.sort(comparator);
  return next;
}

function replayBufferedEvents<T extends RecordModel>(
  records: T[],
  events: { action: string; record: RecordModel }[] | null,
  comparator: ((a: T, b: T) => number) | null,
): T[] {
  let next = records;
  for (const event of events ?? []) {
    next = applyRealtimeEvent(next, event.action, event.record, comparator);
  }
  return next;
}

async function readOfflineCache<T extends RecordModel>(
  collectionName: string,
): Promise<T[] | null> {
  try {
    const records = await getApi()?.cacheRead?.(collectionName);
    return records ? (records as T[]) : null;
  } catch {
    return null;
  }
}

function isAutocancelledError(error: unknown): boolean {
  return (error instanceof Error ? error.message : String(error)).includes('autocancelled');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sortCachedRecords<T extends RecordModel>(
  cached: T[] | null,
  comparator: ((a: T, b: T) => number) | null,
): T[] | null {
  return cached && comparator ? cached.toSorted(comparator) : cached;
}

export class CollectionStore<T extends RecordModel> {
  private snapshot: CollectionSnapshot<T> = { data: [], loading: true, error: null };
  private readonly listeners = new Set<Listener>();
  private readonly comparator: ((a: T, b: T) => number) | null;
  private active = false;
  private connected = false;
  private fetchGeneration = 0;
  private subscriptionGeneration = 0;
  private realtimeUnsubscribe: (() => void | Promise<void>) | null = null;
  private connectionUnsubscribe: (() => void) | null = null;
  private clientUnsubscribe: (() => void) | null = null;
  private inFlightEvents: { action: string; record: RecordModel }[] | null = null;
  private lastSnapshotSignature: string | null = null;

  constructor(
    private readonly collectionName: string,
    private readonly options: CollectionQueryOptions,
    private readonly onSubscriberCountChange: SubscriberCountListener = () => undefined,
  ) {
    this.comparator = buildComparator<T>(options.sort);
  }

  readonly getSnapshot = (): CollectionSnapshot<T> => this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    this.onSubscriberCountChange(this.listeners.size);
    if (!this.active) this.start();

    return () => {
      this.listeners.delete(listener);
      this.onSubscriberCountChange(this.listeners.size);
    };
  };

  get subscriberCount(): number {
    return this.listeners.size;
  }

  readonly refetch = async (): Promise<void> => {
    await this.fetchData();
  };

  applyOptimisticMutation(action: 'create' | 'update' | 'delete', record: RecordModel): void {
    const next = applyRealtimeEvent(this.snapshot.data, action, record, this.comparator);
    if (next !== this.snapshot.data) this.updateSnapshot({ data: next });
  }

  /** Stop background work while retaining the last immutable snapshot for fast revival. */
  dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.fetchGeneration += 1;
    this.stopRealtimeSubscription();
    this.connectionUnsubscribe?.();
    this.connectionUnsubscribe = null;
    this.clientUnsubscribe?.();
    this.clientUnsubscribe = null;
    this.inFlightEvents = null;
  }

  private start(): void {
    this.active = true;
    this.connected = isOnline();
    this.connectionUnsubscribe = onConnectionStateChange((state) => {
      const online = state === 'online';
      const wasOffline = !this.connected;
      this.connected = online;

      if (online && wasOffline) {
        void syncPendingOnce().then((result) => {
          if (this.active && this.connected) {
            this.restartConnectionCycle(result?.remainingChanges ?? []);
          }
        });
      } else if (!online && !wasOffline) {
        this.restartConnectionCycle();
      }
    });
    this.clientUnsubscribe = onPocketBaseClientChange(() => {
      if (!this.active) return;
      this.connected = isOnline();
      this.restartConnectionCycle();
    });
    this.restartConnectionCycle();
  }

  private restartConnectionCycle(pendingOverlays: PendingMutationOverlay[] = []): void {
    this.stopRealtimeSubscription();
    if (!this.connected) {
      void this.fetchData();
      return;
    }
    this.inFlightEvents = [];
    void this.startRealtimeSubscription().then(() => this.fetchData(true, pendingOverlays));
  }

  private stopRealtimeSubscription(): void {
    this.subscriptionGeneration += 1;
    void this.realtimeUnsubscribe?.();
    this.realtimeUnsubscribe = null;
  }

  private async startRealtimeSubscription(): Promise<void> {
    const generation = ++this.subscriptionGeneration;
    await getPb()
      .collection(this.collectionName)
      .subscribe('*', (event) => this.handleRealtimeEvent(event.action, event.record))
      .then((unsubscribe) => {
        if (!this.active || !this.connected || generation !== this.subscriptionGeneration) {
          void unsubscribe();
          return;
        }
        this.realtimeUnsubscribe = unsubscribe;
      })
      .catch((error: unknown) => handleApiError(error));
  }

  private handleRealtimeEvent(action: string, record: RecordModel): void {
    const next = applyRealtimeEvent(this.snapshot.data, action, record, this.comparator);
    if (next !== this.snapshot.data) {
      this.updateSnapshot({ data: next });
    }
    getApi()?.cacheWrite?.(this.collectionName, action, record);
    if (this.inFlightEvents && this.inFlightEvents.length < 1000) {
      this.inFlightEvents.push({ action, record });
    }
  }

  private async fetchData(
    preserveBufferedEvents = false,
    pendingOverlays: PendingMutationOverlay[] = [],
  ): Promise<void> {
    if (!this.active) return;
    const generation = ++this.fetchGeneration;
    const isCurrent = () => this.active && generation === this.fetchGeneration;

    try {
      if (!preserveBufferedEvents) this.inFlightEvents = [];
      if (isOnline()) {
        await this.fetchOnlineSnapshot(isCurrent, pendingOverlays);
      } else {
        await this.fetchOfflineSnapshot(isCurrent);
      }
    } catch (error) {
      await this.recoverFromFetchError(error, isCurrent);
    } finally {
      if (isCurrent()) {
        this.inFlightEvents = null;
        this.updateSnapshot({ loading: false });
      }
    }
  }

  private async fetchOnlineSnapshot(
    isCurrent: () => boolean,
    pendingOverlays: PendingMutationOverlay[],
  ): Promise<void> {
    const records = await getPb()
      .collection(this.collectionName)
      .getFullList<T>({
        sort: this.options.sort || '-created',
        filter: this.options.filter || '',
        requestKey: null,
      });
    if (!isCurrent()) return;
    let next = replayBufferedEvents(records, this.inFlightEvents, this.comparator);
    for (const overlay of pendingOverlays) {
      if (overlay.collection === this.collectionName) {
        next = applyRealtimeEvent(next, overlay.action, overlay.record, this.comparator);
      }
    }
    this.updateSnapshot({ data: next, error: null });
    this.writeCacheSnapshot(next);
  }

  private async fetchOfflineSnapshot(isCurrent: () => boolean): Promise<void> {
    const cached = sortCachedRecords(
      await readOfflineCache<T>(this.collectionName),
      this.comparator,
    );
    if (isCurrent() && cached) this.updateSnapshot({ data: cached });
  }

  private async recoverFromFetchError(error: unknown, isCurrent: () => boolean): Promise<void> {
    if (isAutocancelledError(error) || !isCurrent()) return;
    handleApiError(error);
    const cached = sortCachedRecords(
      await readOfflineCache<T>(this.collectionName),
      this.comparator,
    );
    if (!isCurrent()) return;
    this.updateSnapshot({
      ...(cached ? { data: cached } : {}),
      error: errorMessage(error),
    });
  }

  private writeCacheSnapshot(records: T[]): void {
    const cacheSnapshot = getApi()?.cacheSnapshot;
    if (!cacheSnapshot) return;
    const signature = collectionRevisionSignature(records);
    if (signature === this.lastSnapshotSignature) return;
    this.lastSnapshotSignature = signature;
    cacheSnapshot(this.collectionName, signature, records);
  }

  private updateSnapshot(patch: Partial<CollectionSnapshot<T>>): void {
    const next = { ...this.snapshot, ...patch };
    if (
      next.data === this.snapshot.data &&
      next.loading === this.snapshot.loading &&
      next.error === this.snapshot.error
    ) {
      return;
    }
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
}
