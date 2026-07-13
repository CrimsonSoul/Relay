import { useMemo, useSyncExternalStore } from 'react';
import type { RecordModel } from 'pocketbase';
import { getCollectionStore, normalizeCollectionQuery } from '../stores/collectionStoreRegistry';
import type { CollectionQueryOptions } from '../stores/collectionStore';

export { collectionRevisionSignature } from '../stores/collectionStore';
export { normalizeCollectionQuery } from '../stores/collectionStoreRegistry';

interface UseCollectionResult<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  hasLoadedSnapshot: boolean;
  refetch: () => Promise<void>;
}

export function useCollection<T extends RecordModel>(
  collectionName: string,
  options: CollectionQueryOptions = {},
): UseCollectionResult<T> {
  const queryKey = normalizeCollectionQuery(collectionName, options);
  const store = useMemo(
    () => getCollectionStore<T>(collectionName, options),
    // The normalized key captures every option that changes query identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryKey],
  );
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return useMemo(
    () => ({
      data: snapshot.data,
      loading: snapshot.loading,
      error: snapshot.error,
      hasLoadedSnapshot: snapshot.hasLoadedSnapshot,
      refetch: store.refetch,
    }),
    [snapshot, store],
  );
}
