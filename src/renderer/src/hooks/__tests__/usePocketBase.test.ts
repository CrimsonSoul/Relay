import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockInitPocketBase = vi.fn();
const mockAuthenticate = vi.fn();
const mockStopHealthCheck = vi.fn();
let capturedStateListener: ((state: string) => void) | null = null;
const mockUnsubscribe = vi.fn();

vi.mock('../../services/pocketbase', () => ({
  initPocketBase: (...args: unknown[]) => mockInitPocketBase(...args),
  authenticate: (...args: unknown[]) => mockAuthenticate(...args),
  stopHealthCheck: (...args: unknown[]) => mockStopHealthCheck(...args),
  onConnectionStateChange: (listener: (state: string) => void) => {
    capturedStateListener = listener;
    return mockUnsubscribe;
  },
  AUTH_TIMEOUT_MS: 15_000,
}));

import { usePocketBase, CONNECTION_TIMEOUT_MS } from '../usePocketBase';

describe('usePocketBase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    capturedStateListener = null;
    mockAuthenticate.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns connecting state initially', () => {
    const { result } = renderHook(() => usePocketBase(null, null));

    expect(result.current.connectionState).toBe('connecting');
    expect(result.current.error).toBeNull();
  });

  it('does not init or authenticate when url is null', () => {
    renderHook(() => usePocketBase(null, 'secret'));

    expect(mockInitPocketBase).not.toHaveBeenCalled();
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('does not init or authenticate when secret is null', () => {
    renderHook(() => usePocketBase('http://localhost:8090', null));

    expect(mockInitPocketBase).not.toHaveBeenCalled();
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('calls initPocketBase and authenticate with correct arguments', async () => {
    renderHook(() => usePocketBase('http://localhost:8090', 'my-secret'));

    expect(mockInitPocketBase).toHaveBeenCalledWith('http://localhost:8090');
    expect(mockAuthenticate).toHaveBeenCalledWith('my-secret');
  });

  it('subscribes to connection state changes', () => {
    renderHook(() => usePocketBase('http://localhost:8090', 'secret'));

    expect(capturedStateListener).toBeTruthy();
  });

  it('updates connectionState when listener fires', async () => {
    const { result } = renderHook(() => usePocketBase('http://localhost:8090', 'secret'));

    // Simulate state change
    act(() => {
      capturedStateListener?.('online');
    });

    expect(result.current.connectionState).toBe('online');
  });

  it('sets error when authentication fails', async () => {
    mockAuthenticate.mockResolvedValue(false);

    const { result } = renderHook(() => usePocketBase('http://localhost:8090', 'bad-secret'));

    // Wait for the authenticate promise to resolve
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.error).toBe('Authentication failed. Check your passphrase.');
  });

  it('does not set error when authentication succeeds', async () => {
    mockAuthenticate.mockResolvedValue(true);

    const { result } = renderHook(() => usePocketBase('http://localhost:8090', 'good-secret'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.error).toBeNull();
  });

  it('calls unsubscribe and stopHealthCheck on unmount', () => {
    const { unmount } = renderHook(() => usePocketBase('http://localhost:8090', 'secret'));

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(mockStopHealthCheck).toHaveBeenCalled();
  });

  it('does not call cleanup when url/secret are null (no effect ran)', () => {
    const { unmount } = renderHook(() => usePocketBase(null, null));

    unmount();

    expect(mockUnsubscribe).not.toHaveBeenCalled();
    expect(mockStopHealthCheck).not.toHaveBeenCalled();
  });

  it('re-initializes when url changes', async () => {
    const { rerender } = renderHook(
      ({ url, secret }: { url: string; secret: string }) => usePocketBase(url, secret),
      // eslint-disable-next-line sonarjs/no-clear-text-protocols
      { initialProps: { url: 'http://host1:8090', secret: 's' } },
    );

    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    expect(mockInitPocketBase).toHaveBeenCalledWith('http://host1:8090');

    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    rerender({ url: 'http://host2:8090', secret: 's' });

    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    expect(mockInitPocketBase).toHaveBeenCalledWith('http://host2:8090');
    // Cleanup from previous effect should have fired
    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(mockStopHealthCheck).toHaveBeenCalled();
  });

  it('re-authenticates when secret changes', () => {
    const { rerender } = renderHook(
      ({ url, secret }: { url: string; secret: string }) => usePocketBase(url, secret),
      { initialProps: { url: 'http://localhost:8090', secret: 'first' } },
    );

    expect(mockAuthenticate).toHaveBeenCalledWith('first');

    rerender({ url: 'http://localhost:8090', secret: 'second' });

    expect(mockAuthenticate).toHaveBeenCalledWith('second');
  });

  // ── Connection timeout ──

  it('sets timeout error when authenticate hangs beyond CONNECTION_TIMEOUT_MS', async () => {
    // authenticate never resolves
    mockAuthenticate.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => usePocketBase('http://localhost:8090', 'secret'));

    // Before timeout — no error
    expect(result.current.error).toBeNull();

    // Advance past the timeout
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONNECTION_TIMEOUT_MS + 1);
    });

    expect(result.current.error).toBe('Connection timed out. The server may be unreachable.');
  });

  it('clears connection timeout when authenticate resolves successfully', async () => {
    mockAuthenticate.mockResolvedValue(true);

    const { result } = renderHook(() => usePocketBase('http://localhost:8090', 'secret'));

    // Let authenticate resolve
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Advance past the timeout — should NOT set error because it was cleared
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONNECTION_TIMEOUT_MS + 1);
    });

    expect(result.current.error).toBeNull();
  });

  it('clears connection timeout on unmount', async () => {
    // authenticate never resolves
    mockAuthenticate.mockReturnValue(new Promise(() => {}));

    const { result, unmount } = renderHook(() => usePocketBase('http://localhost:8090', 'secret'));

    unmount();

    // Advance past timeout — should NOT set error (cleanup cleared the timer)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONNECTION_TIMEOUT_MS + 1);
    });

    // After unmount, state is stale but error should not have been set
    expect(result.current.error).toBeNull();
  });
});
