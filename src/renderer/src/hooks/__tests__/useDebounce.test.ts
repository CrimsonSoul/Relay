import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useDebounce } from '../useDebounce';

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('hello', 300));
    expect(result.current).toBe('hello');
  });

  it('does not update value before delay', () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 300), {
      initialProps: { value: 'hello' },
    });

    rerender({ value: 'world' });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current).toBe('hello');
  });

  it('updates value after delay', () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 300), {
      initialProps: { value: 'hello' },
    });

    rerender({ value: 'world' });

    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(result.current).toBe('world');
  });

  it('resets timer on rapid changes (only last value survives)', () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 300), {
      initialProps: { value: 'a' },
    });

    rerender({ value: 'b' });
    void act(() => vi.advanceTimersByTime(100));

    rerender({ value: 'c' });
    void act(() => vi.advanceTimersByTime(100));

    rerender({ value: 'd' });
    void act(() => vi.advanceTimersByTime(100));

    // Still the original value since 300ms hasn't passed from last change
    expect(result.current).toBe('a');

    void act(() => vi.advanceTimersByTime(250));

    expect(result.current).toBe('d');
  });

  it('works with different delay values', () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 1000), {
      initialProps: { value: 'start' },
    });

    rerender({ value: 'end' });

    void act(() => vi.advanceTimersByTime(500));
    expect(result.current).toBe('start');

    void act(() => vi.advanceTimersByTime(600));
    expect(result.current).toBe('end');
  });

  it('works with non-string values', () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 200), {
      initialProps: { value: 42 },
    });

    rerender({ value: 99 });

    void act(() => vi.advanceTimersByTime(250));

    expect(result.current).toBe(99);
  });
});
