import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AlertHistoryEntry } from '@shared/ipc';
import type { ShowToast } from '../../components/Toast';

/** How long a deleted history entry stays recoverable before the delete is committed. */
export const HISTORY_DELETE_UNDO_MS = 6000;

type UndoableHistoryDeleteOptions = {
  history: AlertHistoryEntry[];
  deleteHistory: (id: string) => Promise<unknown>;
  /** Deletes a cleared batch; resolves with the ids that were really deleted. */
  deleteHistoryEntries: (ids: readonly string[]) => Promise<string[]>;
  addHistory: (entry: Omit<AlertHistoryEntry, 'id' | 'timestamp'>) => Promise<unknown>;
  showToast: ShowToast;
};

/** One Clear All: the entries it hid and, once committed, the ids it really deleted. */
type ClearBatch = { entries: AlertHistoryEntry[]; deleted?: Promise<string[]> };

function formatEntryCount(count: number): string {
  return `${count} ${count === 1 ? 'entry' : 'entries'}`;
}

/**
 * Deleting a history entry, or clearing all of them, hides the entries immediately and offers
 * Undo in a toast. The real delete runs once the undo window closes (or the tab unmounts); an
 * Undo that arrives after the delete was committed re-adds the deleted entries instead.
 */
export function useUndoableHistoryDelete({
  history,
  deleteHistory,
  deleteHistoryEntries,
  addHistory,
  showToast,
}: UndoableHistoryDeleteOptions) {
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());
  const pendingTimersRef = useRef(new Map<string, number>());
  const pendingClearsRef = useRef(new Set<ClearBatch>());
  const callbacksRef = useRef({ deleteHistory, deleteHistoryEntries, addHistory });
  useEffect(() => {
    callbacksRef.current = { deleteHistory, deleteHistoryEntries, addHistory };
  }, [addHistory, deleteHistory, deleteHistoryEntries]);

  const hideIds = useCallback((ids: readonly string[]) => {
    setHiddenIds((current) => new Set([...current, ...ids]));
  }, []);

  const unhideIds = useCallback((ids: readonly string[]) => {
    setHiddenIds((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const restoreEntry = useCallback((entry: AlertHistoryEntry) => {
    const restorable: Omit<typeof entry, 'id' | 'timestamp'> & Partial<typeof entry> = {
      ...entry,
    };
    delete restorable.id;
    delete restorable.timestamp;
    void callbacksRef.current.addHistory(restorable);
  }, []);

  const commitDelete = useCallback((id: string) => {
    const timer = pendingTimersRef.current.get(id);
    if (timer === undefined) return;
    window.clearTimeout(timer);
    pendingTimersRef.current.delete(id);
    void callbacksRef.current.deleteHistory(id);
  }, []);

  const undoDelete = useCallback(
    (entry: AlertHistoryEntry) => {
      const timer = pendingTimersRef.current.get(entry.id);
      if (timer === undefined) {
        restoreEntry(entry);
        return;
      }
      window.clearTimeout(timer);
      pendingTimersRef.current.delete(entry.id);
      unhideIds([entry.id]);
    },
    [restoreEntry, unhideIds],
  );

  const requestDelete = useCallback(
    (id: string) => {
      const entry = history.find((candidate) => candidate.id === id);
      if (!entry) {
        void callbacksRef.current.deleteHistory(id);
        return;
      }
      if (pendingTimersRef.current.has(id)) return;
      pendingTimersRef.current.set(
        id,
        window.setTimeout(() => commitDelete(id), HISTORY_DELETE_UNDO_MS),
      );
      hideIds([id]);
      showToast(entry.pinned ? 'Template deleted' : 'Alert deleted from history', 'info', {
        durationMs: HISTORY_DELETE_UNDO_MS,
        action: { label: 'Undo', onClick: () => undoDelete(entry) },
      });
    },
    [commitDelete, hideIds, history, showToast, undoDelete],
  );

  const commitClear = useCallback(
    (batch: ClearBatch) => {
      if (!pendingClearsRef.current.delete(batch)) return;
      const ids = batch.entries.map((entry) => entry.id);
      batch.deleted = callbacksRef.current.deleteHistoryEntries(ids).catch(() => []);
      // Entries that failed to delete come back; deleted ones leave with the realtime update.
      void batch.deleted.then((deleted) => {
        const kept = ids.filter((id) => !deleted.includes(id));
        if (kept.length > 0) unhideIds(kept);
      });
    },
    [unhideIds],
  );

  const undoClear = useCallback(
    (batch: ClearBatch) => {
      if (pendingClearsRef.current.delete(batch)) {
        unhideIds(batch.entries.map((entry) => entry.id));
        return;
      }
      void batch.deleted?.then((deleted) => {
        for (const entry of batch.entries) {
          if (deleted.includes(entry.id)) restoreEntry(entry);
        }
      });
    },
    [restoreEntry, unhideIds],
  );

  const visibleHistory = useMemo(
    () => (hiddenIds.size === 0 ? history : history.filter((entry) => !hiddenIds.has(entry.id))),
    [hiddenIds, history],
  );

  /** Clear All: hides every visible entry and commits the deletes when the Undo toast leaves. */
  const requestClear = useCallback(() => {
    if (visibleHistory.length === 0) return;
    const batch: ClearBatch = { entries: visibleHistory };
    pendingClearsRef.current.add(batch);
    hideIds(batch.entries.map((entry) => entry.id));
    showToast(`Cleared alert history (${formatEntryCount(batch.entries.length)})`, 'info', {
      durationMs: HISTORY_DELETE_UNDO_MS,
      action: { label: 'Undo', onClick: () => undoClear(batch) },
      onDismiss: () => commitClear(batch),
    });
  }, [commitClear, hideIds, showToast, undoClear, visibleHistory]);

  // Leaving the tab closes every undo window: commit whatever is still pending.
  useEffect(() => {
    const pendingTimers = pendingTimersRef.current;
    const pendingClears = pendingClearsRef.current;
    return () => {
      for (const id of [...pendingTimers.keys()]) commitDelete(id);
      for (const batch of [...pendingClears]) commitClear(batch);
    };
  }, [commitClear, commitDelete]);

  return { visibleHistory, requestDelete, requestClear };
}
