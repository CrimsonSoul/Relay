import type { CachedQueryMembership, PendingMutationOverlay } from '@shared/ipc';
import {
  getPb,
  handleApiError,
  isOnline,
  onConnectionStateChange,
  onPocketBaseClientChange,
} from '../services/pocketbase';
import { registerWebCollectionGate, type WebCollectionGate } from './webOnlineGate';

/**
 * The only shape this layer relies on. PocketBase's own `RecordModel` also
 * demands `collectionId`/`collectionName`, which the server does send but none
 * of Relay's record interfaces (ContactRecord, ServerRecord, …) declare — so
 * constraining on it rejected every real caller.
 */
export interface CollectionRecord {
  id: string;
  updated?: string;
}

export interface CollectionQueryOptions {
  sort?: string;
  filter?: string;
  /** Load an initial bounded page and allow consumers to expand it incrementally. */
  pageSize?: number;
  /**
   * Fetch a changing equality set in request-line-safe batches while keeping a
   * stable store identity. Intended for related records keyed by loaded IDs.
   */
  batchedFilter?: {
    key: string;
    field: string;
    values: readonly string[];
    batchSize?: number;
  };
  /** Retained for API compatibility with the original collection hook. */
  offlineCacheChannel?: string;
}

export interface CollectionSnapshot<T extends CollectionRecord> {
  data: T[];
  loading: boolean;
  error: string | null;
  hasLoadedSnapshot: boolean;
  totalItems?: number;
  hasMore?: boolean;
  loadingMore?: boolean;
  cachedPartial?: boolean;
}

interface ExtendedApi {
  cacheRead?: (collection: string) => Promise<CollectionRecord[] | null>;
  cacheQueryRead?: (collection: string, queryKey: string) => Promise<CachedQueryMembership | null>;
  cacheQuerySnapshot?: (
    collection: string,
    queryKey: string,
    membership: CachedQueryMembership,
  ) => void;
  cacheWrite?: (collection: string, action: string, record: CollectionRecord) => void;
  cacheSnapshot?: (collection: string, signature: string, records: CollectionRecord[]) => void;
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

function isWebRuntime(): boolean {
  return globalThis.api?.runtime?.kind === 'web';
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

export function collectionRevisionSignature(records: readonly CollectionRecord[]): string {
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

export function collectionQueryCacheKey(
  collectionName: string,
  options: CollectionQueryOptions,
): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  const identity = `${collectionName}\u0000${options.sort ?? ''}\u0000${options.filter ?? ''}\u0000${
    options.pageSize ? Math.max(1, Math.floor(options.pageSize)) : ''
  }\u0000${options.batchedFilter?.key ?? ''}\u0000${options.batchedFilter?.field ?? ''}\u0000${
    options.batchedFilter?.batchSize ?? ''
  }`;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= BigInt(identity.codePointAt(index) ?? 0);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

function compareField(aValue: unknown, bValue: unknown, descending: boolean): number {
  if (aValue === bValue) return 0;
  if (aValue == null) return descending ? -1 : 1;
  if (bValue == null) return descending ? 1 : -1;
  const comparison = aValue < bValue ? -1 : 1;
  return descending ? -comparison : comparison;
}

/**
 * Parse the `field="value"` equality subset of PocketBase filter syntax
 * (optionally joined with `&&` and `||`) into a membership predicate. Returns
 * null for anything richer — quoted logical operators, grouping, comparison
 * operators — because the caller must not guess at membership it cannot prove.
 */
const FILTER_EQUALITY = /^\s*([\w.]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s&|]+))\s*$/;

function buildFilterPredicate(filter: string): ((record: CollectionRecord) => boolean) | null {
  const groups: { field: string; value: string }[][] = [];
  for (const disjunction of filter.split('||')) {
    const clauses: { field: string; value: string }[] = [];
    for (const clause of disjunction.split('&&')) {
      const match = FILTER_EQUALITY.exec(clause);
      if (!match) return null;
      const [, field, doubleQuoted, singleQuoted, bare] = match;
      clauses.push({ field: field ?? '', value: doubleQuoted ?? singleQuoted ?? bare ?? '' });
    }
    groups.push(clauses);
  }
  return (record) =>
    groups.some((clauses) =>
      clauses.every(({ field, value }) => {
        const fieldValue = Reflect.get(record, field);
        const normalizedValue =
          field === 'scopeExcluded' && fieldValue === undefined ? false : fieldValue;
        return String(normalizedValue ?? '') === value;
      }),
    );
}

/**
 * Realtime arrives unfiltered (`subscribe('*')`), so a filtered store has to
 * re-apply its own filter before accepting a created record — otherwise the
 * snapshot ends up holding rows the equivalent `getFullList` would never
 * return. An unparseable filter rejects every create: the authoritative
 * snapshot fetch reconciles on the next connection cycle, whereas an
 * unverified append corrupts the list until then.
 */
function buildCreateGate(filter: string | undefined): (record: CollectionRecord) => boolean {
  if (!filter) return () => true;
  return buildFilterPredicate(filter) ?? (() => false);
}

function buildComparator<T extends CollectionRecord>(
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

function applyRealtimeEvent<T extends CollectionRecord>(
  previous: T[],
  action: string,
  record: CollectionRecord,
  comparator: ((a: T, b: T) => number) | null,
  acceptsCreate: (record: CollectionRecord) => boolean,
  filtered: boolean,
): T[] {
  let next: T[];
  switch (action) {
    case 'create':
      if (previous.some((item) => item.id === record.id)) return previous;
      if (!acceptsCreate(record)) return previous;
      next = [...previous, record as T];
      break;
    case 'update': {
      // Returning the same array when the record is not held keeps the
      // snapshot identity stable — every allocation here re-renders every
      // subscriber of the collection, matched record or not.
      const index = previous.findIndex((item) => item.id === record.id);
      const accepted = acceptsCreate(record);
      if (index === -1) {
        if (!filtered || !accepted) return previous;
        next = [...previous, record as T];
        break;
      }
      if (!accepted) return previous.filter((_, itemIndex) => itemIndex !== index);
      next = [...previous];
      next[index] = record as T;
      break;
    }
    case 'delete':
      return previous.filter((item) => item.id !== record.id);
    default:
      return previous;
  }
  if (comparator) next.sort(comparator);
  return next;
}

function replayBufferedEvents<T extends CollectionRecord>(
  records: T[],
  events: { action: string; record: CollectionRecord }[] | null,
  comparator: ((a: T, b: T) => number) | null,
  acceptsCreate: (record: CollectionRecord) => boolean,
  filtered: boolean,
): T[] {
  let next = records;
  for (const event of events ?? []) {
    next = applyRealtimeEvent(
      next,
      event.action,
      event.record,
      comparator,
      acceptsCreate,
      filtered,
    );
  }
  return next;
}

async function readOfflineCache<T extends CollectionRecord>(
  collectionName: string,
): Promise<T[] | null> {
  try {
    const records = await getApi()?.cacheRead?.(collectionName);
    return records ? (records as T[]) : null;
  } catch {
    return null;
  }
}

async function readOfflineQueryMembership(
  collectionName: string,
  queryKey: string,
): Promise<CachedQueryMembership | null> {
  try {
    return (await getApi()?.cacheQueryRead?.(collectionName, queryKey)) ?? null;
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

function sortCachedRecords<T extends CollectionRecord>(
  cached: T[] | null,
  comparator: ((a: T, b: T) => number) | null,
): T[] | null {
  return cached && comparator ? cached.toSorted(comparator) : cached;
}

function adjustedRealtimeTotal(
  currentTotal: number | undefined,
  currentLength: number,
  action: string,
  wasHeld: boolean,
  accepted: boolean,
): number | undefined {
  const baseline = currentTotal ?? currentLength;
  if (action === 'create' && accepted && !wasHeld) return baseline + 1;
  const leftFilter = action === 'update' && wasHeld && !accepted;
  if ((action === 'delete' && wasHeld) || leftFilter) return Math.max(0, baseline - 1);
  return currentTotal;
}

function realtimeMayChangePageBoundary(
  action: string,
  wasHeld: boolean,
  accepted: boolean,
): boolean {
  if (action === 'create') return accepted;
  if (action === 'delete') return wasHeld || accepted;
  return action === 'update' && wasHeld !== accepted;
}

function escapeFilterValue(value: string): string {
  return value.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`);
}

function batchedEqualityFilters(
  baseFilter: string | undefined,
  field: string,
  values: readonly string[],
  batchSize: number,
): string[] {
  const filters: string[] = [];
  let clauses: string[] = [];
  const flush = () => {
    if (clauses.length === 0) return;
    const membership = clauses.join(' || ');
    filters.push(baseFilter ? `(${baseFilter}) && (${membership})` : membership);
    clauses = [];
  };
  for (const value of values) {
    const clause = `${field}="${escapeFilterValue(value)}"`;
    const nextLength = clauses.join(' || ').length + clause.length + 4;
    if (clauses.length >= batchSize || nextLength > 3_000) flush();
    clauses.push(clause);
  }
  flush();
  return filters;
}

export class CollectionStore<T extends CollectionRecord> {
  private snapshot: CollectionSnapshot<T> = {
    data: [],
    loading: true,
    error: null,
    hasLoadedSnapshot: false,
  };
  private readonly listeners = new Set<Listener>();
  private readonly comparator: ((a: T, b: T) => number) | null;
  private readonly acceptsBaseFilter: (record: CollectionRecord) => boolean;
  private readonly acceptsCreate: (record: CollectionRecord) => boolean;
  private readonly filtered: boolean;
  private readonly queryCacheKey: string | null;
  private readonly batchedFilterField: string | null;
  private dynamicFilterValues: Set<string>;
  private active = false;
  private connected = false;
  private connectionGeneration = 0;
  private fetchGeneration = 0;
  private subscriptionGeneration = 0;
  private realtimeUnsubscribe: (() => void | Promise<void>) | null = null;
  private connectionUnsubscribe: (() => void) | null = null;
  private clientUnsubscribe: (() => void) | null = null;
  private inFlightEvents: { action: string; record: CollectionRecord }[] | null = null;
  private lastSnapshotSignature: string | null = null;
  private webGate: WebCollectionGate | null = null;
  private loadedLimit: number;
  private pageBoundaryRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private loadMoreInFlight: Promise<void> | null = null;

  constructor(
    private readonly collectionName: string,
    private readonly options: CollectionQueryOptions,
    private readonly onSubscriberCountChange: SubscriberCountListener = () => undefined,
  ) {
    this.comparator = buildComparator<T>(options.sort);
    this.acceptsBaseFilter = buildCreateGate(options.filter);
    this.batchedFilterField = options.batchedFilter?.field ?? null;
    this.dynamicFilterValues = new Set(options.batchedFilter?.values ?? []);
    this.acceptsCreate = (record) => {
      if (!this.acceptsBaseFilter(record)) return false;
      if (!this.batchedFilterField) return true;
      return this.dynamicFilterValues.has(String(Reflect.get(record, this.batchedFilterField)));
    };
    this.filtered = Boolean(options.filter || options.batchedFilter);
    this.queryCacheKey =
      this.filtered || options.pageSize ? collectionQueryCacheKey(collectionName, options) : null;
    this.loadedLimit = Math.max(1, Math.floor(options.pageSize ?? 1));
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

  readonly loadMore = (): Promise<void> => {
    if (this.loadMoreInFlight) return this.loadMoreInFlight;
    this.loadMoreInFlight = this.performLoadMore().finally(() => {
      this.loadMoreInFlight = null;
    });
    return this.loadMoreInFlight;
  };

  updateBatchedFilterValues(values: readonly string[]): void {
    if (!this.batchedFilterField) return;
    const nextValues = new Set(values);
    if (
      nextValues.size === this.dynamicFilterValues.size &&
      [...nextValues].every((value) => this.dynamicFilterValues.has(value))
    ) {
      return;
    }
    this.dynamicFilterValues = nextValues;
    const data = this.snapshot.data.filter(this.acceptsCreate);
    if (data.length !== this.snapshot.data.length) this.updateSnapshot({ data });
    if (this.active) void this.fetchData();
  }

  private async performLoadMore(): Promise<void> {
    const pageSize = this.options.pageSize;
    if (!pageSize || this.snapshot.hasMore !== true) return;
    const boundedPageSize = Math.max(1, Math.floor(pageSize));
    const previousLimit = this.loadedLimit;
    this.updateSnapshot({ loadingMore: true, error: null });
    try {
      this.loadedLimit = previousLimit + boundedPageSize;
      const succeeded = await this.fetchData();
      if (!succeeded && this.active) {
        this.loadedLimit = previousLimit;
        const data = this.snapshot.data.slice(0, previousLimit);
        this.updateSnapshot({
          data,
          hasMore:
            this.snapshot.totalItems === undefined
              ? this.snapshot.hasMore
              : data.length < this.snapshot.totalItems,
        });
      }
    } finally {
      if (this.active) this.updateSnapshot({ loadingMore: false });
    }
  }

  applyOptimisticMutation(action: 'create' | 'update' | 'delete', record: CollectionRecord): void {
    const next = applyRealtimeEvent(
      this.snapshot.data,
      action,
      record,
      this.comparator,
      this.acceptsCreate,
      this.filtered,
    );
    if (next !== this.snapshot.data) {
      this.updateSnapshot({ data: next });
      this.writeQueryMembership(next);
    }
  }

  /** Stop background work while retaining the last immutable snapshot for fast revival. */
  dispose(): void {
    if (!this.active) return;
    this.active = false;
    this.connectionGeneration += 1;
    this.fetchGeneration += 1;
    this.stopRealtimeSubscription();
    this.connectionUnsubscribe?.();
    this.connectionUnsubscribe = null;
    this.clientUnsubscribe?.();
    this.clientUnsubscribe = null;
    this.inFlightEvents = null;
    if (this.pageBoundaryRefreshTimer) clearTimeout(this.pageBoundaryRefreshTimer);
    this.pageBoundaryRefreshTimer = null;
    this.loadMoreInFlight = null;
    this.webGate?.unregister();
    this.webGate = null;
  }

  private start(): void {
    this.active = true;
    this.connected = isOnline();
    if (isWebRuntime()) this.webGate = registerWebCollectionGate();
    this.connectionUnsubscribe = onConnectionStateChange((state) => {
      const online = state === 'online';
      const wasOffline = !this.connected;
      this.connected = online;

      if (online && wasOffline) {
        if (this.webGate) {
          this.restartConnectionCycle();
        } else {
          void syncPendingOnce().then((result) => {
            if (this.active && this.connected) {
              this.restartConnectionCycle(result?.remainingChanges ?? []);
            }
          });
        }
      } else if (!online && !wasOffline) {
        this.webGate?.markDisconnected();
        this.restartConnectionCycle();
      }
    });
    this.clientUnsubscribe = onPocketBaseClientChange(() => {
      if (!this.active) return;
      this.connected = isOnline();
      this.webGate?.markDisconnected();
      this.restartConnectionCycle();
    });
    this.restartConnectionCycle();
  }

  private restartConnectionCycle(pendingOverlays: PendingMutationOverlay[] = []): void {
    const connectionGeneration = ++this.connectionGeneration;
    this.fetchGeneration += 1;
    this.webGate?.markDisconnected();
    this.stopRealtimeSubscription();
    if (!this.connected) {
      if (this.webGate) {
        this.updateSnapshot({ loading: false });
      } else {
        void this.fetchData();
      }
      return;
    }
    this.inFlightEvents = [];
    void this.startRealtimeSubscription().then(() => {
      if (!this.active || !this.connected || connectionGeneration !== this.connectionGeneration) {
        return;
      }
      return this.fetchData(true, pendingOverlays, connectionGeneration);
    });
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

  private handleRealtimeEvent(action: string, record: CollectionRecord): void {
    const wasHeld = this.snapshot.data.some((item) => item.id === record.id);
    const accepted = this.acceptsCreate(record);
    let next = applyRealtimeEvent(
      this.snapshot.data,
      action,
      record,
      this.comparator,
      this.acceptsCreate,
      this.filtered,
    );
    if (this.options.pageSize && next.length > this.loadedLimit) {
      next = next.slice(0, this.loadedLimit);
    }
    if (next !== this.snapshot.data) {
      const adjustedTotal = adjustedRealtimeTotal(
        this.snapshot.totalItems,
        this.snapshot.data.length,
        action,
        wasHeld,
        accepted,
      );
      this.updateSnapshot({
        data: next,
        totalItems: adjustedTotal,
        hasMore: adjustedTotal === undefined ? this.snapshot.hasMore : next.length < adjustedTotal,
      });
      this.writeQueryMembership(next);
    }
    const mayChangePageBoundary = realtimeMayChangePageBoundary(action, wasHeld, accepted);
    if (this.options.pageSize && mayChangePageBoundary) {
      this.schedulePageBoundaryRefresh();
    }
    if (!this.webGate) getApi()?.cacheWrite?.(this.collectionName, action, record);
    if (this.inFlightEvents && this.inFlightEvents.length < 1000) {
      this.inFlightEvents.push({ action, record });
    }
  }

  private schedulePageBoundaryRefresh(): void {
    if (this.pageBoundaryRefreshTimer) return;
    this.pageBoundaryRefreshTimer = setTimeout(() => {
      this.pageBoundaryRefreshTimer = null;
      if (this.active) void this.fetchData();
    }, 100);
  }

  private async fetchData(
    preserveBufferedEvents = false,
    pendingOverlays: PendingMutationOverlay[] = [],
    connectionGeneration = this.connectionGeneration,
  ): Promise<boolean> {
    if (!this.active) return true;
    const generation = ++this.fetchGeneration;
    const isCurrent = () =>
      this.active &&
      generation === this.fetchGeneration &&
      connectionGeneration === this.connectionGeneration;

    let failed = false;
    try {
      if (!preserveBufferedEvents) this.inFlightEvents = [];
      if (isOnline()) {
        await this.fetchOnlineSnapshot(isCurrent, pendingOverlays);
      } else if (!this.webGate) {
        await this.fetchOfflineSnapshot(isCurrent);
      }
    } catch (error) {
      failed = isCurrent() && !isAutocancelledError(error);
      await this.recoverFromFetchError(error, isCurrent);
    } finally {
      if (isCurrent()) {
        this.inFlightEvents = null;
        this.updateSnapshot({ loading: false });
      }
    }
    return !failed;
  }

  private async fetchOnlineSnapshot(
    isCurrent: () => boolean,
    pendingOverlays: PendingMutationOverlay[],
  ): Promise<void> {
    const query = this.queryOptions();
    const collection = getPb().collection(this.collectionName);
    const pageSize = this.options.pageSize ? Math.max(1, Math.floor(this.options.pageSize)) : null;
    const pages = pageSize
      ? await Promise.all(
          Array.from({ length: Math.ceil(this.loadedLimit / pageSize) }, (_, index) =>
            collection.getList<T>(index + 1, pageSize, query),
          ),
        )
      : null;
    const records = pages
      ? [
          ...new Map(
            pages.flatMap((page) => page.items).map((record) => [record.id, record]),
          ).values(),
        ]
      : await this.fetchFullOnlineRecords();
    if (!isCurrent()) return;
    let next = replayBufferedEvents(
      records,
      this.inFlightEvents,
      this.comparator,
      this.acceptsCreate,
      this.filtered,
    );
    for (const overlay of pendingOverlays) {
      if (overlay.collection === this.collectionName) {
        next = applyRealtimeEvent(
          next,
          overlay.action,
          overlay.record,
          this.comparator,
          this.acceptsCreate,
          this.filtered,
        );
      }
    }
    if (pageSize && next.length > this.loadedLimit) next = next.slice(0, this.loadedLimit);
    const totalItems = pages?.[0]?.totalItems ?? next.length;
    this.updateSnapshot({
      data: next,
      error: null,
      hasLoadedSnapshot: true,
      totalItems,
      hasMore: next.length < totalItems,
      cachedPartial: false,
    });
    this.webGate?.markReady();
    this.writeCacheRecords(records);
    this.writeQueryMembership(next);
  }

  private async fetchOfflineSnapshot(isCurrent: () => boolean): Promise<void> {
    const cachedQuery = await this.readCachedQueryRecords();
    const allCached = sortCachedRecords(cachedQuery.records, this.comparator);
    const filtered = allCached?.filter(this.acceptsCreate) ?? null;
    const cached =
      filtered && this.options.pageSize ? filtered.slice(0, this.loadedLimit) : filtered;
    if (isCurrent() && cached) {
      const totalItems = cachedQuery.membership?.totalItems ?? filtered?.length ?? cached.length;
      this.updateSnapshot({
        data: cached,
        error: null,
        hasLoadedSnapshot: true,
        totalItems,
        hasMore: Boolean(filtered && cached.length < filtered.length),
        cachedPartial:
          cachedQuery.membership !== null &&
          (!cachedQuery.membership.complete ||
            cached.length < cachedQuery.membership.recordIds.length),
      });
    }
  }

  private async recoverFromFetchError(error: unknown, isCurrent: () => boolean): Promise<void> {
    if (isAutocancelledError(error) || !isCurrent()) return;
    handleApiError(error);
    if (this.webGate) {
      this.updateSnapshot({ error: errorMessage(error) });
      return;
    }
    const cachedQuery = await this.readCachedQueryRecords();
    const cached = sortCachedRecords(cachedQuery.records, this.comparator);
    if (!isCurrent()) return;
    const filtered = cached?.filter(this.acceptsCreate) ?? null;
    const visible =
      filtered && this.options.pageSize ? filtered.slice(0, this.loadedLimit) : filtered;
    const totalItems = cachedQuery.membership?.totalItems ?? filtered?.length ?? visible?.length;
    this.updateSnapshot({
      ...(visible
        ? {
            data: visible,
            hasLoadedSnapshot: true,
            totalItems,
            hasMore: Boolean(filtered && visible.length < filtered.length),
            cachedPartial:
              cachedQuery.membership !== null &&
              (!cachedQuery.membership.complete ||
                visible.length < cachedQuery.membership.recordIds.length),
          }
        : {}),
      error: errorMessage(error),
    });
  }

  private async fetchFullOnlineRecords(): Promise<T[]> {
    const batchedFilter = this.options.batchedFilter;
    if (!batchedFilter) {
      return getPb().collection(this.collectionName).getFullList<T>(this.queryOptions());
    }
    const values = [...this.dynamicFilterValues];
    if (values.length === 0) return [];
    const batchSize = Math.max(1, Math.min(50, Math.floor(batchedFilter.batchSize ?? 40)));
    const filters = batchedEqualityFilters(
      this.options.filter,
      batchedFilter.field,
      values,
      batchSize,
    );
    const records = new Map<string, T>();
    for (let offset = 0; offset < filters.length; offset += 4) {
      const group = filters.slice(offset, offset + 4);
      const results = await Promise.all(
        group.map((filter) =>
          getPb().collection(this.collectionName).getFullList<T>(this.queryOptions(filter)),
        ),
      );
      for (const record of results.flat()) records.set(record.id, record);
    }
    return [...records.values()];
  }

  private queryOptions(filter = this.options.filter || ''): {
    sort: string;
    filter: string;
    requestKey: null;
  } {
    return {
      sort: this.options.sort || '-created',
      filter,
      requestKey: null,
    };
  }

  private async readCachedQueryRecords(): Promise<{
    records: T[] | null;
    membership: CachedQueryMembership | null;
  }> {
    const cached = await readOfflineCache<T>(this.collectionName);
    if (!cached || !this.queryCacheKey) return { records: cached, membership: null };
    const membership = await readOfflineQueryMembership(this.collectionName, this.queryCacheKey);
    if (membership === null) return { records: cached, membership: null };
    const memberIds = new Set(membership.recordIds);
    return { records: cached.filter((record) => memberIds.has(record.id)), membership };
  }

  private writeCacheRecords(records: T[]): void {
    if (this.webGate) return;
    if (this.filtered || this.options.pageSize) {
      const cacheWrite = getApi()?.cacheWrite;
      for (const record of records) cacheWrite?.(this.collectionName, 'update', record);
      return;
    }
    const cacheSnapshot = getApi()?.cacheSnapshot;
    if (!cacheSnapshot) return;
    const signature = collectionRevisionSignature(records);
    if (signature === this.lastSnapshotSignature) return;
    this.lastSnapshotSignature = signature;
    cacheSnapshot(this.collectionName, signature, records);
  }

  private writeQueryMembership(records: T[]): void {
    if (this.webGate || !this.queryCacheKey) return;
    const recordIds = records.map((record) => record.id);
    const totalItems = Math.max(recordIds.length, this.snapshot.totalItems ?? recordIds.length);
    getApi()?.cacheQuerySnapshot?.(this.collectionName, this.queryCacheKey, {
      recordIds,
      totalItems,
      complete: recordIds.length >= totalItems,
    });
  }

  private updateSnapshot(patch: Partial<CollectionSnapshot<T>>): void {
    const next = { ...this.snapshot, ...patch };
    if (
      next.data === this.snapshot.data &&
      next.loading === this.snapshot.loading &&
      next.error === this.snapshot.error &&
      next.hasLoadedSnapshot === this.snapshot.hasLoadedSnapshot &&
      next.totalItems === this.snapshot.totalItems &&
      next.hasMore === this.snapshot.hasMore &&
      next.loadingMore === this.snapshot.loadingMore &&
      next.cachedPartial === this.snapshot.cachedPartial
    ) {
      return;
    }
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }
}
