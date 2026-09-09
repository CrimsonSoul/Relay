import { act, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
it.each(['desktop', 'web'])(
  'keeps %s cached coverage unverified until both reconnect reads finish',
  async (kind) => {
    vi.stubGlobal('api', { ...globalThis.api, runtime: { kind } });
    render(<Fixture />);
    expect(await screen.findByText('Confirmed through 2099-12-31')).toBeInTheDocument();
    connection(false);
    const rows = deferred<OnCallRecord[]>();
    state.rows.mockReturnValueOnce(rows.promise);
    connection(true);
    await waitFor(() => expect(state.rows).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Confirmed through 2099-12-31')).not.toBeInTheDocument();
    expect(screen.getByText('Checking coverage')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm coverage' })).toBeDisabled();
    await act(async () => rows.resolve([{ ...row, name: 'Bob' }]));
    expect(await screen.findByText('Needs review')).toBeInTheDocument();
  },
);
it('keeps failed reconnect rows unverified even after reviews successfully refresh', async () => {
  render(<Fixture />);
  await screen.findByText('Confirmed through 2099-12-31');
  connection(false);
  state.rows.mockRejectedValueOnce(new Error('network timeout'));
  connection(true);
  expect(await screen.findByText('Coverage unverified')).toBeInTheDocument();
  expect(screen.queryByText('Confirmed through 2099-12-31')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirm coverage' })).toBeDisabled();
});
it('does not let a prior connection read restore authority during the new connection', async () => {
  render(<Fixture />);
  await screen.findByText('Confirmed through 2099-12-31');
  connection(false);
  const old = deferred<OnCallRecord[]>();
  state.rows.mockReturnValueOnce(old.promise);
  connection(true);
  await waitFor(() => expect(state.rows).toHaveBeenCalledTimes(2));
  connection(false);
  const current = deferred<OnCallRecord[]>();
  state.rows.mockReturnValueOnce(current.promise);
  connection(true);
  await waitFor(() => expect(state.rows).toHaveBeenCalledTimes(3));
  await act(async () => old.resolve([row]));
  expect(screen.queryByText('Confirmed through 2099-12-31')).not.toBeInTheDocument();
  expect(screen.getByText('Checking coverage')).toBeInTheDocument();
  await act(async () => current.resolve([{ ...row, name: 'Bob' }]));
  expect(await screen.findByText('Needs review')).toBeInTheDocument();
});
it('waits for reviews too when rows have already refreshed', async () => {
  render(<Fixture />);
  await screen.findByText('Confirmed through 2099-12-31');
  connection(false);
  const next = deferred<(typeof review)[]>();
  state.reviews.mockReturnValueOnce(next.promise);
  connection(true);
  await waitFor(() => expect(state.rows).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('Confirmed through 2099-12-31')).not.toBeInTheDocument();
  await act(async () => next.resolve([review]));
  expect(await screen.findByText('Confirmed through 2099-12-31')).toBeInTheDocument();
});
