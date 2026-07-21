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

export interface UseCollectionOptions extends CollectionQueryOptions {
  enabled?: boolean;
}

const DISABLED_SNAPSHOT = {
  data: [],
  loading: false,
  error: null,
  hasLoadedSnapshot: false,
} as const;
const subscribeDisabled = () => () => undefined;
const getDisabledSnapshot = () => DISABLED_SNAPSHOT;
const refetchDisabled = async () => undefined;

export function useCollection<T extends RecordModel>(
  collectionName: string,
  options: UseCollectionOptions = {},
): UseCollectionResult<T> {
  const { enabled = true, ...queryOptions } = options;
  const queryKey = normalizeCollectionQuery(collectionName, queryOptions);
  const store = useMemo(
    () => (enabled ? getCollectionStore<T>(collectionName, queryOptions) : null),
    // The normalized key captures every option that changes query identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, queryKey],
  );
  const snapshot = useSyncExternalStore(
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
      refetch: store?.refetch ?? refetchDisabled,
    }),
    [snapshot, store],
  );
}
