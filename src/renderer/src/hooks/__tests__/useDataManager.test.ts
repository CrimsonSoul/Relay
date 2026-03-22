import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDataManager } from '../useDataManager';

const { storageError, storageWarn } = vi.hoisted(() => ({
  storageError: vi.fn(),
  storageWarn: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  loggers: {
    storage: {
      error: storageError,
      info: vi.fn(),
      warn: storageWarn,
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

  it('handles loadStats when individual collections throw', async () => {
    // When individual collections throw, they are caught inside the inner try
    // and result in 0 counts — the outer function still returns data
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

  it('exportData returns false (IPC no longer available)', async () => {
    const { result } = renderHook(() => useDataManager());

    let ok = true;
    await act(async () => {
      ok = await result.current.exportData({
        format: 'json',
        categories: ['all'],
      });
    });

    expect(ok).toBe(false);
    expect(result.current.exporting).toBe(false);
  });

  it('importData returns null (IPC no longer available)', async () => {
    const { result } = renderHook(() => useDataManager());

    let imported: unknown = 'not-null';
    await act(async () => {
      imported = await result.current.importData('contacts');
    });

    expect(imported).toBeNull();
  });

  it('clearLastImportResult clears the result', async () => {
    const { result } = renderHook(() => useDataManager());

    await act(async () => {
      result.current.clearLastImportResult();
    });

    expect(result.current.lastImportResult).toBeNull();
  });
});
