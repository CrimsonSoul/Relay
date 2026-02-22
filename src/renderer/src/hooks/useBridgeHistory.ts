import { useState, useEffect, useCallback } from 'react';
import type { BridgeHistoryEntry } from '@shared/ipc';
import { useToast } from '../components/Toast';
import { loggers } from '../utils/logger';

export function useBridgeHistory() {
  const { showToast } = useToast();
  const [history, setHistory] = useState<BridgeHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    try {
      setLoading(true);
      const data = await globalThis.api?.getBridgeHistory();
      setHistory(data || []);
    } catch (e) {
      loggers.app.error('Failed to load bridge history', { error: e });
      showToast('Failed to load bridge history', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadHistory().catch((error_) => {
      loggers.app.error('Failed to run initial history load', { error: error_ });
    });
  }, [loadHistory]);

  const addHistory = useCallback(
    async (entry: Omit<BridgeHistoryEntry, 'id' | 'timestamp'>) => {
      const result = await globalThis.api?.addBridgeHistory(entry);
      if (result) {
        setHistory((prev) => [result, ...prev]);
      } else {
        showToast('Failed to save bridge history', 'error');
      }
      return result;
    },
    [showToast],
  );

  const deleteHistory = useCallback(
    async (id: string) => {
      const success = await globalThis.api?.deleteBridgeHistory(id);
      if (success) {
        setHistory((prev) => prev.filter((h) => h.id !== id));
        showToast('History entry deleted', 'success');
      } else {
        showToast('Failed to delete history entry', 'error');
      }
      return success;
    },
    [showToast],
  );

  const clearHistory = useCallback(async () => {
    const success = await globalThis.api?.clearBridgeHistory();
    if (success) {
      setHistory([]);
      showToast('Bridge history cleared', 'success');
    } else {
      showToast('Failed to clear history', 'error');
    }
    return success;
  }, [showToast]);

  return {
    history,
    loading,
    addHistory,
    deleteHistory,
    clearHistory,
    reloadHistory: loadHistory,
  };
}
