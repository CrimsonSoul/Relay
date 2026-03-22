import { useState, useCallback } from 'react';
import type { ImportResult, DataStats } from '@shared/ipc';
import { loggers } from '../utils/logger';
import { getPb } from '../services/pocketbase';

export function useDataManager() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [stats, setStats] = useState<DataStats | null>(null);
  const [lastImportResult, setLastImportResult] = useState<ImportResult | null>(null);

  const loadStats = useCallback(async () => {
    try {
      // Build stats from PocketBase directly
      const data: DataStats = { contacts: 0, servers: 0, groups: 0, onCall: 0, total: 0 };
      const collectionToStat: Record<string, keyof Omit<DataStats, 'total'>> = {
        contacts: 'contacts',
        servers: 'servers',
        bridge_groups: 'groups',
        oncall: 'onCall',
      };
      for (const [collection, key] of Object.entries(collectionToStat)) {
        try {
          const result = await getPb().collection(collection).getList(1, 1);
          data[key] = result.totalItems;
          data.total += result.totalItems;
        } catch {
          // Collection may not exist yet
        }
      }
      setStats(data);
      return data;
    } catch (e) {
      loggers.storage.error('Failed to load data stats', { error: e });
      return null;
    }
  }, []);

  // Export and import still use IPC for native file dialogs.
  // The actual data reading/writing happens via PocketBase in the service layer,
  // but triggering file save/open dialogs requires the main process.
  const exportData = useCallback(async (options: { format: string; categories: string[] }) => {
    setExporting(true);
    try {
      const result = await globalThis.api?.exportData(options);
      return result?.success || false;
    } catch (e) {
      loggers.storage.error('Export failed', { error: e });
      return false;
    } finally {
      setExporting(false);
    }
  }, []);

  const importData = useCallback(
    async (category: string) => {
      setImporting(true);
      try {
        const result = await globalThis.api?.importData(category);
        if (result?.success && result.data) {
          setLastImportResult(result.data);
          // Refresh stats after import
          await loadStats();
          return result.data;
        }
        return null;
      } catch (e) {
        loggers.storage.error('Import failed', { error: e });
        return null;
      } finally {
        setImporting(false);
      }
    },
    [loadStats],
  );

  const clearLastImportResult = useCallback(() => {
    setLastImportResult(null);
  }, []);

  return {
    // State
    exporting,
    importing,
    stats,
    lastImportResult,
    // Actions
    loadStats,
    exportData,
    importData,
    clearLastImportResult,
  };
}
