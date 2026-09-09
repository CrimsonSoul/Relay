import { act, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mutateCollection } from '../../services/mutationGateway';
import { getCollectionStore } from '../../stores/collectionStoreRegistry';
import { COVERAGE_COLLECTION } from '../../services/oncallCoverageService';
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
  writes: [] as Array<{ collection: string; action: string }>,
}));
vi.mock('../../services/pocketbase', () => ({
  isOnline: () => state.online,
  getConnectionState: () => (state.online ? 'online' : 'offline'),
  requireOnline: () => {
    if (!state.online) throw new Error('offline');
  },
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
      create: async (data: object) => {
        state.writes.push({ collection: name, action: 'create' });
        return { id: 'saved', ...data };
      },
      update: async (id: string, data: object) => {
        state.writes.push({ collection: name, action: 'update' });
        return { id, ...data };
      },
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
function connection(online: boolean) {
  act(() => {
    state.online = online;
    for (const listener of state.listeners) listener(online ? 'online' : 'offline');
  });
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
  state.writes = [];
  state.listeners.clear();
  state.rows.mockResolvedValue([row]);
  state.reviews.mockResolvedValue([review]);
  vi.stubGlobal('api', {
    runtime: { kind: 'web' },
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

it.each(['delayed', 'missing'] as const)(
  'keeps initial on-call and board-settings writes available while coverage reviews are %s',
  async (outcome) => {
    // The app's shared on-call collection is already ready before the first team appears.
    const oncall = getCollectionStore<OnCallRecord>('oncall', { sort: 'sortOrder,id' });
    const unsubscribe = oncall.subscribe(() => {});
    await waitFor(() => expect(oncall.getSnapshot().isAuthoritative).toBe(true));
    const pendingReviews = deferred<(typeof review)[]>();
    state.reviews.mockReturnValue(pendingReviews.promise);
    render(<Fixture />);
    await waitFor(() => expect(state.reviews).toHaveBeenCalledTimes(1));
    if (outcome === 'missing') {
      await act(async () =>
        pendingReviews.reject(Object.assign(new Error('Not found'), { status: 404 })),
      );
      expect(await screen.findByText(/Upgrade the Relay server/)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Confirm coverage' })).toBeDisabled();
    // Cover both row writes and the follow-up board order write, with reviews still unsettled.
    await mutateCollection('oncall', 'create', undefined, { team: 'New team' });
    await mutateCollection('oncall', 'update', 'saved', { name: 'Alice' });
    await mutateCollection('oncall_board_settings', 'create', undefined, {
      teamOrder: ['new-team'],
    });
    await mutateCollection('oncall_board_settings', 'update', 'saved', { teamOrder: ['new-team'] });
    expect(state.writes).toEqual([
      { collection: 'oncall', action: 'create' },
      { collection: 'oncall', action: 'update' },
      { collection: 'oncall_board_settings', action: 'create' },
      { collection: 'oncall_board_settings', action: 'update' },
    ]);
    if (outcome === 'delayed') {
      await act(async () => pendingReviews.resolve([review]));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Confirm coverage' })).toBeEnabled(),
      );
    }
    unsubscribe();
  },
);
it('keeps the ordinary reconnect write gate while coverage reviews refresh independently', async () => {
  render(<Fixture />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Confirm coverage' })).toBeEnabled(),
  );
  connection(false);
  const rows = deferred<OnCallRecord[]>();
  const reviews = deferred<(typeof review)[]>();
  state.rows.mockReturnValueOnce(rows.promise);
  state.reviews.mockReturnValueOnce(reviews.promise);
  connection(true);
  await waitFor(() => expect(state.rows).toHaveBeenCalledTimes(2));
  await expect(
    mutateCollection('oncall', 'create', undefined, { team: 'Blocked' }),
  ).rejects.toThrow('finishing its authoritative refresh');
  expect(screen.getByRole('button', { name: 'Confirm coverage' })).toBeDisabled();
  await act(async () => rows.resolve([row]));
  await expect(
    mutateCollection('oncall', 'create', undefined, { team: 'Ready' }),
  ).resolves.toMatchObject({ id: 'saved' });
  expect(screen.getByRole('button', { name: 'Confirm coverage' })).toBeDisabled();
  const store = getCollectionStore(COVERAGE_COLLECTION, { blocksWebMutations: false });
  expect(screen.queryByText('Confirmed through 2099-12-31')).not.toBeInTheDocument();
  expect(store.getSnapshot().isAuthoritative).toBe(false);
  await act(async () => reviews.resolve([review]));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Confirm coverage' })).toBeEnabled(),
  );
});
