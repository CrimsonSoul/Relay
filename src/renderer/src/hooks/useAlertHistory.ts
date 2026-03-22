import { useCallback, useMemo } from 'react';
import type { AlertHistoryEntry } from '@shared/ipc';
import { useToast } from '../components/Toast';
import { loggers } from '../utils/logger';
import { useCollection } from './useCollection';
import {
  addAlertHistory as pbAddAlertHistory,
  deleteAlertHistory as pbDeleteAlertHistory,
  clearAlertHistory as pbClearAlertHistory,
  pinAlertHistory as pbPinAlertHistory,
  updateAlertLabel as pbUpdateAlertLabel,
} from '../services/alertHistoryService';
import type { AlertHistoryRecord } from '../services/alertHistoryService';

function toAlertHistoryEntry(r: AlertHistoryRecord): AlertHistoryEntry {
  return {
    id: r.id,
    timestamp: new Date(r.created).getTime(),
    severity: r.severity,
    subject: r.subject,
    bodyHtml: r.bodyHtml,
    sender: r.sender,
    recipient: r.recipient || '',
    ...(r.pinned ? { pinned: true } : {}),
    ...(r.label ? { label: r.label } : {}),
  };
}

export function useAlertHistory() {
  const { showToast } = useToast();
  const {
    data: alertRecords,
    loading,
    refetch: reloadHistory,
  } = useCollection<AlertHistoryRecord>('alert_history', { sort: '-created' });

  const history = useMemo(() => alertRecords.map(toAlertHistoryEntry), [alertRecords]);

  const addHistory = useCallback(
    async (entry: Omit<AlertHistoryEntry, 'id' | 'timestamp'>) => {
      try {
        const created = await pbAddAlertHistory({
          severity: entry.severity,
          subject: entry.subject,
          bodyHtml: entry.bodyHtml,
          sender: entry.sender,
          recipient: entry.recipient || '',
          pinned: entry.pinned || false,
          label: entry.label || '',
        });
        return toAlertHistoryEntry(created);
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
        await pbDeleteAlertHistory(id);
        showToast('History entry deleted', 'success');
        return true;
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
      await pbClearAlertHistory();
      showToast('Alert history cleared', 'success');
      return true;
    } catch (error) {
      loggers.app.error('Failed to clear alert history', { error });
      showToast('Failed to clear history', 'error');
      return false;
    }
  }, [showToast]);

  const pinHistory = useCallback(
    async (id: string, pinned: boolean) => {
      try {
        await pbPinAlertHistory(id, pinned);
        showToast(pinned ? 'Pinned as template' : 'Unpinned', 'success');
        return true;
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
        await pbUpdateAlertLabel(id, label);
        return true;
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
    reloadHistory,
  };
}
