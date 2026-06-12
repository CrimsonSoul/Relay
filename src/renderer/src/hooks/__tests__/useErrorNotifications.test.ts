import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useErrorNotifications } from '../useErrorNotifications';

describe('useErrorNotifications', () => {
  let errorCb: ((n: { title: string; message: string }) => void) | null = null;
  let crashCb: ((i: { error: string }) => void) | null = null;
  const offError = vi.fn();
  const offCrash = vi.fn();

  beforeEach(() => {
    errorCb = null;
    crashCb = null;
    offError.mockClear();
    offCrash.mockClear();
    vi.stubGlobal('api', {
      onErrorNotification: (cb: typeof errorCb) => {
        errorCb = cb;
        return offError;
      },
      onPbCrashed: (cb: typeof crashCb) => {
        crashCb = cb;
        return offCrash;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a toast for error notifications and pb crashes', () => {
    const showToast = vi.fn();
    renderHook(() => useErrorNotifications(showToast));

    errorCb!({ title: 'Stability Warning', message: 'Multiple background errors detected.' });
    expect(showToast).toHaveBeenCalledWith(
      'Stability Warning: Multiple background errors detected.',
      'error',
    );

    crashCb!({ error: 'crash-loop' });
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('PocketBase'), 'error');
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useErrorNotifications(vi.fn()));
    unmount();
    expect(offError).toHaveBeenCalled();
    expect(offCrash).toHaveBeenCalled();
  });

  it('does nothing when globalThis.api is undefined', () => {
    vi.stubGlobal('api', undefined);
    const showToast = vi.fn();
    expect(() => {
      const { unmount } = renderHook(() => useErrorNotifications(showToast));
      unmount();
    }).not.toThrow();
    expect(showToast).not.toHaveBeenCalled();
  });
});
