import { useState, useCallback } from 'react';
import type { ImportResult, DataStats, DataCategory, ExportFormat } from '@shared/ipc';
import { loggers } from '../utils/logger';
import { getPb } from '../services/pocketbase';
import { useMounted } from './useMounted';
import {
  exportToJson,
  exportToCsv,
  exportToExcel,
  importFromJson,
  importFromCsv,
  importFromExcel,
  type CollectionName,
} from '../services/importExportService';

/** Map UI data categories to PocketBase collection names. */
const CATEGORY_TO_COLLECTION: Record<Exclude<DataCategory, 'all'>, CollectionName> = {
  contacts: 'contacts',
  servers: 'servers',
  oncall: 'oncall',
  groups: 'bridge_groups',
  bridge_history: 'bridge_history',
  alert_history: 'alert_history',
  notes: 'notes',
  standalone_notes: 'standalone_notes',
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
    a.remove();
    URL.revokeObjectURL(url);
  }, 100);
}

/** Open a browser file picker and return the chosen file's content. */
function pickFile(
  accept: string,
): Promise<{ text: string; buffer: ArrayBuffer; name: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    let settled = false;
    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);

    function cleanup(): void {
      if (focusTimer) {
        clearTimeout(focusTimer);
        focusTimer = null;
      }
      globalThis.removeEventListener('focus', handleWindowFocus);
      input.removeEventListener('change', handleChange);
      input.removeEventListener('cancel', handleCancel);
      input.remove();
    }

    function resolveOnce(value: { text: string; buffer: ArrayBuffer; name: string } | null): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    }

    async function handleChange(): Promise<void> {
      const file = input.files?.[0];
      if (!file) {
        resolveOnce(null);
        return;
      }
      try {
        const [text, buffer] = await Promise.all([file.text(), file.arrayBuffer()]);
        resolveOnce({ text, buffer, name: file.name });
      } catch {
        resolveOnce(null);
      }
    }

    function handleCancel(): void {
      resolveOnce(null);
    }

    function handleWindowFocus(): void {
      focusTimer = setTimeout(() => {
        if (!input.files?.length) resolveOnce(null);
      }, 0);
    }

    input.addEventListener('change', handleChange);
    input.addEventListener('cancel', handleCancel);
    globalThis.addEventListener('focus', handleWindowFocus, { once: true });

    input.click();
  });
}

async function performExport(
  format: ExportFormat,
  category: DataCategory,
  collection: CollectionName | 'all',
  timestamp: string,
): Promise<void> {
  if (format === 'json') {
    const jsonStr = await exportToJson(collection);
    downloadBlob(
      new Blob([jsonStr], { type: 'application/json' }),
      `relay-${category}-${timestamp}.json`,
    );
    return;
  }

  if (format === 'csv') {
    if (category === 'all') {
      for (const [cat, col] of Object.entries(CATEGORY_TO_COLLECTION)) {
        const csvStr = await exportToCsv(col);
        if (csvStr)
          downloadBlob(new Blob([csvStr], { type: 'text/csv' }), `relay-${cat}-${timestamp}.csv`);
      }
      return;
    }
    const csvStr = await exportToCsv(collection as CollectionName);
    downloadBlob(new Blob([csvStr], { type: 'text/csv' }), `relay-${category}-${timestamp}.csv`);
    return;
  }

  if (format === 'excel') {
    const buffer = await exportToExcel(collection);
    downloadBlob(
      new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      `relay-${category}-${timestamp}.xlsx`,
    );
  }
}

export function useDataManager() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [stats, setStats] = useState<DataStats | null>(null);
  const [lastImportResult, setLastImportResult] = useState<ImportResult | null>(null);
  const mounted = useMounted();

  const loadStats = useCallback(async () => {
    try {
      const data: DataStats = {
        contacts: { count: 0, lastUpdated: 0 },
        servers: { count: 0, lastUpdated: 0 },
        groups: { count: 0, lastUpdated: 0 },
        oncall: { count: 0, lastUpdated: 0 },
        alert_history: { count: 0, lastUpdated: 0 },
        notes: { count: 0, lastUpdated: 0 },
      };
      const collectionToStat: Record<string, keyof DataStats> = {
        contacts: 'contacts',
        servers: 'servers',
        bridge_groups: 'groups',
        oncall: 'oncall',
        notes: 'notes',
      };
      for (const [collection, key] of Object.entries(collectionToStat)) {
        try {
          const result = await getPb().collection(collection).getList(1, 1);
          (data as Record<string, unknown>)[key] = { count: result.totalItems, lastUpdated: 0 };
        } catch {
          // Collection may not exist yet
        }
      }
      // Alert history: only count pinned alerts
      try {
        const pinned = await getPb()
          .collection('alert_history')
          .getList(1, 1, { filter: 'pinned = true' });
        data.alert_history = { count: pinned.totalItems, lastUpdated: 0 };
      } catch {
        // Collection may not exist yet
      }
      if (mounted.current) setStats(data);
      return data;
    } catch (e) {
      loggers.storage.error('Failed to load data stats', { error: e });
      return null;
    }
  }, [mounted]);

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
        const collection: CollectionName | 'all' =
          category === 'all' ? 'all' : CATEGORY_TO_COLLECTION[category];

        await performExport(format, category, collection, timestamp);
        return true;
      } catch (e) {
        loggers.storage.error('Export failed', { error: e });
        return false;
      } finally {
        if (mounted.current) setExporting(false);
      }
    },
    [mounted],
  );

  const importData = useCallback(
    async (category: DataCategory): Promise<ImportResult | null> => {
      if (category === 'all') {
        // Import requires a specific category
        return null;
      }

      setImporting(true);
      try {
        const accept = '.json,.csv,.xlsx';
        const file = await pickFile(accept);
        if (!file) {
          return null;
        }

        const collection = CATEGORY_TO_COLLECTION[category];
        let result: { imported: number; updated: number; errors: string[] };

        if (file.name.endsWith('.xlsx')) {
          result = await importFromExcel(collection, file.buffer);
        } else if (file.name.endsWith('.csv')) {
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
        if (mounted.current) setLastImportResult(importResult);
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
        if (mounted.current) setLastImportResult(errorResult);
        return errorResult;
      } finally {
        if (mounted.current) setImporting(false);
      }
    },
    [mounted],
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
