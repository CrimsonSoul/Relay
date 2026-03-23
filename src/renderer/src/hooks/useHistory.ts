import { useCallback, useMemo } from 'react';
import { useToast } from '../components/Toast';
import { loggers } from '../utils/logger';
import { useCollection } from './useCollection';

/**
 * Generic history hook for PocketBase-backed history collections.
 * Provides standard CRUD operations with toast feedback.
 */
export function useHistory<TRecord extends { id: string }, TEntry>(
  collectionName: string,
  toEntry: (record: TRecord) => TEntry,
  services: {
    add: (data: Record<string, unknown>) => Promise<TRecord>;
    delete: (id: string) => Promise<void>;
    clear: () => Promise<void>;
  },
  labels: { name: string },
) {
  const { showToast } = useToast();
  const {
    data: records,
    loading,
    refetch: reloadHistory,
  } = useCollection<TRecord>(collectionName, { sort: '-created' });

  const entries = useMemo(() => records.map(toEntry), [records, toEntry]);

  const addHistory = useCallback(
    async (data: Record<string, unknown>): Promise<TEntry | null> => {
      try {
        const created = await services.add(data);
        return toEntry(created);
      } catch (error) {
        loggers.app.error(`Failed to add ${labels.name}`, { error });
        showToast(`Failed to save ${labels.name}`, 'error');
        return null;
      }
    },
    [services, toEntry, labels.name, showToast],
  );

  const deleteHistory = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await services.delete(id);
        showToast('History entry deleted', 'success');
        return true;
      } catch (error) {
        loggers.app.error(`Failed to delete ${labels.name}`, { error });
        showToast('Failed to delete history entry', 'error');
        return false;
      }
    },
    [services, labels.name, showToast],
  );

  const clearHistory = useCallback(async (): Promise<boolean> => {
    try {
      await services.clear();
      showToast(`${labels.name} cleared`, 'success');
      return true;
    } catch (error) {
      loggers.app.error(`Failed to clear ${labels.name}`, { error });
      showToast(`Failed to clear ${labels.name}`, 'error');
      return false;
    }
  }, [services, labels.name, showToast]);

  return { entries, loading, addHistory, deleteHistory, clearHistory, reloadHistory };
}
