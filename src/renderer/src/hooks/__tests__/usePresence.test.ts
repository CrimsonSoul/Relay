import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePresence } from '../usePresence';

describe('usePresence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      globalThis.setTimeout(() => callback(performance.now()), 16),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => globalThis.clearTimeout(id));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('moves an entering layer from opening to open', async () => {
    const { result } = renderHook(() => usePresence(true));
    expect(result.current).toEqual({ isMounted: true, state: 'opening' });
    await act(async () => vi.advanceTimersByTime(16));
    expect(result.current).toEqual({ isMounted: true, state: 'open' });
  });

  it('keeps a closing layer mounted for 160ms', async () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open), {
      initialProps: { open: true },
    });
    await act(async () => vi.advanceTimersByTime(16));
    rerender({ open: false });
    expect(result.current).toEqual({ isMounted: true, state: 'closing' });
    await act(async () => vi.advanceTimersByTime(159));
    expect(result.current.isMounted).toBe(true);
    await act(async () => vi.advanceTimersByTime(1));
    expect(result.current.isMounted).toBe(false);
  });

  it('cancels an in-flight exit when the layer reopens', async () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open), {
      initialProps: { open: true },
    });
    await act(async () => vi.advanceTimersByTime(16));
    rerender({ open: false });
    await act(async () => vi.advanceTimersByTime(80));
    rerender({ open: true });
    await act(async () => vi.advanceTimersByTime(16));
    expect(result.current).toEqual({ isMounted: true, state: 'open' });
    await act(async () => vi.advanceTimersByTime(200));
    expect(result.current.isMounted).toBe(true);
  });
});
