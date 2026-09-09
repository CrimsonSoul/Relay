import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ELECTRON_RUNTIME, WEB_RUNTIME } from '@shared/runtime';
import { StatusBarLive } from './StatusBar';
const state = vi.hoisted(() => ({ online: true }));
vi.mock('../services/pocketbase', () => ({
  getConnectionState: () => (state.online ? 'online' : 'offline'),
  onConnectionStateChange: () => () => {},
}));
vi.mock('../stores/collectionStoreRegistry', () => ({
  refreshStoresAfterPendingSync: vi.fn(),
  subscribeOfflineReadiness: () => () => {},
  getOfflineReadiness: () => null,
  retryOfflineCopies: vi.fn(),
}));
const pendingChanges = vi.fn();
const syncPending = vi.fn();
const entry = {
  id: 1,
  recordId: 'record1',
  collection: 'contacts',
  action: 'update',
  label: 'Alice',
  reason: 'Server conflict',
};
beforeEach(() => {
  state.online = true;
  pendingChanges.mockReset().mockImplementation(async (request) => {
    if (request.action === 'list') return { ok: true, entries: [entry] };
    if (request.action === 'review')
      return {
        ok: true,
        review: {
          entry,
          local: { id: 'record1', name: 'Local Alice', enabled: true, count: 3, tags: ['local'] },
          server: { name: 'Server Alice', count: 4 },
          serverState: 'present',
          token: 'token',
        },
      };
    return { ok: true, resolved: true };
  });
  syncPending.mockReset().mockResolvedValue({ total: 1, conflicts: 0, errors: [] });
  vi.stubGlobal('api', {
    runtime: ELECTRON_RUNTIME,
    pendingChanges,
    syncPending,
    getPendingSyncStatus: async () => ({ pendingCount: 1 }),
    onPendingSyncStatusChanged: () => () => {},
  });
});
it('opens from status and shows labeled local/server values', async () => {
  render(<StatusBarLive />);
  fireEvent.click(await screen.findByRole('button', { name: '1 change pending' }));
  expect(await screen.findByRole('dialog', { name: 'Pending changes' })).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: /Alice/ }));
  expect(await screen.findByText('Server Alice')).toBeInTheDocument();
  expect(screen.getByLabelText('Local name')).toHaveValue('Local Alice');
  expect(screen.getByText('Server conflict')).toBeInTheDocument();
});
it('requires in-dialog confirmation before discarding and shows the empty state', async () => {
  render(<StatusBarLive />);
  fireEvent.click(await screen.findByRole('button', { name: '1 change pending' }));
  fireEvent.click(await screen.findByRole('button', { name: /Alice/ }));
  fireEvent.click(await screen.findByRole('button', { name: 'Use server version' }));
  expect(pendingChanges).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'resolve' }));
  pendingChanges.mockResolvedValue({ ok: true, entries: [] });
  fireEvent.click(screen.getByRole('button', { name: 'Discard local change' }));
  expect(await screen.findByText('No pending changes.')).toBeInTheDocument();
});
it('retries transient changes without reconnecting and reports partial failure', async () => {
  syncPending.mockResolvedValue({
    total: 1,
    conflicts: 0,
    errors: ['Unavailable'],
    remaining: 1,
    remainingChanges: [],
  });
  render(<StatusBarLive />);
  fireEvent.click(await screen.findByRole('button', { name: '1 change pending' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry saved change' }));
  expect(await screen.findByText(/1 change remains queued/)).toBeInTheDocument();
  expect(syncPending).toHaveBeenCalledTimes(1);
});
it('submits typed scalar edits against the reviewed token', async () => {
  render(<StatusBarLive />);
  fireEvent.click(await screen.findByRole('button', { name: '1 change pending' }));
  fireEvent.click(await screen.findByRole('button', { name: /Alice/ }));
  fireEvent.change(await screen.findByLabelText('Local name'), {
    target: { value: 'Merged Alice' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Review and retry' }));
  await waitFor(() =>
    expect(pendingChanges).toHaveBeenCalledWith({
      action: 'resolve',
      token: 'token',
      resolution: 'retry',
      edits: { name: 'Merged Alice' },
    }),
  );
});
it('disables server-dependent actions offline and offers no browser queue button', async () => {
  state.online = false;
  const view = render(<StatusBarLive />);
  fireEvent.click(await screen.findByRole('button', { name: '1 change pending' }));
  expect(await screen.findByRole('button', { name: 'Retry saved change' })).toBeDisabled();
  view.unmount();
  globalThis.api = { runtime: WEB_RUNTIME } as never;
  render(<StatusBarLive />);
  expect(screen.queryByRole('button', { name: /pending/ })).not.toBeInTheDocument();
});
