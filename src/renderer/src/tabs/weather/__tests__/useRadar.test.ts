import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRadar } from '../useRadar';

const { weatherLogger } = vi.hoisted(() => ({
  weatherLogger: {
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../utils/logger', () => ({
  loggers: {
    weather: weatherLogger,
  },
}));

vi.mock('../utils', () => ({
  RADAR_INJECT_CSS: 'body { color: red; }',
  RADAR_INJECT_JS: 'window.__injected = true',
}));

type Listener = (event?: unknown) => void;

describe('useRadar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it('refreshes webview and handles refresh errors', () => {
    const webview = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      insertCSS: vi.fn().mockResolvedValue(undefined),
      executeJavaScript: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn(),
      reloadIgnoringCache: vi.fn(),
    };

    const { result } = renderHook(() => useRadar({ latitude: 1, longitude: 2, name: 'A' }));

    act(() => {
      result.current.webviewRef.current = webview as unknown as never;
      result.current.handleRefresh();
    });

    expect(webview.reloadIgnoringCache).toHaveBeenCalled();
    expect(result.current.isLoading).toBe(true);

    webview.reloadIgnoringCache.mockImplementationOnce(() => {
      throw new Error('refresh failed');
    });

    act(() => {
      result.current.handleRefresh();
    });
    expect(result.current.isLoading).toBe(false);
  });

  it('registers listeners, applies customizations, retries load failures, and cleans up', () => {
    const listeners = new Map<string, Listener>();

    const webview = {
      addEventListener: vi.fn((name: string, cb: Listener) => {
        listeners.set(name, cb);
      }),
      removeEventListener: vi.fn((name: string) => {
        listeners.delete(name);
      }),
      insertCSS: vi.fn().mockResolvedValue(undefined),
      executeJavaScript: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn(),
      reloadIgnoringCache: vi.fn(),
    };

    const { result, rerender, unmount } = renderHook(({ location }) => useRadar(location), {
      initialProps: { location: { latitude: 1, longitude: 2, name: 'A' } },
    });

    act(() => {
      result.current.webviewRef.current = webview as unknown as never;
      rerender({ location: { latitude: 3, longitude: 4, name: 'B' } });
    });

    expect(webview.addEventListener).toHaveBeenCalled();

    act(() => {
      listeners.get('dom-ready')?.();
      listeners.get('did-finish-load')?.();
      listeners.get('did-navigate')?.();
    });

    expect(webview.insertCSS).toHaveBeenCalled();
    expect(webview.executeJavaScript).toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(webview.executeJavaScript).toHaveBeenCalledTimes(6);

    // Abort code should be ignored
    act(() => {
      listeners.get('did-fail-load')?.({ errorCode: -3 });
    });
    expect(weatherLogger.error).not.toHaveBeenCalled();

    // Non-abort failures should log and retry with backoff
    act(() => {
      listeners.get('did-fail-load')?.({
        errorCode: 1,
        errorDescription: 'failed',
        validatedURL: 'https://x',
      });
      vi.advanceTimersByTime(1600);
    });
    expect(weatherLogger.error).toHaveBeenCalled();
    expect(weatherLogger.info).toHaveBeenCalled();
    expect(webview.reload).toHaveBeenCalled();

    act(() => {
      result.current.handleRefresh();
      listeners.get('did-stop-loading')?.();
    });
    expect(result.current.isLoading).toBe(false);

    unmount();
    expect(webview.removeEventListener).toHaveBeenCalled();
  });
});
