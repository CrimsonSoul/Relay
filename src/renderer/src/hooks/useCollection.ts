import { useState, useEffect, useCallback, useRef } from 'react';
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
}

function getApi(): ExtendedApi | undefined {
  return window.api as (ExtendedApi & typeof window.api) | undefined;
}

/** Pure reducer that applies a realtime event to the current data array. */
function applyRealtimeEvent<T extends RecordModel>(
  prev: T[],
  action: string,
  record: RecordModel,
): T[] {
  switch (action) {
    case 'create':
      return [...prev, record as T];
    case 'update':
      return prev.map((r) => (r.id === record.id ? (record as T) : r));
    case 'delete':
      return prev.filter((r) => r.id !== record.id);
    default:
      return prev;
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

  const fetchData = useCallback(async () => {
    try {
      if (isOnline()) {
        const records = await getPb()
          .collection(collectionName)
          .getFullList<T>({
            sort: options.sort || '-created',
            filter: options.filter || '',
          });
        dataRef.current = records;
        setData(records);
        setError(null);
      } else if (options.offlineCacheChannel) {
        const cached = await getApi()?.cacheRead?.(collectionName);
        if (cached) {
          dataRef.current = cached as T[];
          setData(cached as T[]);
        }
      }
    } catch (err) {
      handleApiError(err);
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
      if (options.offlineCacheChannel) {
        try {
          const cached = await getApi()?.cacheRead?.(collectionName);
          if (cached) {
            dataRef.current = cached as T[];
            setData(cached as T[]);
          }
        } catch {
          // Cache also failed
        }
      }
    } finally {
      setLoading(false);
    }
  }, [collectionName, options.sort, options.filter, options.offlineCacheChannel]);

  // Subscribe to realtime changes
  useEffect(() => {
    if (!isOnline()) {
      void fetchData();
      return;
    }

    void fetchData();

    function handleRealtimeEvent(collection: string, action: string, record: RecordModel): void {
      const next = applyRealtimeEvent<T>(dataRef.current, action, record);
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
  }, [collectionName, fetchData]);

  // Re-fetch when coming back online
  useEffect(() => {
    const unsubscribe = onConnectionStateChange((state) => {
      if (state === 'online') {
        void fetchData();
      }
    });
    return unsubscribe;
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
