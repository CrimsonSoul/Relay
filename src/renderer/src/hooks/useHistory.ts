import { useCallback, useMemo } from 'react';
import { useToast } from '../components/Toast';
import { loggers } from '../utils/logger';
import { formatFailure } from '../utils/failureMessage';
import { useCollection } from './useCollection';

/**
 * Generic history hook for PocketBase-backed history collections.
 * Provides standard CRUD operations with toast feedback.
 *
 * `labels.reportAddFailure: false` leaves a failed add to the caller, for a collection whose only
 * writer already reports the failure with more context (bridge history does, with Retry).
 */
export function useHistory<TRecord extends { id: string }, TEntry>(
  collectionName: string,
  toEntry: (record: TRecord) => TEntry,
  services: {
    add: (data: Record<string, unknown>) => Promise<TRecord>;
    delete: (id: string) => Promise<void>;
    clear: () => Promise<void>;
  },
  labels: { name: string; reportAddFailure?: boolean },
) {
  const { showToast } = useToast();
  const {
    data: records,
    loading,
    refetch: reloadHistory,
  } = useCollection<TRecord>(collectionName, { sort: '-created' });

  const entries = useMemo(() => records.map(toEntry), [records, toEntry]);
  const entryCount = records.length;

  const addHistory = useCallback(
    async (data: Record<string, unknown>): Promise<TEntry | null> => {
      try {
        const created = await services.add(data);
        return toEntry(created);
      } catch (error) {
        loggers.app.error(`Failed to add ${labels.name}`, { error });
        if (labels.reportAddFailure !== false) {
          showToast(formatFailure({ what: `Couldn't save to ${labels.name}`, error }), 'error');
        }
        return null;
      }
    },
    [services, toEntry, labels.name, labels.reportAddFailure, showToast],
  );

  const deleteHistory = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await services.delete(id);
        showToast(`Deleted the ${labels.name} entry`, 'success');
        return true;
      } catch (error) {
        loggers.app.error(`Failed to delete ${labels.name}`, { error });
        showToast(
          formatFailure({
            what: `Couldn't delete the ${labels.name} entry`,
            error,
            outcome: `It is still in ${labels.name}.`,
          }),
          'error',
        );
        return false;
      }
    },
    [services, labels.name, showToast],
  );

  const clearHistory = useCallback(async (): Promise<boolean> => {
    try {
      await services.clear();
      showToast(
        `Cleared ${labels.name} (${entryCount} ${entryCount === 1 ? 'entry' : 'entries'})`,
        'success',
      );
      return true;
    } catch (error) {
      loggers.app.error(`Failed to clear ${labels.name}`, { error });
      showToast(
        formatFailure({
          what: `Couldn't clear ${labels.name}`,
          error,
          outcome: 'Some entries may already be gone.',
        }),
        'error',
      );
      return false;
    }
  }, [services, labels.name, entryCount, showToast]);

  return { entries, loading, addHistory, deleteHistory, clearHistory, reloadHistory };
}
