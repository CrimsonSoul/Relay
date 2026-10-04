import { useCallback } from 'react';
import type { AlertHistoryEntry } from '@shared/ipc';
import { useToast } from '../components/Toast';
import { loggers } from '../utils/logger';
import { formatFailure } from '../utils/failureMessage';
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

  const describeEntry = useCallback(
    (id: string) => {
      const entry = history.find((candidate) => candidate.id === id);
      const name = entry?.label || entry?.subject;
      return name ? `"${name}"` : 'this alert';
    },
    [history],
  );

  const pinHistory = useCallback(
    (id: string, pinned: boolean) => {
      const name = describeEntry(id);
      // Setting `pinned` to the same value again is idempotent, so the failure offers Retry.
      const attempt = async (): Promise<boolean> => {
        try {
          await pbPinAlertHistory(id, pinned);
          showToast(pinned ? `Pinned ${name} as a template` : `Unpinned ${name}`, 'success');
          return true;
        } catch (error) {
          loggers.app.error('Failed to update alert history pin', { error });
          showToast(
            formatFailure({
              what: pinned ? `Couldn't pin ${name} as a template` : `Couldn't unpin ${name}`,
              error,
              outcome: 'Nothing changed.',
            }),
            'error',
            { action: { label: 'Retry', onClick: () => void attempt() } },
          );
          return false;
        }
      };
      return attempt();
    },
    [describeEntry, showToast],
  );

  const updateLabel = useCallback(
    async (id: string, label: string) => {
      try {
        await pbUpdateAlertLabel(id, label);
        return true;
      } catch (error) {
        loggers.app.error('Failed to update alert history label', { error });
        showToast(
          formatFailure({
            what: `Couldn't rename ${describeEntry(id)}`,
            error,
            outcome: 'The previous label is kept.',
          }),
          'error',
        );
        return false;
      }
    },
    [describeEntry, showToast],
  );

  /**
   * Commits a deferred Clear All: deletes exactly the entries the operator cleared, so an entry
   * saved meanwhile survives. Success was already announced by the Undo toast; failures report
   * here. Resolves with the ids that were really deleted.
   */
  const deleteHistoryEntries = useCallback(
    async (ids: readonly string[]): Promise<string[]> => {
      const results = await Promise.allSettled(ids.map((id) => pbDeleteAlertHistory(id)));
      const deleted = ids.filter((_, index) => results[index]?.status === 'fulfilled');
      const failure = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failure) {
        const failedCount = ids.length - deleted.length;
        loggers.app.error('Failed to clear alert history', { error: failure.reason });
        showToast(
          formatFailure({
            what: `Couldn't clear ${failedCount} of ${ids.length} alert history entries`,
            error: failure.reason,
            outcome: 'They are still in alert history.',
          }),
          'error',
        );
      }
      return deleted;
    },
    [showToast],
  );

  return {
    history,
    loading,
    addHistory,
    deleteHistory,
    deleteHistoryEntries,
    pinHistory,
    updateLabel,
    reloadHistory,
  };
}
