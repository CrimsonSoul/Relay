import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRadarSnapshot } from '../useRadarSnapshot';

describe('useRadarSnapshot', () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  const originalApi = globalThis.api;

  beforeEach(() => {
    unhandled.length = 0;
    process.on('unhandledRejection', onUnhandled);
  });

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
    globalThis.api = originalApi;
  });

  it('settles a rejected initial read and manual refresh without unhandled rejections', async () => {
    // Relay Web's bridge rejects these when the server is unreachable or replies invalidly.
    globalThis.api = {
      getRadarSnapshot: vi.fn(() => Promise.reject(new Error('Relay Web request unavailable'))),
      refreshRadar: vi.fn(() => Promise.reject(new Error('Relay Web request unavailable'))),
      onRadarSnapshot: vi.fn(() => () => undefined),
    } as unknown as typeof globalThis.api;

    const { result } = renderHook(() => useRadarSnapshot());
    act(() => result.current.refresh());
    expect(result.current.refreshing).toBe(true);

    await waitFor(() => expect(result.current.refreshing).toBe(false));
    // Node reports unhandled rejections once the microtask queue drains; yield one macrotask turn.
    // Promise.withResolvers is outside this project's TS lib target.
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(unhandled).toEqual([]);
    expect(result.current.snapshot.color).toBe('unknown');
  });
});
