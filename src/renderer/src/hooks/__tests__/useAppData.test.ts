import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAppData } from '../useAppData';
import { AppData, DataError } from '@shared/ipc';

// Mock data
const mockInitialData: AppData = {
  groups: [],
  contacts: [],
  servers: [],
  onCall: [],
  lastUpdated: 1000
};

const mockUpdateData: AppData = {
  groups: [{ id: '1', name: 'Group 1', contacts: [] }],
  contacts: [],
  servers: [],
  onCall: [],
  lastUpdated: 2000
};

describe('useAppData', () => {
  const showToast = vi.fn();
  
  // Mock window.api
  const mockApi = {
    getInitialData: vi.fn(),
    subscribeToData: vi.fn(),
    onReloadStart: vi.fn(),
    onReloadComplete: vi.fn(),
    onDataError: vi.fn(),
    reloadData: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // @ts-ignore
    window.api = mockApi;
    
    mockApi.getInitialData.mockResolvedValue(mockInitialData);
    mockApi.subscribeToData.mockReturnValue(vi.fn()); // Returns unsubscribe
    mockApi.onReloadStart.mockReturnValue(vi.fn());
    mockApi.onReloadComplete.mockReturnValue(vi.fn());
    mockApi.onDataError.mockReturnValue(vi.fn());
  });

  it('fetches initial data on mount', async () => {
    const { result } = renderHook(() => useAppData(showToast));
    
    await waitFor(() => {
      expect(result.current.data).toEqual(mockInitialData);
    });
  });

  it('updates data when subscription fires', async () => {
    let dataCallback: (data: AppData) => void = () => {};
    mockApi.subscribeToData.mockImplementation((cb: (data: AppData) => void) => {
      dataCallback = cb;
      return vi.fn();
    });

    const { result } = renderHook(() => useAppData(showToast));
    
    // Wait for initial load
    await waitFor(() => expect(result.current.data).toEqual(mockInitialData));

    await act(async () => {
      dataCallback(mockUpdateData);
    });

    expect(result.current.data).toEqual(mockUpdateData);
  });

  it('handles reload lifecycle', async () => {
    let startCallback: () => void = () => {};
    let completeCallback: (success: boolean) => void = () => {};

    mockApi.onReloadStart.mockImplementation((cb: () => void) => {
      startCallback = cb;
      return vi.fn();
    });
    mockApi.onReloadComplete.mockImplementation((cb: (s: boolean) => void) => {
      completeCallback = cb;
      return vi.fn();
    });

    const { result } = renderHook(() => useAppData(showToast));

    // Wait for initial load
    await waitFor(() => expect(result.current.data).toEqual(mockInitialData));

    await act(async () => {
      startCallback();
    });
    expect(result.current.isReloading).toBe(true);

    await act(async () => {
      completeCallback(true);
    });
    
    // Should still be true due to minimum duration
    expect(result.current.isReloading).toBe(true);

    // Wait for minimum duration (900ms)
    await waitFor(() => {
      expect(result.current.isReloading).toBe(false);
    }, { timeout: 2000 });
  });

  it('handles data errors and shows toast', async () => {
    let errorCallback: (error: DataError) => void = () => {};
    mockApi.onDataError.mockImplementation((cb: (error: DataError) => void) => {
      errorCallback = cb;
      return vi.fn();
    });

    renderHook(() => useAppData(showToast));

    const mockError: DataError = {
      type: 'validation',
      message: 'Invalid data',
      file: 'contacts.json'
    };

    act(() => {
      errorCallback(mockError);
    });

    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Invalid data'), 'error');
  });

  it('force clears stuck sync indicator after timeout', async () => {
    // We'll use a shorter timeout for testing if we could, but here it's 5s.
    // Let's use fake timers JUST for this test and advance them.
    vi.useFakeTimers();
    let startCallback: () => void = () => {};
    mockApi.onReloadStart.mockImplementation((cb: () => void) => {
      startCallback = cb;
      return vi.fn();
    });

    const { result } = renderHook(() => useAppData(showToast));

    act(() => {
      startCallback();
    });
    expect(result.current.isReloading).toBe(true);

    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(result.current.isReloading).toBe(false);
    vi.useRealTimers();
  });

  it('calls reloadData when handleSync is triggered', async () => {
    const { result } = renderHook(() => useAppData(showToast));

    await act(async () => {
      await result.current.handleSync();
    });

    expect(mockApi.reloadData).toHaveBeenCalled();
  });
});
