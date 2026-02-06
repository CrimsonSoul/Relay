import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { useBridgeHistory } from '../useBridgeHistory';
import { NoopToastProvider } from '../../components/Toast';
import type { BridgeHistoryEntry } from '@shared/ipc';

// Mock logger
vi.mock('../../utils/logger', () => ({
  loggers: {
    app: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  },
}));

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(NoopToastProvider, null, children);

describe('useBridgeHistory', () => {
  const mockHistory: BridgeHistoryEntry[] = [
    {
      id: 'h1',
      timestamp: 1000,
      note: 'First bridge',
      groups: ['Network'],
      contacts: ['a@test.com', 'b@test.com'],
      recipientCount: 2,
    },
    {
      id: 'h2',
      timestamp: 2000,
      note: '',
      groups: [],
      contacts: ['c@test.com'],
      recipientCount: 1,
    },
  ];

  const mockApi = {
    getBridgeHistory: vi.fn(),
    addBridgeHistory: vi.fn(),
    deleteBridgeHistory: vi.fn(),
    clearBridgeHistory: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (window as Window & { api: typeof mockApi }).api = mockApi as Window['api'];
    mockApi.getBridgeHistory.mockResolvedValue(mockHistory);
  });

  it('loads history on mount', async () => {
    const { result } = renderHook(() => useBridgeHistory(), { wrapper });

    await waitFor(() => {
      expect(result.current.history).toEqual(mockHistory);
      expect(result.current.loading).toBe(false);
    });
  });

  it('returns empty array when API returns null', async () => {
    mockApi.getBridgeHistory.mockResolvedValue(null);

    const { result } = renderHook(() => useBridgeHistory(), { wrapper });

    await waitFor(() => {
      expect(result.current.history).toEqual([]);
    });
  });

  it('adds a history entry and prepends to state', async () => {
    const newEntry: BridgeHistoryEntry = {
      id: 'h3',
      timestamp: 3000,
      note: 'New bridge',
      groups: ['Database'],
      contacts: ['d@test.com'],
      recipientCount: 1,
    };
    mockApi.addBridgeHistory.mockResolvedValue(newEntry);

    const { result } = renderHook(() => useBridgeHistory(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addHistory({
        note: 'New bridge',
        groups: ['Database'],
        contacts: ['d@test.com'],
        recipientCount: 1,
      });
    });

    expect(result.current.history).toHaveLength(3);
    expect(result.current.history[0]).toEqual(newEntry); // Prepended
  });

  it('handles add history failure', async () => {
    mockApi.addBridgeHistory.mockResolvedValue(null);

    const { result } = renderHook(() => useBridgeHistory(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addHistory({
        note: '',
        groups: [],
        contacts: ['d@test.com'],
        recipientCount: 1,
      });
    });

    expect(result.current.history).toHaveLength(2); // No new entry
  });

  it('deletes a history entry from state', async () => {
    mockApi.deleteBridgeHistory.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useBridgeHistory(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteHistory('h1');
    });

    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0].id).toBe('h2');
  });

  it('does not delete on API failure', async () => {
    mockApi.deleteBridgeHistory.mockResolvedValue(false);

    const { result } = renderHook(() => useBridgeHistory(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteHistory('h1');
    });

    expect(result.current.history).toHaveLength(2);
  });

  it('clears all history', async () => {
    mockApi.clearBridgeHistory.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useBridgeHistory(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.clearHistory();
    });

    expect(result.current.history).toEqual([]);
  });

  it('does not clear on API failure', async () => {
    mockApi.clearBridgeHistory.mockResolvedValue(false);

    const { result } = renderHook(() => useBridgeHistory(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.clearHistory();
    });

    expect(result.current.history).toHaveLength(2);
  });

  it('handles exception during loadHistory', async () => {
    mockApi.getBridgeHistory.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useBridgeHistory(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should fall back to empty array and not crash
    expect(result.current.history).toEqual([]);
  });
});
