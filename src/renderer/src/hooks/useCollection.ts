import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { type RecordModel } from 'pocketbase';
import { getPb, isOnline, onConnectionStateChange, handleApiError } from '../services/pocketbase';

interface UseCollectionOptions {
  sort?: string;
  filter?: string;
  /** IPC channel name for offline cache fallback */
  offlineCacheChannel?: string;
}

interface UseCollectionResult<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// window.api is typed to BridgeAPI which does not yet include cache methods.
// These will be added when the preload is updated (Task 8). We access them via
// an extended interface and optional chaining so the code is safe today and
// ready to work automatically once the preload exposes them.
interface ExtendedApi {
  cacheRead?: (collection: string) => Promise<RecordModel[] | null>;
  cacheWrite?: (collection: string, action: string, record: RecordModel) => void;
  cacheSnapshot?: (collection: string, records: RecordModel[]) => void;
}

function getApi(): ExtendedApi | undefined {
  return window.api as (ExtendedApi & typeof window.api) | undefined;
}

/** Compare two values for a single sort field, returning -1 / 0 / 1. */
function compareField(aVal: unknown, bVal: unknown, desc: boolean): number {
  if (aVal === bVal) return 0;
  if (aVal == null) return desc ? -1 : 1;
  if (bVal == null) return desc ? 1 : -1;
  const cmp = aVal < bVal ? -1 : 1;
  return desc ? -cmp : cmp;
}

/**
 * Build a comparator from a PocketBase sort string (e.g. "sortOrder", "-created").
 * Returns null if no sort is specified.
 */
function buildComparator<T extends RecordModel>(
  sort: string | undefined,
): ((a: T, b: T) => number) | null {
  if (!sort) return null;
  const fields = sort.split(',').map((s) => {
    const trimmed = s.trim();
    const desc = trimmed.startsWith('-');
    return { key: desc ? trimmed.slice(1) : trimmed, desc };
  });
  return (a: T, b: T) => {
    for (const { key, desc } of fields) {
      const result = compareField(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        desc,
      );
      if (result !== 0) return result;
    }
    return 0;
  };
}

/** Pure reducer that applies a realtime event to the current data array. */
function applyRealtimeEvent<T extends RecordModel>(
  prev: T[],
  action: string,
  record: RecordModel,
  comparator: ((a: T, b: T) => number) | null,
): T[] {
  let next: T[];
  switch (action) {
    case 'create':
      // Deduplicate: if record already exists (e.g. from a rapid fetch+realtime race), skip
      if (prev.some((r) => r.id === record.id)) return prev;
      next = [...prev, record as T];
      break;
    case 'update':
      next = prev.map((r) => (r.id === record.id ? (record as T) : r));
      break;
    case 'delete':
      return prev.filter((r) => r.id !== record.id);
    default:
      return prev;
  }
  // Re-sort after create/update so realtime events preserve the collection's sort order
  if (comparator) next.sort(comparator);
  return next;
}

/** Try to load data from the offline cache. Returns records or null. */
async function tryOfflineCache<T>(collectionName: string): Promise<T[] | null> {
  try {
    const cached = await getApi()?.cacheRead?.(collectionName);
    return cached ? (cached as T[]) : null;
  } catch {
    return null;
  }
}

export function useCollection<T extends RecordModel>(
  collectionName: string,
  options: UseCollectionOptions = {},
): UseCollectionResult<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const subscriptionRef = useRef<(() => void) | null>(null);
  // Ref to latest data so the realtime handler can read it without a closure
  // over stale state (avoids functional updater nesting flagged by sonarjs).
  const dataRef = useRef<T[]>([]);
  const comparator = useMemo(() => buildComparator<T>(options.sort), [options.sort]);

  const fetchData = useCallback(async () => {
    try {
      if (isOnline()) {
        const records = await getPb()
          .collection(collectionName)
          .getFullList<T>({
            sort: options.sort || '-created',
            filter: options.filter || '',
            // Disable auto-cancellation so parallel fetches for different
            // collections don't abort each other (PB SDK groups by collection).
            requestKey: null,
          });
        dataRef.current = records;
        setData(records);
        setError(null);
        // Populate offline cache with the full collection so going offline
        // before any realtime events still has cached data available.
        getApi()?.cacheSnapshot?.(collectionName, records);
      } else {
        const cached = await tryOfflineCache<T>(collectionName);
        if (cached) {
          dataRef.current = cached;
          setData(cached);
        }
      }
    } catch (err) {
      handleApiError(err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('autocancelled')) return; // PB SDK auto-cancellation, not a real error
      setError(msg);
      const cached = await tryOfflineCache<T>(collectionName);
      if (cached) {
        dataRef.current = cached;
        setData(cached);
      }
    } finally {
      setLoading(false);
    }
  }, [collectionName, options.sort, options.filter]);

  // Track connection state with a ref (avoids cascading effect re-runs)
  // and a counter to trigger re-subscription on reconnect.
  const connectedRef = useRef(isOnline());
  const [connectGeneration, setConnectGeneration] = useState(0);

  useEffect(() => {
    const unsubscribe = onConnectionStateChange((s) => {
      const online = s === 'online';
      const wasOffline = !connectedRef.current;
      connectedRef.current = online;

      if (online && wasOffline) {
        // Flush pending offline writes then bump generation to trigger re-subscribe
        void window.api?.syncPending?.();
        setConnectGeneration((g) => g + 1);
      } else if (!online && !wasOffline) {
        // Going offline — bump to tear down stale subscription
        setConnectGeneration((g) => g + 1);
      }
    });
    return unsubscribe;
  }, []);

  // Subscribe to realtime changes — re-runs on reconnect via connectGeneration
  useEffect(() => {
    void fetchData();

    if (!connectedRef.current) return;

    function handleRealtimeEvent(collection: string, action: string, record: RecordModel): void {
      const next = applyRealtimeEvent<T>(dataRef.current, action, record, comparator);
      dataRef.current = next;
      setData(next);
      getApi()?.cacheWrite?.(collection, action, record);
    }

    async function subscribe(): Promise<void> {
      const unsubscribe = await getPb()
        .collection(collectionName)
        .subscribe('*', (e) => handleRealtimeEvent(collectionName, e.action, e.record));
      subscriptionRef.current = unsubscribe;
    }

    subscribe().catch((err: unknown) => {
      handleApiError(err);
    });

    return () => {
      subscriptionRef.current?.();
      subscriptionRef.current = null;
    };
  }, [collectionName, fetchData, connectGeneration, comparator]);

  return { data, loading, error, refetch: fetchData };
}
