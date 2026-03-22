import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { useBridgeHistory } from '../useBridgeHistory';
import { NoopToastProvider } from '../../components/Toast';

vi.mock('../../utils/logger', () => ({
  loggers: {
    app: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  },
}));

// Mock useCollection
const mockRefetch = vi.fn();
const mockCollectionData = { current: [] as unknown[] };
vi.mock('../useCollection', () => ({
  useCollection: () => ({
    data: mockCollectionData.current,
    loading: false,
    error: null,
    refetch: mockRefetch,
  }),
}));

// Mock PocketBase bridge history service
const mockAddBridgeHistory = vi.fn();
const mockDeleteBridgeHistory = vi.fn();
const mockClearBridgeHistory = vi.fn();
vi.mock('../../services/bridgeHistoryService', () => ({
  addBridgeHistory: (...args: unknown[]) => mockAddBridgeHistory(...args),
  deleteBridgeHistory: (...args: unknown[]) => mockDeleteBridgeHistory(...args),
  clearBridgeHistory: (...args: unknown[]) => mockClearBridgeHistory(...args),
}));

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(NoopToastProvider, null, children);

const makeRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'h1',
  note: 'First bridge',
  groups: ['Network'],
  contacts: ['a@test.com', 'b@test.com'],
  recipientCount: 2,
  created: '2026-01-01T00:00:01Z',
  updated: '2026-01-01T00:00:01Z',
  ...overrides,
});

describe('useBridgeHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollectionData.current = [
      makeRecord({ id: 'h1', created: '2026-01-01T00:00:01Z' }),
      makeRecord({
        id: 'h2',
        note: '',
        groups: [],
        contacts: ['c@test.com'],
        recipientCount: 1,
        created: '2026-01-01T00:00:02Z',
      }),
    ];
  });

  it('loads history from useCollection', () => {
    const { result } = renderHook(() => useBridgeHistory(), { wrapper });

    expect(result.current.history).toHaveLength(2);
    expect(result.current.history[0].id).toBe('h1');
    expect(result.current.loading).toBe(false);
  });

  it('returns empty array when no records', () => {
    mockCollectionData.current = [];
    const { result } = renderHook(() => useBridgeHistory(), { wrapper });
    expect(result.current.history).toEqual([]);
  });

  it('adds a history entry via PocketBase service', async () => {
    const newRecord = makeRecord({
      id: 'h3',
      note: 'New bridge',
      groups: ['Database'],
      contacts: ['d@test.com'],
      recipientCount: 1,
      created: '2026-01-01T00:00:03Z',
    });
    mockAddBridgeHistory.mockResolvedValue(newRecord);

    const { result } = renderHook(() => useBridgeHistory(), { wrapper });

    let returned: unknown = null;
    await act(async () => {
      returned = await result.current.addHistory({
        note: 'New bridge',
        groups: ['Database'],
        contacts: ['d@test.com'],
        recipientCount: 1,
      });
    });

    expect(returned).not.toBeNull();
    expect(mockAddBridgeHistory).toHaveBeenCalled();
  });

  it('handles addHistory failure and returns null', async () => {
    mockAddBridgeHistory.mockRejectedValue(new Error('write failed'));

    const { result } = renderHook(() => useBridgeHistory(), { wrapper });

    let returned: unknown = 'not-null';
    await act(async () => {
      returned = await result.current.addHistory({
        note: 'bad write',
        groups: [],
        contacts: ['d@test.com'],
        recipientCount: 1,
      });
    });

    expect(returned).toBeNull();
  });

  it('deletes a history entry via PocketBase service', async () => {
    mockDeleteBridgeHistory.mockResolvedValue(undefined);

    const { result } = renderHook(() => useBridgeHistory(), { wrapper });

    let success = false;
    await act(async () => {
      success = await result.current.deleteHistory('h1');
    });

    expect(success).toBe(true);
    expect(mockDeleteBridgeHistory).toHaveBeenCalledWith('h1');
  });

  it('handles deleteHistory failure', async () => {
    mockDeleteBridgeHistory.mockRejectedValue(new Error('delete failed'));

    const { result } = renderHook(() => useBridgeHistory(), { wrapper });

    let success = true;
    await act(async () => {
      success = await result.current.deleteHistory('h1');
    });

    expect(success).toBe(false);
  });

  it('clears all history via PocketBase service', async () => {
    mockClearBridgeHistory.mockResolvedValue(undefined);

    const { result } = renderHook(() => useBridgeHistory(), { wrapper });

    let success = false;
    await act(async () => {
      success = await result.current.clearHistory();
    });

    expect(success).toBe(true);
    expect(mockClearBridgeHistory).toHaveBeenCalled();
  });

  it('handles clearHistory failure', async () => {
    mockClearBridgeHistory.mockRejectedValue(new Error('clear failed'));

    const { result } = renderHook(() => useBridgeHistory(), { wrapper });

    let success = true;
    await act(async () => {
      success = await result.current.clearHistory();
    });

    expect(success).toBe(false);
  });
});
