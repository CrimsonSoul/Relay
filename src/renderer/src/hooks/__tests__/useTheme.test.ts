import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTheme } from '../useTheme';

// Mock secureStorage
vi.mock('../../utils/secureStorage', () => ({
  secureStorage: {
    getItemSync: vi.fn(() => undefined),
    setItemSync: vi.fn(),
  },
}));

describe('useTheme', () => {
  let matchMediaListeners: Array<(e: { matches: boolean }) => void>;
  let mockMatchMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    matchMediaListeners = [];
    mockMatchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn((_: string, cb: (e: { matches: boolean }) => void) => {
        matchMediaListeners.push(cb);
      }),
      removeEventListener: vi.fn(),
    });
    globalThis.matchMedia = mockMatchMedia;
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to system preference', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('system');
  });

  it('resolves to dark when OS prefers dark', () => {
    mockMatchMedia.mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('resolves to light when OS prefers light', () => {
    mockMatchMedia.mockReturnValue({
      matches: false,
      addEventListener: vi.fn((_: string, cb: (e: { matches: boolean }) => void) => {
        matchMediaListeners.push(cb);
      }),
      removeEventListener: vi.fn(),
    });
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('sets explicit dark preference', () => {
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setPreference('dark');
    });
    expect(result.current.preference).toBe('dark');
    expect(result.current.resolved).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('sets explicit light preference', () => {
    const { result } = renderHook(() => useTheme());
    act(() => {
      result.current.setPreference('light');
    });
    expect(result.current.preference).toBe('light');
    expect(result.current.resolved).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('responds to OS theme changes when set to system', () => {
    mockMatchMedia.mockReturnValue({
      matches: false,
      addEventListener: vi.fn((_: string, cb: (e: { matches: boolean }) => void) => {
        matchMediaListeners.push(cb);
      }),
      removeEventListener: vi.fn(),
    });
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe('light');

    act(() => {
      matchMediaListeners.forEach((cb) => cb({ matches: true }));
    });
    expect(result.current.resolved).toBe('dark');
  });

  it('ignores OS changes when set to explicit preference', () => {
    mockMatchMedia.mockReturnValue({
      matches: false,
      addEventListener: vi.fn((_: string, cb: (e: { matches: boolean }) => void) => {
        matchMediaListeners.push(cb);
      }),
      removeEventListener: vi.fn(),
    });
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setPreference('dark');
    });
    expect(result.current.resolved).toBe('dark');

    act(() => {
      matchMediaListeners.forEach((cb) => cb({ matches: false }));
    });
    // Should still be dark because preference is explicit
    expect(result.current.resolved).toBe('dark');
  });
});
