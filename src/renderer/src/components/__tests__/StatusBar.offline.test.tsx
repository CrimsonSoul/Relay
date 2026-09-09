import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ELECTRON_RUNTIME, WEB_RUNTIME } from '@shared/runtime';
import { StatusBarLive } from '../StatusBar';
import {
  getCollectionStore,
  resetCollectionStoreRegistry,
} from '../../stores/collectionStoreRegistry';
const pb = vi.hoisted(() => ({
  getFullList: vi.fn(async () => [{ id: 'one' }]),
  subscribe: vi.fn(async () => vi.fn()),
}));
vi.mock('../../services/pocketbase', () => ({
  getPb: () => ({ collection: () => pb }),
  isOnline: () => true,
  getConnectionState: () => 'online',
  handleApiError: vi.fn(),
  getPocketBaseClientGeneration: () => 0,
  onConnectionStateChange: () => vi.fn(),
  onPocketBaseClientChange: () => vi.fn(),
}));
const success = { ok: true, persisted: true };
let begin: ReturnType<typeof vi.fn>;
let commit: ReturnType<typeof vi.fn>;
beforeEach(() => {
  begin = vi.fn(async () => ({ ok: true, generation: 'one' }));
  commit = vi.fn(async () => success);
  vi.stubGlobal('api', {
    runtime: ELECTRON_RUNTIME,
    cacheSnapshotBegin: begin,
    cacheSnapshotAppend: async () => success,
    cacheSnapshotCommit: commit,
    getPendingSyncStatus: async () => ({ pendingCount: 2, issueCount: 1 }),
  });
});
afterEach(() => {
  resetCollectionStoreRegistry();
  vi.unstubAllGlobals();
});
it('shows saving, makes failure actionable and retries without hiding pending changes', async () => {
  let finish!: (result: unknown) => void;
  commit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<StatusBarLive />);
  act(() => {
    getCollectionStore('contacts').subscribe(() => {});
  });
  expect(await screen.findByText('Saving for offline use')).toBeInTheDocument();
  await waitFor(() => expect(commit).toHaveBeenCalled());
  await act(async () => {
    finish({ ok: false, persisted: false, error: 'Disk unavailable' });
  });
  expect(await screen.findByText(/Offline copy incomplete/)).toHaveTextContent('Disk unavailable');
  expect(screen.getByRole('button', { name: '2 changes pending' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Retry offline save' }));
  expect(await screen.findByText('Offline copy ready')).toBeVisible();
  expect(screen.getByRole('button', { name: '2 changes pending' })).toBeVisible();
  expect(commit).toHaveBeenCalledTimes(2);
});
it('keeps unsupported server-mode storage out of the status bar', async () => {
  begin.mockResolvedValue({ ok: false, persisted: false, error: 'Unavailable', unsupported: true });
  render(<StatusBarLive />);
  const store = getCollectionStore('contacts');
  act(() => {
    store.subscribe(() => {});
  });
  await waitFor(() => expect(store.getSnapshot().offlineSupported).toBe(false));
  expect(screen.queryByText(/Offline copy|Saving for offline/)).not.toBeInTheDocument();
  expect(store.getSnapshot().isAuthoritative).toBe(true);
});
it('does not expose desktop offline readiness in Relay Web', async () => {
  globalThis.api = { ...globalThis.api, runtime: WEB_RUNTIME } as never;
  render(<StatusBarLive />);
  const store = getCollectionStore('contacts');
  act(() => {
    store.subscribe(() => {});
  });
  await waitFor(() => expect(store.getSnapshot().hasLoadedSnapshot).toBe(true));
  expect(begin).not.toHaveBeenCalled();
  expect(screen.queryByText(/Offline copy|Saving for offline/)).not.toBeInTheDocument();
});

it('waits for every active directory before claiming the aggregate offline copy is ready', async () => {
  let finish!: (rows: { id: string }[]) => void;
  pb.getFullList.mockResolvedValueOnce([{ id: 'contact' }]).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<StatusBarLive />);
  act(() => {
    getCollectionStore('contacts').subscribe(() => {});
    getCollectionStore('servers').subscribe(() => {});
  });
  await waitFor(() => expect(commit).toHaveBeenCalledOnce());
  expect(screen.queryByText('Offline copy ready')).not.toBeInTheDocument();
  expect(screen.getByText('Saving for offline use')).toBeVisible();
  await act(async () => {
    finish([{ id: 'server' }]);
  });
  expect(await screen.findByText('Offline copy ready')).toBeVisible();
});
