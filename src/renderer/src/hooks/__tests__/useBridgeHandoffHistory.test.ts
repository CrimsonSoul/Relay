import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useBridgeHandoffHistory } from '../useBridgeHandoffHistory';

const snapshot = {
  contacts: ['a@example.com', 'b@example.com'],
  groups: ['Network Operations'],
};

describe('useBridgeHandoffHistory', () => {
  it('writes the successful composition with the existing record shape', async () => {
    const addHistory = vi.fn().mockResolvedValue({ id: 'history-1' });
    const { result } = renderHook(() => useBridgeHandoffHistory(addHistory));

    await act(async () => {
      await expect(result.current.saveSuccessfulHandoff(snapshot)).resolves.toBe('saved');
    });
    expect(addHistory).toHaveBeenCalledWith({
      note: '',
      groups: ['Network Operations'],
      contacts: ['a@example.com', 'b@example.com'],
      recipientCount: 2,
    });
  });

  it('deduplicates unchanged sequential and concurrent saves', async () => {
    const addHistory = vi.fn().mockResolvedValue({ id: 'history-1' });
    const { result } = renderHook(() => useBridgeHandoffHistory(addHistory));

    await act(async () => {
      const first = result.current.saveSuccessfulHandoff(snapshot);
      const second = result.current.saveSuccessfulHandoff(snapshot);
      await expect(Promise.all([first, second])).resolves.toEqual(['saved', 'saved']);
      await expect(result.current.saveSuccessfulHandoff(snapshot)).resolves.toBe('duplicate');
    });
    expect(addHistory).toHaveBeenCalledTimes(1);
  });

  it('allows retry after a rejected history write', async () => {
    const addHistory = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ id: 'history-2' });
    const { result } = renderHook(() => useBridgeHandoffHistory(addHistory));

    await expect(result.current.saveSuccessfulHandoff(snapshot)).rejects.toThrow('offline');
    await expect(result.current.saveSuccessfulHandoff(snapshot)).resolves.toBe('saved');
    expect(addHistory).toHaveBeenCalledTimes(2);
  });

  it('allows retry when the existing history service reports a null write', async () => {
    const addHistory = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'history-2' });
    const { result } = renderHook(() => useBridgeHandoffHistory(addHistory));

    await expect(result.current.saveSuccessfulHandoff(snapshot)).rejects.toThrow(
      'History write failed',
    );
    await expect(result.current.saveSuccessfulHandoff(snapshot)).resolves.toBe('saved');
    expect(addHistory).toHaveBeenCalledTimes(2);
  });

  it('saves again after the composition changes', async () => {
    const addHistory = vi.fn().mockResolvedValue({ id: 'history' });
    const { result } = renderHook(() => useBridgeHandoffHistory(addHistory));

    await result.current.saveSuccessfulHandoff(snapshot);
    await result.current.saveSuccessfulHandoff({ ...snapshot, contacts: ['c@example.com'] });
    expect(addHistory).toHaveBeenCalledTimes(2);
  });
});
