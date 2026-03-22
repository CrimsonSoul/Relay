import { useCallback, useMemo } from 'react';
import type { BridgeHistoryEntry } from '@shared/ipc';
import { useToast } from '../components/Toast';
import { loggers } from '../utils/logger';
import { useCollection } from './useCollection';
import {
  addBridgeHistory as pbAddBridgeHistory,
  deleteBridgeHistory as pbDeleteBridgeHistory,
  clearBridgeHistory as pbClearBridgeHistory,
} from '../services/bridgeHistoryService';
import type { BridgeHistoryRecord } from '../services/bridgeHistoryService';

function toBridgeHistoryEntry(r: BridgeHistoryRecord): BridgeHistoryEntry {
  return {
    id: r.id,
    timestamp: new Date(r.created).getTime(),
    note: r.note,
    groups: r.groups || [],
    contacts: r.contacts || [],
    recipientCount: r.recipientCount,
  };
}

export function useBridgeHistory() {
  const { showToast } = useToast();
  const {
    data: historyRecords,
    loading,
    refetch: reloadHistory,
  } = useCollection<BridgeHistoryRecord>('bridge_history', { sort: '-created' });

  const history = useMemo(() => historyRecords.map(toBridgeHistoryEntry), [historyRecords]);

  const addHistory = useCallback(
    async (entry: Omit<BridgeHistoryEntry, 'id' | 'timestamp'>) => {
      try {
        const created = await pbAddBridgeHistory({
          note: entry.note,
          groups: entry.groups,
          contacts: entry.contacts,
          recipientCount: entry.recipientCount,
        });
        return toBridgeHistoryEntry(created);
      } catch (error) {
        loggers.app.error('Failed to add bridge history', { error });
        showToast('Failed to save bridge history', 'error');
        return null;
      }
    },
    [showToast],
  );

  const deleteHistory = useCallback(
    async (id: string) => {
      try {
        await pbDeleteBridgeHistory(id);
        showToast('History entry deleted', 'success');
        return true;
      } catch (error) {
        loggers.app.error('Failed to delete bridge history', { error });
        showToast('Failed to delete history entry', 'error');
        return false;
      }
    },
    [showToast],
  );

  const clearHistory = useCallback(async () => {
    try {
      await pbClearBridgeHistory();
      showToast('Bridge history cleared', 'success');
      return true;
    } catch (error) {
      loggers.app.error('Failed to clear bridge history', { error });
      showToast('Failed to clear history', 'error');
      return false;
    }
  }, [showToast]);

  return {
    history,
    loading,
    addHistory,
    deleteHistory,
    clearHistory,
    reloadHistory,
  };
}
