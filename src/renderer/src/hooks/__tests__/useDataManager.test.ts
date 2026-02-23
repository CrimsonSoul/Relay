import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDataManager } from '../useDataManager';

const { storageError } = vi.hoisted(() => ({
  storageError: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  loggers: {
    storage: {
      error: storageError,
      info: vi.fn(),
      warn: vi.fn(),
    },
  },
}));

describe('useDataManager', () => {
  const api = {
    getDataStats: vi.fn(),
    exportData: vi.fn(),
    importData: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Window & { api?: typeof api }).api = api;
  });

  it('loads stats successfully and handles load failures', async () => {
    api.getDataStats.mockResolvedValueOnce({
      contacts: { count: 1, lastUpdated: 1 },
      servers: { count: 2, lastUpdated: 2 },
      oncall: { count: 3, lastUpdated: 3 },
      groups: { count: 4, lastUpdated: 4 },
    });

    const { result } = renderHook(() => useDataManager());

    await act(async () => {
      await result.current.loadStats();
    });
    expect(result.current.stats?.contacts.count).toBe(1);

    api.getDataStats.mockRejectedValueOnce(new Error('fail'));
    await act(async () => {
      const loaded = await result.current.loadStats();
      expect(loaded).toBeNull();
    });
    expect(storageError).toHaveBeenCalled();
  });

  it('exports data and tracks export state', async () => {
    api.exportData
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false });

    const { result } = renderHook(() => useDataManager());

    let ok = false;
    await act(async () => {
      ok = await result.current.exportData({
        format: 'json',
        category: 'all',
        includeMetadata: true,
      });
    });
    expect(ok).toBe(true);
    expect(result.current.exporting).toBe(false);

    let bad = true;
    await act(async () => {
      bad = await result.current.exportData({
        format: 'csv',
        category: 'servers',
        includeMetadata: false,
      });
    });
    expect(bad).toBe(false);

    api.exportData.mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      const failed = await result.current.exportData({
        format: 'json',
        category: 'contacts',
        includeMetadata: false,
      });
      expect(failed).toBe(false);
    });
  });

  it('imports data, stores last result, and can clear it', async () => {
    api.getDataStats.mockResolvedValue({
      contacts: { count: 10, lastUpdated: 1 },
      servers: { count: 1, lastUpdated: 1 },
      oncall: { count: 2, lastUpdated: 1 },
      groups: { count: 3, lastUpdated: 1 },
    });
    api.importData.mockResolvedValueOnce({
      success: true,
      data: {
        success: true,
        imported: 2,
        updated: 1,
        skipped: 0,
        errors: [],
      },
    });

    const { result } = renderHook(() => useDataManager());

    await act(async () => {
      const imported = await result.current.importData('contacts');
      expect(imported?.imported).toBe(2);
    });

    expect(result.current.lastImportResult?.updated).toBe(1);
    expect(result.current.stats?.contacts.count).toBe(10);

    await act(async () => {
      result.current.clearLastImportResult();
    });
    expect(result.current.lastImportResult).toBeNull();
  });

  it('returns null when import fails or throws', async () => {
    api.importData
      .mockResolvedValueOnce({ success: false, data: null })
      .mockRejectedValueOnce(new Error('x'));

    const { result } = renderHook(() => useDataManager());

    await act(async () => {
      const imported = await result.current.importData('servers');
      expect(imported).toBeNull();
    });

    await act(async () => {
      const imported = await result.current.importData('servers');
      expect(imported).toBeNull();
    });
    expect(storageError).toHaveBeenCalled();
  });
});
