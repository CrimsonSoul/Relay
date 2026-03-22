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
      const data: DataStats = { contacts: 0, servers: 0, groups: 0, oncall: 0 };
      const collectionToStat: Record<string, keyof DataStats> = {
        contacts: 'contacts',
        servers: 'servers',
        bridge_groups: 'groups',
        oncall: 'oncall',
      };
      for (const [collection, key] of Object.entries(collectionToStat)) {
        try {
          const result = await getPb().collection(collection).getList(1, 1);
          (data as Record<string, unknown>)[key] = result.totalItems;
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

  // Export and import operations are now handled through PocketBase services.
  // Native file dialogs for export/import would need to be re-implemented
  // as PocketBase-aware IPC handlers if needed in the future.
  const exportData = useCallback(async (_options: { format: string; categories: string[] }) => {
    setExporting(true);
    try {
      loggers.storage.warn('Export via IPC is no longer available — use PocketBase export');
      return false;
    } finally {
      setExporting(false);
    }
  }, []);

  const importData = useCallback(async (_category: string) => {
    setImporting(true);
    try {
      loggers.storage.warn('Import via IPC is no longer available — use PocketBase import');
      return null;
    } finally {
      setImporting(false);
    }
  }, []);

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
