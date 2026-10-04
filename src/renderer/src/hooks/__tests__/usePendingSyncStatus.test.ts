import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePendingSyncStatus } from '../usePendingSyncStatus';
import type { PendingSyncStatus } from '@shared/ipc';

describe('usePendingSyncStatus', () => {
  const getPendingSyncStatus = vi.fn();
  let listener: ((status: PendingSyncStatus) => void) | null = null;

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

  it('keeps a pushed status when the slower initial read resolves afterwards', async () => {
    let resolve!: (status: PendingSyncStatus) => void;
    const promise = new Promise<PendingSyncStatus>((settle) => {
      resolve = settle;
    });
    getPendingSyncStatus.mockReturnValueOnce(promise);
    const { result } = renderHook(() => usePendingSyncStatus());

    act(() => listener?.({ pendingCount: 0 }));
    await act(async () => {
      resolve({ pendingCount: 5 });
      await promise;
    });

    expect(result.current).toEqual({ pendingCount: 0 });
  });
});
