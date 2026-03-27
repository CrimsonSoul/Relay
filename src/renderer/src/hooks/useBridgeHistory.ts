import type { BridgeHistoryEntry } from '@shared/ipc';
import {
  addBridgeHistory as pbAddBridgeHistory,
  deleteBridgeHistory as pbDeleteBridgeHistory,
  clearBridgeHistory as pbClearBridgeHistory,
} from '../services/bridgeHistoryService';
import type { BridgeHistoryRecord } from '../services/bridgeHistoryService';
import { useHistory } from './useHistory';

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

const bridgeHistoryServices = {
  add: pbAddBridgeHistory as (data: Record<string, unknown>) => Promise<BridgeHistoryRecord>,
  delete: pbDeleteBridgeHistory,
  clear: pbClearBridgeHistory,
};

const bridgeHistoryLabels = { name: 'bridge history' };

export function useBridgeHistory() {
  const {
    entries,
    loading,
    addHistory: addHistoryRaw,
    deleteHistory,
    clearHistory,
    reloadHistory,
  } = useHistory<BridgeHistoryRecord, BridgeHistoryEntry>(
    'bridge_history',
    toBridgeHistoryEntry,
    bridgeHistoryServices,
    bridgeHistoryLabels,
  );

  const history = entries;

  const addHistory = (entry: Omit<BridgeHistoryEntry, 'id' | 'timestamp'>) =>
    addHistoryRaw({
      note: entry.note,
      groups: entry.groups,
      contacts: entry.contacts,
      recipientCount: entry.recipientCount,
    });

  return {
    history,
    loading,
    addHistory,
    deleteHistory,
    clearHistory,
    reloadHistory,
  };
}
