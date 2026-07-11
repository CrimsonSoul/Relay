import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePendingSyncStatus } from '../usePendingSyncStatus';

describe('usePendingSyncStatus', () => {
  const getPendingSyncStatus = vi.fn();
  let listener: ((status: { pendingCount: number }) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    listener = null;
    getPendingSyncStatus.mockResolvedValue({ pendingCount: 2 });
    (globalThis as Record<string, unknown>).api = {
      getPendingSyncStatus,
      onPendingSyncStatusChanged: (callback: typeof listener) => {
        listener = callback;
        return () => {
          listener = null;
        };
      },
    };
  });

  it('loads the durable count and reacts to sync events without polling', async () => {
    const { result } = renderHook(() => usePendingSyncStatus());

    await waitFor(() => expect(result.current).toEqual({ pendingCount: 2 }));
    act(() => listener?.({ pendingCount: 1, issueCount: 1, lastError: 'Server conflict' }));

    expect(result.current).toEqual({
      pendingCount: 1,
      issueCount: 1,
      lastError: 'Server conflict',
    });
    expect(getPendingSyncStatus).toHaveBeenCalledTimes(1);
  });
});
