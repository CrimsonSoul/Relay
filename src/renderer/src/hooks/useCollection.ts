import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { RecordModel } from 'pocketbase';
import { getCollectionStore, normalizeCollectionQuery } from '../stores/collectionStoreRegistry';
import type {
  CollectionQueryOptions,
  CollectionRecord,
  CollectionSnapshot,
} from '../stores/collectionStore';

export { collectionQueryCacheKey, collectionRevisionSignature } from '../stores/collectionStore';
export { normalizeCollectionQuery } from '../stores/collectionStoreRegistry';

interface UseCollectionResult<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  hasLoadedSnapshot: boolean;
  isAuthoritative: boolean;
  totalItems: number;
  hasMore: boolean;
  loadingMore: boolean;
  cachedPartial?: boolean;
  offlineReadiness?: NonNullable<CollectionSnapshot<CollectionRecord>['offlineReadiness']>;
  offlineError?: string;
  retryOfflineSave?: () => Promise<void>;
  refetch: () => Promise<void>;
  loadMore: () => Promise<void>;
}

export interface UseCollectionOptions extends CollectionQueryOptions {
  enabled?: boolean;
}

const DISABLED_SNAPSHOT: CollectionSnapshot<never> = {
  data: [],
  loading: false,
  error: null,
  hasLoadedSnapshot: false,
  isAuthoritative: false,
};
const subscribeDisabled = () => () => undefined;
const getDisabledSnapshot = () => DISABLED_SNAPSHOT;
const refetchDisabled = async () => undefined;

export function useCollection<T extends CollectionRecord = RecordModel>(
  collectionName: string,
  options: UseCollectionOptions = {},
): UseCollectionResult<T> {
  const { enabled = true, ...queryOptions } = options;
  const queryKey = normalizeCollectionQuery(collectionName, queryOptions);
  const batchedValuesKey = JSON.stringify(queryOptions.batchedFilter?.values ?? []);
  const store = useMemo(
    () => (enabled ? getCollectionStore<T>(collectionName, queryOptions) : null),
    // The normalized key captures every option that changes query identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, queryKey],
  );
  useEffect(() => {
    store?.updateBatchedFilterValues(queryOptions.batchedFilter?.values ?? []);
    // The serialized value set is the dynamic part intentionally excluded from store identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchedValuesKey, store]);
  const snapshot = useSyncExternalStore<CollectionSnapshot<T>>(
    store?.subscribe ?? subscribeDisabled,
    store?.getSnapshot ?? getDisabledSnapshot,
    store?.getSnapshot ?? getDisabledSnapshot,
  );

  return useMemo(
    () => ({
      data: snapshot.data,
      loading: snapshot.loading,
      error: snapshot.error,
      hasLoadedSnapshot: snapshot.hasLoadedSnapshot,
      isAuthoritative: snapshot.isAuthoritative,
      totalItems: snapshot.totalItems ?? snapshot.data.length,
      hasMore: snapshot.hasMore === true,
      loadingMore: snapshot.loadingMore === true,
      cachedPartial: snapshot.cachedPartial === true,
      offlineReadiness: snapshot.offlineReadiness,
      offlineError: snapshot.offlineError,
      retryOfflineSave: store?.retryOfflineSave ?? refetchDisabled,
      refetch: store?.refetch ?? refetchDisabled,
      loadMore: store?.loadMore ?? refetchDisabled,
    }),
    [snapshot, store],
  );
}
