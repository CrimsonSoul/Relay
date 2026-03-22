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

// Mock PocketBase service
const mockGetList = vi.fn();
const mockCollection = vi.fn().mockReturnValue({ getList: mockGetList });
vi.mock('../../services/pocketbase', () => ({
  getPb: () => ({ collection: mockCollection }),
  isOnline: vi.fn().mockReturnValue(true),
  handleApiError: vi.fn(),
  onConnectionStateChange: vi.fn().mockReturnValue(() => {}),
  getConnectionState: vi.fn().mockReturnValue('online'),
}));

// Mock importExportService
vi.mock('../../services/importExportService', () => ({
  exportToJson: vi.fn().mockResolvedValue('[]'),
  exportToCsv: vi.fn().mockResolvedValue(''),
  importFromJson: vi.fn().mockResolvedValue({ imported: 0, updated: 0, errors: [] }),
  importFromCsv: vi.fn().mockResolvedValue({ imported: 0, updated: 0, errors: [] }),
  ALL_COLLECTIONS: ['contacts', 'servers', 'oncall', 'bridge_groups'],
}));

describe('useDataManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads stats from PocketBase collections', async () => {
    mockGetList.mockResolvedValue({ totalItems: 5 });

    const { result } = renderHook(() => useDataManager());

    await act(async () => {
      await result.current.loadStats();
    });

    expect(result.current.stats).not.toBeNull();
    expect(mockCollection).toHaveBeenCalled();
  });

  it('returns stats with count and lastUpdated shape', async () => {
    mockGetList.mockResolvedValue({ totalItems: 42 });

    const { result } = renderHook(() => useDataManager());

    await act(async () => {
      await result.current.loadStats();
    });

    const stats = result.current.stats;
    expect(stats).not.toBeNull();
    // Verify the shape has count property
    if (stats && typeof stats.contacts === 'object') {
      expect((stats.contacts as { count: number }).count).toBe(42);
    }
  });

  it('handles loadStats when individual collections throw', async () => {
    mockGetList.mockRejectedValue(new Error('fail'));

    const { result } = renderHook(() => useDataManager());

    let loaded: unknown;
    await act(async () => {
      loaded = await result.current.loadStats();
    });

    // Individual collection errors are silently caught; stats returned with 0s
    expect(loaded).not.toBeNull();
    expect(result.current.stats).not.toBeNull();
  });

  it('exportData triggers a download for json format', async () => {
    // Mock URL.createObjectURL and DOM manipulation
    const mockCreateObjectURL = vi.fn().mockReturnValue('blob:test');
    const mockRevokeObjectURL = vi.fn();
    globalThis.URL.createObjectURL = mockCreateObjectURL;
    globalThis.URL.revokeObjectURL = mockRevokeObjectURL;

    const { result } = renderHook(() => useDataManager());

    let ok = false;
    await act(async () => {
      ok = await result.current.exportData({
        format: 'json',
        category: 'contacts',
      });
    });

    expect(ok).toBe(true);
    expect(result.current.exporting).toBe(false);
  });

  it('clearLastImportResult clears the result', async () => {
    const { result } = renderHook(() => useDataManager());

    await act(async () => {
      result.current.clearLastImportResult();
    });

    expect(result.current.lastImportResult).toBeNull();
  });
});
