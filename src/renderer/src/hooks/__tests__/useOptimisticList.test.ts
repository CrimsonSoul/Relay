import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOptimisticList } from '../useOptimisticList';

const data1 = [1, 2, 3];
const data2 = [4, 5, 6];
const data3 = [7, 8, 9];

describe('useOptimisticList', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initial data matches external', () => {
    const { result } = renderHook(() => useOptimisticList(data1));
    expect(result.current.data).toEqual([1, 2, 3]);
  });

  it('setData updates local data', () => {
    const { result } = renderHook(() => useOptimisticList(data1));
    act(() => {
      result.current.setData(data2);
    });
    expect(result.current.data).toEqual([4, 5, 6]);
  });

  it('external updates sync when no mutations pending', () => {
    const { result, rerender } = renderHook(({ data }) => useOptimisticList(data), {
      initialProps: { data: data1 },
    });
    expect(result.current.data).toEqual([1, 2, 3]);

    rerender({ data: data2 });
    expect(result.current.data).toEqual([4, 5, 6]);
  });

  it('external updates are queued during mutations', () => {
    const { result, rerender } = renderHook(({ data }) => useOptimisticList(data), {
      initialProps: { data: data1 },
    });

    act(() => {
      result.current.startMutation();
    });

    rerender({ data: data2 });
    // Should still show old data since mutation is pending
    expect(result.current.data).toEqual([1, 2, 3]);
  });

  it('queued updates are applied after mutation finishes', () => {
    const { result, rerender } = renderHook(({ data }) => useOptimisticList(data), {
      initialProps: { data: data1 },
    });

    act(() => {
      result.current.startMutation();
    });

    rerender({ data: data2 });
    // Should still show old data since mutation is pending
    expect(result.current.data).toEqual([1, 2, 3]);

    // finishMutation applies queued data — realtime events from PB are correctly
    // sorted by useCollection, so applying them is safe and prevents stale state.
    act(() => {
      result.current.finishMutation();
    });
    expect(result.current.data).toEqual([4, 5, 6]);
  });

  it('multiple concurrent mutations apply latest queued data after all finish', () => {
    const { result, rerender } = renderHook(({ data }) => useOptimisticList(data), {
      initialProps: { data: data1 },
    });

    act(() => {
      result.current.startMutation();
      result.current.startMutation();
    });

    rerender({ data: data3 });
    expect(result.current.data).toEqual([1, 2, 3]);

    // First mutation finishes — still one pending, data stays optimistic
    act(() => {
      result.current.finishMutation();
    });
    expect(result.current.data).toEqual([1, 2, 3]);

    // Second mutation finishes — queued data applied
    act(() => {
      result.current.finishMutation();
    });
    expect(result.current.data).toEqual([7, 8, 9]);
  });

  it('dataRef always reflects latest local data', () => {
    const { result } = renderHook(() => useOptimisticList(data1));
    expect(result.current.dataRef.current).toEqual([1, 2, 3]);

    act(() => {
      result.current.setData(data2);
    });
    expect(result.current.dataRef.current).toEqual([4, 5, 6]);
  });
});
