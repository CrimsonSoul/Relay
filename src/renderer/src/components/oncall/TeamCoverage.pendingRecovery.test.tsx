import { act, render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PendingChangesModal } from '../PendingChangesModal';
import type {
  PendingMutationOverlay,
  PendingChangesResponse,
  PendingChangesRequest,
  PendingChangeSummary,
} from '@shared/ipc';
import {
  applyOfflineMutationToStores,
  getCollectionStore,
} from '../../stores/collectionStoreRegistry';
import { TeamCoverage } from './TeamCoverage';
import { useCollection } from '../../hooks/useCollection';
import { resetCollectionStoreRegistry } from '../../stores/collectionStoreRegistry';
import { coverageFingerprint } from '../../services/oncallCoverageService';
import { toOnCallRow } from '../../utils/oncallFreshness';
import type { OnCallRecord } from '../../services/oncallService';

const state = vi.hoisted(() => ({
  online: true,
  listeners: new Set<(state: string) => void>(),
  rows: vi.fn(),
  reviews: vi.fn(),
}));
vi.mock('../../services/pocketbase', () => ({
  isOnline: () => state.online,
  onConnectionStateChange: (listener: (state: string) => void) => {
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  },
  getPocketBaseClientGeneration: () => 0,
  onPocketBaseClientChange: () => () => {},
  handleApiError: vi.fn(),
  getPb: () => ({
    collection: (name: string) => ({
      getFullList: name === 'oncall' ? state.rows : state.reviews,
      subscribe: vi.fn().mockResolvedValue(vi.fn()),
    }),
  }),
}));
const row: OnCallRecord = {
  id: 'r1',
  teamId: 'sql',
  team: 'SQL',
  role: 'Primary',
  name: 'Alice',
  contact: 'a@test.com',
  timeWindow: '',
  sortOrder: 0,
  created: '2026-03-01',
  updated: '2026-03-01',
};
const review = {
  id: 'review1',
  teamId: 'sql',
  validThrough: '2099-12-31',
  rowsFingerprint: coverageFingerprint([row]),
};
function Fixture() {
  const rows = useCollection<OnCallRecord>('oncall', { sort: 'sortOrder,id' });
  return <TeamCoverage teamId="sql" rows={rows.data.map(toOnCallRow)} locked={false} />;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  resetCollectionStoreRegistry();
  vi.clearAllMocks();
  state.online = true;
  state.listeners.clear();
  state.rows.mockResolvedValue([row]);
  state.reviews.mockResolvedValue([review]);
  vi.stubGlobal('api', {
    runtime: { kind: 'desktop' },
    getPendingSyncStatus: async () => ({ pendingCount: 0 }),
    onPendingSyncStatusChanged: () => () => {},
    syncPending: async () => ({ remainingChanges: [] }),
    cacheRead: async (name: string) => (name === 'oncall' ? [row] : [review]),
  });
});
afterEach(() => {
  cleanup();
  resetCollectionStoreRegistry();
  vi.unstubAllGlobals();
});

const entry: PendingChangeSummary = {
  id: 1,
  recordId: row.id,
  collection: 'oncall',
  action: 'update',
  label: 'Alice',
  reason: 'Server conflict',
};
async function resolveChange(
  resolution: 'server' | 'retry',
  overlays: PendingMutationOverlay[] = [],
  closeBeforeReply = false,
) {
  let pendingCount = 1;
  const listeners = new Set<(status: { pendingCount: number }) => void>();
  const reply = deferred<PendingChangesResponse>();
  const resolveStarted = deferred<void>();
  globalThis.api = {
    ...globalThis.api,
    getPendingSyncStatus: async () => ({ pendingCount }),
    onPendingSyncStatusChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pendingChanges: async (request: PendingChangesRequest) => {
      if (request.action === 'list') return { ok: true, entries: pendingCount ? [entry] : [] };
      if (request.action === 'review')
        return {
          ok: true,
          review: {
            entry,
            local: { ...row },
            server: { ...row },
            serverState: 'present',
            token: 'review-token',
          },
        };
      // The main process broadcasts reconciliation before returning its resolve reply.
      applyOfflineMutationToStores({
        mutationId: 'resolution',
        collection: 'oncall',
        action: 'update',
        record: { ...row },
        pendingCount: overlays.length,
        reconciled: true,
      });
      pendingCount = overlays.length;
      for (const listener of listeners) listener({ pendingCount });
      resolveStarted.resolve();
      return reply.promise;
    },
  } as typeof globalThis.api;
  render(<Fixture />);
  await screen.findByText('Pending changes');
  await waitFor(() =>
    expect(
      getCollectionStore('oncall', { sort: 'sortOrder,id' }).getSnapshot().isAuthoritative,
    ).toBe(true),
  );
  const fresh = deferred<OnCallRecord[]>();
  state.rows.mockReturnValueOnce(fresh.promise);
  const modal = render(<PendingChangesModal online onClose={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /Alice/ }));
  if (resolution === 'server') {
    fireEvent.click(await screen.findByRole('button', { name: 'Use server version' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard local change' }));
  } else fireEvent.click(await screen.findByRole('button', { name: 'Review and retry' }));
  await act(async () => {
    await resolveStarted.promise;
  });
  if (closeBeforeReply) modal.unmount();
  await act(async () => reply.resolve({ ok: true, resolved: true, remainingChanges: overlays }));
  await waitFor(() => expect(state.rows).toHaveBeenCalledTimes(2));
  expect(screen.getByRole('button', { name: 'Confirm coverage' })).toBeDisabled();
  return fresh;
}
it.each(['server', 'retry'] as const)(
  'restores coverage only after the fresh read following %s resolution',
  async (resolution) => {
    const fresh = await resolveChange(resolution);
    expect(screen.getByText('Checking coverage')).toBeInTheDocument();
    await act(async () => fresh.resolve([row]));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Confirm coverage' })).toBeEnabled(),
    );
  },
);
it.each(['server', 'retry'] as const)(
  'keeps failed post-%s reads unverified',
  async (resolution) => {
    const fresh = await resolveChange(resolution);
    await act(async () => fresh.reject(new Error('network timeout')));
    expect(await screen.findByText('Coverage unverified')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm coverage' })).toBeDisabled();
  },
);
it.each(['server', 'retry'] as const)(
  'preserves remaining overlays after %s resolution',
  async (resolution) => {
    const queued = {
      ...row,
      id: 'other',
      name: 'Queued colleague',
      queuedAt: '2026-09-09T00:00:00Z',
    };
    const fresh = await resolveChange(resolution, [
      { collection: 'oncall', action: 'update', record: queued },
      { collection: 'oncall', action: 'delete', record: { id: 'deleted' } },
    ]);
    await act(async () =>
      fresh.resolve([
        row,
        { ...queued, name: 'Old server colleague', queuedAt: undefined },
        { ...row, id: 'deleted' },
      ]),
    );
    const snapshot = getCollectionStore<OnCallRecord>('oncall', {
      sort: 'sortOrder,id',
    }).getSnapshot();
    expect(snapshot.data.find((item) => item.id === 'other')).toMatchObject({
      name: 'Queued colleague',
      queuedAt: '2026-09-09T00:00:00Z',
    });
    expect(snapshot.data.some((item) => item.id === 'deleted')).toBe(false);
    expect(snapshot.isAuthoritative).toBe(false);
    expect(screen.getByRole('button', { name: 'Confirm coverage' })).toBeDisabled();
  },
);
it.each(['server', 'retry'] as const)(
  'refreshes after %s completes even if the dialog unmounts',
  async (resolution) => {
    const fresh = await resolveChange(resolution, [], true);
    await act(async () => fresh.resolve([row]));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Confirm coverage' })).toBeEnabled(),
    );
  },
);
