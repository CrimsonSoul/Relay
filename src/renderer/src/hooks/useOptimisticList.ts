import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Manages a local copy of a list with optimistic update support.
 * While mutations are in-flight, external updates are queued and applied
 * after all mutations settle. This prevents realtime pushes from
 * overwriting optimistic UI state.
 */
export function useOptimisticList<T>(externalData: T[]) {
  const [localData, setLocalData] = useState<T[]>(externalData);
  const pendingRef = useRef(0);
  const queuedRef = useRef<T[] | null>(null);
  const localRef = useRef(localData);
  localRef.current = localData;

  const finishMutation = useCallback(() => {
    pendingRef.current = Math.max(0, pendingRef.current - 1);
    if (pendingRef.current === 0) {
      // Discard queued external data — the optimistic state is already correct.
      // Applying queued realtime events would undo optimistic ordering because
      // PocketBase delete+create cycles append records to the end of the array,
      // scrambling the derived team order.  The next external data change (from
      // any new realtime event) will sync naturally with pendingRef at 0.
      queuedRef.current = null;
    }
  }, []);

  const startMutation = useCallback(() => {
    pendingRef.current++;
  }, []);

  // Sync with external updates only when no mutations in-flight.
  useEffect(() => {
    if (pendingRef.current === 0) {
      setLocalData((prev) => (prev === externalData ? prev : externalData));
      queuedRef.current = null;
    } else {
      queuedRef.current = externalData;
    }
  }, [externalData]);

  return {
    data: localData,
    setData: setLocalData,
    dataRef: localRef,
    startMutation,
    finishMutation,
  };
}
