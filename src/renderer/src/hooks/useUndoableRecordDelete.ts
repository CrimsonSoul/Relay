import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShowToast } from '../components/Toast';

/** How long a deleted contact or server stays recoverable before the delete is committed. */
export const RECORD_DELETE_UNDO_MS = 6000;

type UndoableRecordDeleteOptions<T> = {
  /** Current source records; a committed key is released once its record leaves this list. */
  records: readonly T[];
  getKey: (record: T) => string;
  /** Toast text announcing the delete, e.g. "Deleted api-prod-01". */
  describe: (record: T) => string;
  /** Runs the real delete. Resolves false (after reporting why) when nothing was deleted. */
  commitDelete: (record: T) => Promise<boolean>;
  /** Re-creates a record whose delete was already committed when Undo arrived. */
  restoreDeleted: (record: T) => Promise<unknown>;
  showToast: ShowToast;
};

/**
 * Deleting a record hides it immediately and offers Undo in a toast. The real delete is
 * written only when that toast leaves without Undo (timeout, Dismiss) or the owning tab
 * unmounts; Undo inside the window just un-hides the record, so nothing is written. If the
 * tab unmounted first, the delete is already committed and Undo re-creates the record.
 */
export function useUndoableRecordDelete<T>({
  records,
  getKey,
  describe,
  commitDelete,
  restoreDeleted,
  showToast,
}: UndoableRecordDeleteOptions<T>) {
  const [hiddenKeys, setHiddenKeys] = useState<ReadonlySet<string>>(() => new Set());
  const pendingRef = useRef(new Map<string, T>());
  const committedKeysRef = useRef(new Set<string>());
  const callbacksRef = useRef({ getKey, commitDelete, restoreDeleted });
  useEffect(() => {
    callbacksRef.current = { getKey, commitDelete, restoreDeleted };
  }, [commitDelete, getKey, restoreDeleted]);

  const unhide = useCallback((key: string) => {
    setHiddenKeys((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  }, []);

  const commit = useCallback(
    (key: string) => {
      const record = pendingRef.current.get(key);
      if (record === undefined) return;
      pendingRef.current.delete(key);
      committedKeysRef.current.add(key);
      void callbacksRef.current
        .commitDelete(record)
        .catch(() => false)
        .then((deleted) => {
          if (deleted) return;
          committedKeysRef.current.delete(key);
          unhide(key);
        });
    },
    [unhide],
  );

  const undo = useCallback(
    (key: string, record: T) => {
      unhide(key);
      if (pendingRef.current.delete(key)) return;
      if (!committedKeysRef.current.delete(key)) return;
      void callbacksRef.current.restoreDeleted(record).catch(() => {
        // restoreDeleted reports its own failures.
      });
    },
    [unhide],
  );

  const requestDelete = useCallback(
    (record: T) => {
      const key = callbacksRef.current.getKey(record);
      if (pendingRef.current.has(key)) return;
      pendingRef.current.set(key, record);
      setHiddenKeys((current) => new Set(current).add(key));
      showToast(describe(record), 'info', {
        durationMs: RECORD_DELETE_UNDO_MS,
        action: { label: 'Undo', onClick: () => undo(key, record) },
        onDismiss: () => commit(key),
      });
    },
    [commit, describe, showToast, undo],
  );

  // A committed record stays hidden until realtime drops it, then its key is released so a
  // later record with the same identity is never hidden by mistake.
  useEffect(() => {
    const committed = committedKeysRef.current;
    if (committed.size === 0) return;
    const present = new Set(records.map((record) => callbacksRef.current.getKey(record)));
    for (const key of committed) {
      if (present.has(key)) continue;
      committed.delete(key);
      unhide(key);
    }
  }, [records, unhide]);

  // Leaving the tab closes the undo window: commit whatever is still pending.
  useEffect(() => {
    const pending = pendingRef.current;
    return () => {
      for (const key of pending.keys()) commit(key);
    };
  }, [commit]);

  return { requestDelete, hiddenKeys };
}
