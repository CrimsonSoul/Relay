import { useCallback } from 'react';
import type { AlertHistoryEntry } from '@shared/ipc';
import { useToast } from '../components/Toast';
import { loggers } from '../utils/logger';
import {
  addAlertHistory as pbAddAlertHistory,
  deleteAlertHistory as pbDeleteAlertHistory,
  clearAlertHistory as pbClearAlertHistory,
  pinAlertHistory as pbPinAlertHistory,
  updateAlertLabel as pbUpdateAlertLabel,
} from '../services/alertHistoryService';
import type { AlertHistoryRecord } from '../services/alertHistoryService';
import { useHistory } from './useHistory';

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

const alertHistoryServices = {
  add: pbAddAlertHistory as (data: Record<string, unknown>) => Promise<AlertHistoryRecord>,
  delete: pbDeleteAlertHistory,
  clear: pbClearAlertHistory,
};

const alertHistoryLabels = { name: 'alert history' };

export function useAlertHistory() {
  const { showToast } = useToast();

  const {
    entries,
    loading,
    addHistory: addHistoryRaw,
    deleteHistory,
    clearHistory,
    reloadHistory,
  } = useHistory<AlertHistoryRecord, AlertHistoryEntry>(
    'alert_history',
    toAlertHistoryEntry,
    alertHistoryServices,
    alertHistoryLabels,
  );

  const history = entries;

  const addHistory = (entry: Omit<AlertHistoryEntry, 'id' | 'timestamp'>) =>
    addHistoryRaw({
      severity: entry.severity,
      subject: entry.subject,
      bodyHtml: entry.bodyHtml,
      sender: entry.sender,
      recipient: entry.recipient || '',
      pinned: entry.pinned || false,
      label: entry.label || '',
    });

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
