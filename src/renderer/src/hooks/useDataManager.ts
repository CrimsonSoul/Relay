import { useState, useCallback } from 'react';
import type { ImportResult, DataStats, DataCategory, ExportFormat } from '@shared/ipc';
import { loggers } from '../utils/logger';
import { getPb } from '../services/pocketbase';
import {
  exportToJson,
  exportToCsv,
  importFromJson,
  importFromCsv,
  type CollectionName,
} from '../services/importExportService';

/** Map UI data categories to PocketBase collection names. */
const CATEGORY_TO_COLLECTION: Record<Exclude<DataCategory, 'all'>, CollectionName> = {
  contacts: 'contacts',
  servers: 'servers',
  oncall: 'oncall',
  groups: 'bridge_groups',
};

/** Trigger a browser file download from in-memory data. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  // Clean up
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/** Open a browser file picker and return the chosen file's text content. */
function pickFile(accept: string): Promise<{ text: string; name: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (!file) {
        resolve(null);
        return;
      }
      try {
        const text = await file.text();
        resolve({ text, name: file.name });
      } catch {
        resolve(null);
      }
    });

    // Handle cancel (input won't fire change)
    input.addEventListener('cancel', () => {
      document.body.removeChild(input);
      resolve(null);
    });

    input.click();
  });
}

export function useDataManager() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [stats, setStats] = useState<DataStats | null>(null);
  const [lastImportResult, setLastImportResult] = useState<ImportResult | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const data: DataStats = {
        contacts: { count: 0, lastUpdated: 0 },
        servers: { count: 0, lastUpdated: 0 },
        groups: { count: 0, lastUpdated: 0 },
        oncall: { count: 0, lastUpdated: 0 },
      };
      const collectionToStat: Record<string, keyof DataStats> = {
        contacts: 'contacts',
        servers: 'servers',
        bridge_groups: 'groups',
        oncall: 'oncall',
      };
      for (const [collection, key] of Object.entries(collectionToStat)) {
        try {
          const result = await getPb().collection(collection).getList(1, 1);
          (data as Record<string, unknown>)[key] = { count: result.totalItems, lastUpdated: 0 };
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

  const exportData = useCallback(
    async (options: {
      format: ExportFormat;
      category: DataCategory;
      includeMetadata?: boolean;
    }) => {
      setExporting(true);
      try {
        const { format, category } = options;
        const timestamp = new Date().toISOString().slice(0, 10);

        if (format === 'json') {
          const collection: CollectionName | 'all' =
            category === 'all' ? 'all' : CATEGORY_TO_COLLECTION[category];
          const jsonStr = await exportToJson(collection);
          const blob = new Blob([jsonStr], { type: 'application/json' });
          downloadBlob(blob, `relay-${category}-${timestamp}.json`);
          return true;
        }

        if (format === 'csv') {
          if (category === 'all') {
            // CSV doesn't support multi-collection; export each separately
            for (const [cat, col] of Object.entries(CATEGORY_TO_COLLECTION)) {
              const csvStr = await exportToCsv(col);
              if (csvStr) {
                const blob = new Blob([csvStr], { type: 'text/csv' });
                downloadBlob(blob, `relay-${cat}-${timestamp}.csv`);
              }
            }
            return true;
          }
          const collection = CATEGORY_TO_COLLECTION[category];
          const csvStr = await exportToCsv(collection);
          const blob = new Blob([csvStr], { type: 'text/csv' });
          downloadBlob(blob, `relay-${category}-${timestamp}.csv`);
          return true;
        }

        return false;
      } catch (e) {
        loggers.storage.error('Export failed', { error: e });
        return false;
      } finally {
        setExporting(false);
      }
    },
    [],
  );

  const importData = useCallback(async (category: DataCategory): Promise<ImportResult | null> => {
    if (category === 'all') {
      // Import requires a specific category
      return null;
    }

    setImporting(true);
    try {
      const accept = '.json,.csv';
      const file = await pickFile(accept);
      if (!file) {
        return null;
      }

      const collection = CATEGORY_TO_COLLECTION[category];
      let result: { imported: number; updated: number; errors: string[] };

      if (file.name.endsWith('.csv')) {
        result = await importFromCsv(collection, file.text);
      } else {
        // Default to JSON
        result = await importFromJson(collection, file.text);
      }

      const importResult: ImportResult = {
        success: result.errors.length === 0,
        imported: result.imported,
        updated: result.updated,
        skipped: 0,
        errors: result.errors,
      };
      setLastImportResult(importResult);
      return importResult;
    } catch (e) {
      loggers.storage.error('Import failed', { error: e });
      const errorResult: ImportResult = {
        success: false,
        imported: 0,
        updated: 0,
        skipped: 0,
        errors: [e instanceof Error ? e.message : String(e)],
      };
      setLastImportResult(errorResult);
      return errorResult;
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
