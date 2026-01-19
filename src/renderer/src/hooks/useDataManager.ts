import { useState, useCallback } from "react";
import type {
  ExportOptions,
  ImportResult,
  DataCategory,
  DataStats,
  MigrationResult,
} from "@shared/ipc";

export function useDataManager() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [stats, setStats] = useState<DataStats | null>(null);
  const [lastImportResult, setLastImportResult] = useState<ImportResult | null>(null);
  const [lastMigrationResult, setLastMigrationResult] = useState<MigrationResult | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const data = await window.api?.getDataStats();
      if (data) {
        setStats(data);
      }
      return data;
    } catch (e) {
      console.error("Failed to load data stats:", e);
      return null;
    }
  }, []);

  const exportData = useCallback(async (options: ExportOptions) => {
    setExporting(true);
    try {
      const result = await window.api?.exportData(options);
      return result?.success || false;
    } catch (e) {
      console.error("Export failed:", e);
      return false;
    } finally {
      setExporting(false);
    }
  }, []);

  const importData = useCallback(async (category: DataCategory) => {
    setImporting(true);
    try {
      const result = await window.api?.importData(category);
      if (result?.success && result.data) {
        setLastImportResult(result.data);
        // Refresh stats after import
        await loadStats();
        return result.data;
      }
      return null;
    } catch (e) {
      console.error("Import failed:", e);
      return null;
    } finally {
      setImporting(false);
    }
  }, [loadStats]);

  const migrateFromCsv = useCallback(async () => {
    setMigrating(true);
    try {
      const result = await window.api?.migrateFromCsv();
      if (result?.success && result.data) {
        setLastMigrationResult(result.data);
        // Refresh stats after migration
        await loadStats();
        return result.data;
      }
      return null;
    } catch (e) {
      console.error("Migration failed:", e);
      return null;
    } finally {
      setMigrating(false);
    }
  }, [loadStats]);

  const clearLastImportResult = useCallback(() => {
    setLastImportResult(null);
  }, []);

  const clearLastMigrationResult = useCallback(() => {
    setLastMigrationResult(null);
  }, []);

  return {
    // State
    exporting,
    importing,
    migrating,
    stats,
    lastImportResult,
    lastMigrationResult,
    // Actions
    loadStats,
    exportData,
    importData,
    migrateFromCsv,
    clearLastImportResult,
    clearLastMigrationResult,
  };
}
