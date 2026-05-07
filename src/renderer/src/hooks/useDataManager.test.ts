import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock dependencies
vi.mock('../utils/logger', () => ({
  loggers: {
    storage: {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

vi.mock('../services/pocketbase', () => ({
  getPb: vi.fn(),
}));

vi.mock('../services/importExportService', () => ({
  exportToJson: vi.fn(),
  exportToCsv: vi.fn(),
  exportToExcel: vi.fn(),
  importFromJson: vi.fn(),
  importFromCsv: vi.fn(),
  importFromExcel: vi.fn(),
}));

import { useDataManager } from './useDataManager';
import { getPb } from '../services/pocketbase';
import { exportToJson, exportToCsv, exportToExcel } from '../services/importExportService';
import { loggers } from '../utils/logger';

const mockedGetPb = vi.mocked(getPb);
const mockedExportToJson = vi.mocked(exportToJson);
const mockedExportToCsv = vi.mocked(exportToCsv);
const mockedExportToExcel = vi.mocked(exportToExcel);

function makeMockPb() {
  const getList = vi.fn().mockResolvedValue({ totalItems: 5 });
  return {
    collection: vi.fn(() => ({ getList })),
    _getList: getList,
  };
}

// Stub URL APIs for downloadBlob
globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock');
globalThis.URL.revokeObjectURL = vi.fn();

describe('useDataManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- loadStats ---

  it('loadStats fetches counts from collections', async () => {
    const mockPb = makeMockPb();
    mockedGetPb.mockReturnValue(mockPb as unknown as ReturnType<typeof getPb>);

    const { result } = renderHook(() => useDataManager());

    let stats: unknown;
    await act(async () => {
      stats = await result.current.loadStats();
    });

    expect(stats).toBeDefined();
    expect(mockPb.collection).toHaveBeenCalledWith('contacts');
    expect(mockPb.collection).toHaveBeenCalledWith('servers');
    expect(mockPb.collection).toHaveBeenCalledWith('bridge_groups');
    expect(mockPb.collection).toHaveBeenCalledWith('oncall');
    expect(mockPb.collection).toHaveBeenCalledWith('notes');
    expect(mockPb.collection).toHaveBeenCalledWith('alert_history');
  });

  it('loadStats handles per-collection errors gracefully', async () => {
    const getList = vi.fn().mockRejectedValue(new Error('not found'));
    const mockPb = { collection: vi.fn(() => ({ getList })) };
    mockedGetPb.mockReturnValue(mockPb as unknown as ReturnType<typeof getPb>);

    const { result } = renderHook(() => useDataManager());

    let stats: Record<string, unknown> | null | undefined;
    await act(async () => {
      stats = await result.current.loadStats();
    });

    // Should still return stats with zero counts (errors caught per-collection)
    expect(stats).toBeDefined();
    expect((stats as Record<string, { count: number }>)?.contacts?.count).toBe(0);
  });

  it('loadStats sets stats state after successful load', async () => {
    const mockPb = makeMockPb();
    mockedGetPb.mockReturnValue(mockPb as unknown as ReturnType<typeof getPb>);

    const { result } = renderHook(() => useDataManager());

    await act(async () => {
      await result.current.loadStats();
    });

    expect(result.current.stats).toBeDefined();
    expect(result.current.stats).not.toBeNull();
  });

  // --- exportData branches ---

  it('exportData with json format calls exportToJson', async () => {
    mockedExportToJson.mockResolvedValue('{"data":[]}');

    const { result } = renderHook(() => useDataManager());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.exportData({ format: 'json', category: 'contacts' });
    });

    expect(success).toBe(true);
    expect(mockedExportToJson).toHaveBeenCalledWith('contacts');
  });

  it('exportData with csv format and category=all exports all collections', async () => {
    mockedExportToCsv.mockResolvedValue('col1,col2\nval1,val2');

    const { result } = renderHook(() => useDataManager());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.exportData({ format: 'csv', category: 'all' });
    });

    expect(success).toBe(true);
    // Should call exportToCsv for each exportable collection.
    expect(mockedExportToCsv).toHaveBeenCalledTimes(8);
  });

  it('exportData with csv format and specific category', async () => {
    mockedExportToCsv.mockResolvedValue('col1\nval1');

    const { result } = renderHook(() => useDataManager());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.exportData({ format: 'csv', category: 'servers' });
    });

    expect(success).toBe(true);
    expect(mockedExportToCsv).toHaveBeenCalledWith('servers');
  });

  it('exportData with csv format skips empty csv for category=all', async () => {
    // Return empty string (falsy) - downloadBlob should not be called
    mockedExportToCsv.mockResolvedValue('');

    const { result } = renderHook(() => useDataManager());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.exportData({ format: 'csv', category: 'all' });
    });

    expect(success).toBe(true);
    // CSV was called for each exportable collection but downloadBlob skipped since csvStr is empty
    expect(mockedExportToCsv).toHaveBeenCalledTimes(8);
  });

  it('exportData with excel format calls exportToExcel', async () => {
    mockedExportToExcel.mockResolvedValue(new ArrayBuffer(10));

    const { result } = renderHook(() => useDataManager());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.exportData({ format: 'excel', category: 'contacts' });
    });

    expect(success).toBe(true);
    expect(mockedExportToExcel).toHaveBeenCalledWith('contacts');
  });

  it('exportData returns false on error', async () => {
    mockedExportToJson.mockRejectedValue(new Error('export failed'));

    const { result } = renderHook(() => useDataManager());

    let success: boolean | undefined;
    await act(async () => {
      success = await result.current.exportData({ format: 'json', category: 'contacts' });
    });

    expect(success).toBe(false);
    expect(loggers.storage.error).toHaveBeenCalled();
  });

  it('exportData sets exporting=true during export and false after', async () => {
    let resolveExport!: (v: string) => void;
    mockedExportToJson.mockReturnValue(
      new Promise((resolve) => {
        resolveExport = resolve;
      }),
    );

    const { result } = renderHook(() => useDataManager());

    let exportPromise: Promise<boolean>;
    act(() => {
      exportPromise = result.current.exportData({ format: 'json', category: 'contacts' });
    });

    // exporting should be true while in progress
    expect(result.current.exporting).toBe(true);

    await act(async () => {
      resolveExport('{}');
      await exportPromise!;
    });

    expect(result.current.exporting).toBe(false);
  });

  // --- importData ---

  it('importData returns null for category=all', async () => {
    const { result } = renderHook(() => useDataManager());

    let importResult: unknown;
    await act(async () => {
      importResult = await result.current.importData('all');
    });

    expect(importResult).toBeNull();
  });

  // --- clearLastImportResult ---

  it('clearLastImportResult resets lastImportResult to null', () => {
    const { result } = renderHook(() => useDataManager());

    act(() => {
      result.current.clearLastImportResult();
    });

    expect(result.current.lastImportResult).toBeNull();
  });

  // --- initial state ---

  it('returns correct initial state', () => {
    const { result } = renderHook(() => useDataManager());

    expect(result.current.exporting).toBe(false);
    expect(result.current.importing).toBe(false);
    expect(result.current.stats).toBeNull();
    expect(result.current.lastImportResult).toBeNull();
  });
});
