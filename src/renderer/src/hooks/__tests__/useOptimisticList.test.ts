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

  it('queued updates are discarded after mutation finishes (optimistic state preserved)', () => {
    const { result, rerender } = renderHook(({ data }) => useOptimisticList(data), {
      initialProps: { data: data1 },
    });

    act(() => {
      result.current.startMutation();
    });

    rerender({ data: data2 });
    expect(result.current.data).toEqual([1, 2, 3]);

    // finishMutation discards queued data — optimistic state is the source of truth.
    // Realtime events during mutations often have wrong ordering (delete+create
    // cycles append records to the end), so applying them would scramble the UI.
    act(() => {
      result.current.finishMutation();
    });
    expect(result.current.data).toEqual([1, 2, 3]);

    // Next external update with a NEW reference syncs normally (no mutation pending)
    rerender({ data: [4, 5, 6] });
    expect(result.current.data).toEqual([4, 5, 6]);
  });

  it('multiple concurrent mutations discard queued data and preserve optimistic state', () => {
    const { result, rerender } = renderHook(({ data }) => useOptimisticList(data), {
      initialProps: { data: data1 },
    });

    act(() => {
      result.current.startMutation();
      result.current.startMutation();
    });

    rerender({ data: data3 });
    expect(result.current.data).toEqual([1, 2, 3]);

    // First mutation finishes — still one pending
    act(() => {
      result.current.finishMutation();
    });
    expect(result.current.data).toEqual([1, 2, 3]);

    // Second mutation finishes — queued data discarded, optimistic state kept
    act(() => {
      result.current.finishMutation();
    });
    expect(result.current.data).toEqual([1, 2, 3]);

    // Next external update with a NEW reference syncs normally
    rerender({ data: [7, 8, 9] });
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
