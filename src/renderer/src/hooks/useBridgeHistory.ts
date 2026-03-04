import { useState, useEffect, useCallback } from 'react';
import type { BridgeHistoryEntry, IpcResult } from '@shared/ipc';
import { useToast } from '../components/Toast';
import { loggers } from '../utils/logger';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isIpcResult = <T>(value: unknown): value is IpcResult<T> =>
  isObject(value) && typeof value.success === 'boolean';

const normalizeBridgeHistoryEntry = (value: unknown): BridgeHistoryEntry | null => {
  if (!isObject(value)) return null;

  const id = value.id;
  const timestamp = value.timestamp;
  const note = value.note;
  const groups = value.groups;
  const contacts = value.contacts;
  const recipientCount = value.recipientCount;

  if (typeof id !== 'string') return null;
  if (typeof timestamp !== 'number') return null;
  if (typeof note !== 'string') return null;
  if (!Array.isArray(groups) || !groups.every((g) => typeof g === 'string')) return null;
  if (!Array.isArray(contacts) || !contacts.every((c) => typeof c === 'string')) return null;
  if (typeof recipientCount !== 'number') return null;

  return { id, timestamp, note, groups, contacts, recipientCount };
};

export function useBridgeHistory() {
  const { showToast } = useToast();
  const [history, setHistory] = useState<BridgeHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    try {
      setLoading(true);
      const data = await globalThis.api?.getBridgeHistory();
      if (!Array.isArray(data)) {
        setHistory([]);
        return;
      }

      setHistory(
        data
          .map(normalizeBridgeHistoryEntry)
          .filter((entry): entry is BridgeHistoryEntry => !!entry),
      );
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
      try {
        const result = await globalThis.api?.addBridgeHistory(entry);
        const normalized = normalizeBridgeHistoryEntry(
          isIpcResult<BridgeHistoryEntry>(result) ? result.data : result,
        );

        if (normalized) {
          setHistory((prev) => [normalized, ...prev]);
        } else {
          showToast('Failed to save bridge history', 'error');
        }

        return normalized;
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
        const result = await globalThis.api?.deleteBridgeHistory(id);
        const success = isIpcResult(result) ? result.success : !!result;

        if (success) {
          setHistory((prev) => prev.filter((h) => h.id !== id));
          showToast('History entry deleted', 'success');
        } else {
          showToast('Failed to delete history entry', 'error');
        }
        return success;
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
      const result = await globalThis.api?.clearBridgeHistory();
      const success = isIpcResult(result) ? result.success : !!result;

      if (success) {
        setHistory([]);
        showToast('Bridge history cleared', 'success');
      } else {
        showToast('Failed to clear history', 'error');
      }
      return success;
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
    reloadHistory: loadHistory,
  };
}
