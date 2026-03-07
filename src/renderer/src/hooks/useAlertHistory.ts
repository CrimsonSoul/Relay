import { useState, useEffect, useCallback } from 'react';
import type { AlertHistoryEntry, IpcResult } from '@shared/ipc';
import { useToast } from '../components/Toast';
import { loggers } from '../utils/logger';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isIpcResult = <T>(value: unknown): value is IpcResult<T> =>
  isObject(value) && typeof value.success === 'boolean';

const VALID_SEVERITIES = new Set(['ISSUE', 'MAINTENANCE', 'INFO', 'RESOLVED']);

const normalizeAlertHistoryEntry = (value: unknown): AlertHistoryEntry | null => {
  if (!isObject(value)) return null;

  const { id, timestamp, severity, subject, bodyHtml, sender, recipient, pinned, label } = value;

  if (typeof id !== 'string') return null;
  if (typeof timestamp !== 'number') return null;
  if (typeof severity !== 'string' || !VALID_SEVERITIES.has(severity)) return null;
  if (typeof subject !== 'string') return null;
  if (typeof bodyHtml !== 'string') return null;
  if (typeof sender !== 'string') return null;

  return {
    id,
    timestamp,
    severity: severity as AlertHistoryEntry['severity'],
    subject,
    bodyHtml,
    sender,
    recipient: typeof recipient === 'string' ? recipient : '',
    ...(pinned === true ? { pinned: true } : {}),
    ...(typeof label === 'string' && label ? { label } : {}),
  };
};

export function useAlertHistory() {
  const { showToast } = useToast();
  const [history, setHistory] = useState<AlertHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    try {
      setLoading(true);
      const data = await globalThis.api?.getAlertHistory();
      if (!Array.isArray(data)) {
        setHistory([]);
        return;
      }

      setHistory(
        data.map(normalizeAlertHistoryEntry).filter((entry): entry is AlertHistoryEntry => !!entry),
      );
    } catch (e) {
      loggers.app.error('Failed to load alert history', { error: e });
      showToast('Failed to load alert history', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadHistory().catch((error_) => {
      loggers.app.error('Failed to run initial alert history load', { error: error_ });
    });
  }, [loadHistory]);

  const addHistory = useCallback(
    async (entry: Omit<AlertHistoryEntry, 'id' | 'timestamp'>) => {
      try {
        const result = await globalThis.api?.addAlertHistory(entry);
        const normalized = normalizeAlertHistoryEntry(
          isIpcResult<AlertHistoryEntry>(result) ? result.data : result,
        );

        if (normalized) {
          setHistory((prev) => [normalized, ...prev]);
        } else {
          showToast('Failed to save alert history', 'error');
        }

        return normalized;
      } catch (error) {
        loggers.app.error('Failed to add alert history', { error });
        showToast('Failed to save alert history', 'error');
        return null;
      }
    },
    [showToast],
  );

  const deleteHistory = useCallback(
    async (id: string) => {
      try {
        const result = await globalThis.api?.deleteAlertHistory(id);
        const success = isIpcResult(result) ? result.success : !!result;

        if (success) {
          setHistory((prev) => prev.filter((h) => h.id !== id));
          showToast('History entry deleted', 'success');
        } else {
          showToast('Failed to delete history entry', 'error');
        }
        return success;
      } catch (error) {
        loggers.app.error('Failed to delete alert history', { error });
        showToast('Failed to delete history entry', 'error');
        return false;
      }
    },
    [showToast],
  );

  const clearHistory = useCallback(async () => {
    try {
      const result = await globalThis.api?.clearAlertHistory();
      const success = isIpcResult(result) ? result.success : !!result;

      if (success) {
        setHistory([]);
        showToast('Alert history cleared', 'success');
      } else {
        showToast('Failed to clear history', 'error');
      }
      return success;
    } catch (error) {
      loggers.app.error('Failed to clear alert history', { error });
      showToast('Failed to clear history', 'error');
      return false;
    }
  }, [showToast]);

  const pinHistory = useCallback(
    async (id: string, pinned: boolean) => {
      try {
        const result = await globalThis.api?.pinAlertHistory(id, pinned);
        const success = isIpcResult(result) ? result.success : !!result;

        if (success) {
          setHistory((prev) =>
            prev.map((h) =>
              h.id === id
                ? { ...h, pinned: pinned || undefined, ...(pinned ? {} : { label: undefined }) }
                : h,
            ),
          );
          showToast(pinned ? 'Pinned as template' : 'Unpinned', 'success');
        } else {
          showToast('Failed to update pin', 'error');
        }
        return success;
      } catch (error) {
        loggers.app.error('Failed to update alert history pin', { error });
        showToast('Failed to update pin', 'error');
        return false;
      }
    },
    [showToast],
  );

  const updateLabel = useCallback(
    async (id: string, label: string) => {
      try {
        const result = await globalThis.api?.updateAlertHistoryLabel(id, label);
        const success = isIpcResult(result) ? result.success : !!result;

        if (success) {
          setHistory((prev) =>
            prev.map((h) => (h.id === id ? { ...h, label: label || undefined } : h)),
          );
        } else {
          showToast('Failed to update label', 'error');
        }
        return success;
      } catch (error) {
        loggers.app.error('Failed to update alert history label', { error });
        showToast('Failed to update label', 'error');
        return false;
      }
    },
    [showToast],
  );

  return {
    history,
    loading,
    addHistory,
    deleteHistory,
    clearHistory,
    pinHistory,
    updateLabel,
    reloadHistory: loadHistory,
  };
}
