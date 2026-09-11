import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useServerSyncImport } from './useServerSyncImport';
import { prepareServerSync, type ServerSyncPlan } from '../services/serverSyncService';
import { pickBrowserFile } from '../services/browserFilePicker';
vi.mock('../services/serverSyncService', () => ({ prepareServerSync: vi.fn() }));
vi.mock('../services/browserFilePicker', () => ({ pickBrowserFile: vi.fn() }));
const apply = vi.fn();
const plan: ServerSyncPlan = {
  fileName: 'servers.json',
  added: [],
  updated: [],
  removed: ['USER'],
  unchanged: 1,
  incomingCount: 1,
  currentCount: 2,
  backupJson: '[]',
  apply,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(pickBrowserFile).mockResolvedValue({
    kind: 'selected',
    name: 'servers.json',
    text: '[]',
    buffer: new ArrayBuffer(0),
  });
  vi.mocked(prepareServerSync).mockResolvedValue(plan);
  apply.mockResolvedValue({
    imported: 0,
    updated: 0,
    removed: 1,
    unchanged: 1,
    errors: [],
    outcomeUncertain: false,
  });
});
it('choosing a file only previews and cancelling never applies it', async () => {
  const { result } = renderHook(useServerSyncImport);
  await act(async () => {
    await result.current.chooseFile();
  });
  expect(result.current.preview).toBe(plan);
  expect(apply).not.toHaveBeenCalled();
  act(() => result.current.reset());
  expect(result.current.preview).toBeNull();
  expect(apply).not.toHaveBeenCalled();
});
it('applies once even on a double click, then clears the consumed preview', async () => {
  const { result } = renderHook(useServerSyncImport);
  await act(async () => {
    await result.current.chooseFile();
  });
  await act(async () => {
    await Promise.all([result.current.apply(), result.current.apply()]);
  });
  expect(apply).toHaveBeenCalledTimes(1);
  expect(result.current.preview).toBeNull();
  expect(result.current.result?.removed).toBe(1);
});
it('shows validation errors without applying changes', async () => {
  vi.mocked(prepareServerSync).mockRejectedValue(new Error('Duplicate names'));
  const { result } = renderHook(useServerSyncImport);
  await act(async () => {
    await result.current.chooseFile();
  });
  expect(result.current.error).toBe('Duplicate names');
  expect(result.current.preview).toBeNull();
  expect(apply).not.toHaveBeenCalled();
});
it('clears a failed preview so it cannot be retried blindly', async () => {
  apply.mockRejectedValue(new Error('Servers list changed'));
  const { result } = renderHook(useServerSyncImport);
  await act(async () => {
    await result.current.chooseFile();
  });
  await act(async () => {
    await result.current.apply();
  });
  expect(result.current.error).toBe('Servers list changed');
  expect(result.current.preview).toBeNull();
  expect(result.current.busy).toBe(false);
});
