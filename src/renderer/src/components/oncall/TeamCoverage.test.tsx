import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { OnCallRow } from '@shared/ipc';
import { TeamCoverage } from './TeamCoverage';
import { coverageFingerprint } from '../../services/oncallCoverageService';
const state = vi.hoisted(() => ({
  reviews: [] as unknown[],
  rows: [] as unknown[],
  online: true,
  error: null as string | null,
}));
vi.mock('../../hooks/useCollection', () => ({
  useCollection: (name: string) => ({
    data: name === 'oncall' ? state.rows : state.reviews,
    loading: false,
    error: state.error,
    hasLoadedSnapshot: true,
    isAuthoritative: true,
    refetch: async () => {},
  }),
}));
vi.mock('../../services/pocketbase', () => ({
  isOnline: () => state.online,
  onConnectionStateChange: () => () => {},
}));
const confirm = vi.hoisted(() => vi.fn());
vi.mock('../../services/oncallCoverageService', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  confirmCoverage: confirm,
}));
const row: OnCallRow = {
  id: 'r1',
  team: 'SQL',
  teamId: 'sql',
  role: 'Primary',
  name: 'Alice',
  contact: 'a@test.com',
  updatedAt: Date.parse('2026-03-01T12:00:00Z'),
};
beforeEach(() => {
  state.reviews = [];
  state.rows = [row];
  state.error = null;
  state.online = true;
  vi.clearAllMocks();
  vi.stubGlobal('api', {
    getPendingSyncStatus: async () => ({ pendingCount: 0 }),
    onPendingSyncStatusChanged: () => () => {},
  });
});
it('confirms through a chosen date and shows saved coverage separately from last edited', async () => {
  const review = {
    id: 'review1',
    teamId: 'sql',
    validThrough: '2099-12-31',
    rowsFingerprint: coverageFingerprint([row]),
  };
  confirm.mockResolvedValue(review);
  const { unmount } = render(<TeamCoverage teamId="sql" rows={[row]} locked={false} />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Confirm coverage' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirm coverage' }));
  fireEvent.change(screen.getByLabelText('Confirmed through'), { target: { value: '2099-12-31' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save confirmation' }));
  expect(await screen.findByText('Confirmed through 2099-12-31')).toBeInTheDocument();
  expect(screen.getByText(/Last edited/)).toBeInTheDocument();
  unmount();
  state.reviews = [review];
  render(<TeamCoverage teamId="sql" rows={[row]} locked={false} />);
  expect(await screen.findByText('Confirmed through 2099-12-31')).toBeInTheDocument();
});
it('invalidates edited coverage and shows queued state', async () => {
  state.rows = [{ ...row, name: 'Bob' }];
  state.reviews = [
    {
      id: 'review1',
      teamId: 'sql',
      validThrough: '2099-12-31',
      rowsFingerprint: coverageFingerprint([row]),
    },
  ];
  const { rerender } = render(
    <TeamCoverage teamId="sql" rows={[{ ...row, name: 'Bob' }]} locked={false} />,
  );
  expect(await screen.findByText('Needs review')).toBeInTheDocument();
  rerender(
    <TeamCoverage teamId="sql" rows={[{ ...row, queuedAt: '2026-09-09' }]} locked={false} />,
  );
  expect(screen.getByText('Pending changes')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Confirm coverage' })).toBeDisabled();
});
it('degrades gracefully for an older server and blocks offline or locked confirmation', () => {
  state.error = '404 collection not found';
  const { rerender } = render(<TeamCoverage teamId="sql" rows={[row]} locked={false} />);
  expect(screen.getByText(/Upgrade the Relay server/)).toBeInTheDocument();
  state.error = null;
  state.online = false;
  rerender(<TeamCoverage teamId="sql" rows={[row]} locked />);
  expect(screen.getByRole('button', { name: 'Confirm coverage' })).toBeDisabled();
});
