import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { BridgeAPI } from '@shared/ipc';
import type { DynatraceProblemRecord } from '@shared/dynatraceProblems';
import { SdpProblemChanges } from './SdpProblemChanges';
const original = globalThis.api;
afterEach(() => {
  globalThis.api = original;
  vi.useRealTimers();
});
const start = Date.UTC(2026, 8, 20);
const problem = {
  problemId: 'P1',
  environmentUrl: 'https://example.apps.dynatrace.com',
  startTime: start,
  affectedEntities: [{ id: 'H1', type: 'HOST', name: 'db01.prod.test' }],
  impactedEntities: [],
  managementZones: [],
} as unknown as DynatraceProblemRecord;
const change = {
  id: '1',
  number: 'CH 1',
  title: 'Patch database',
  description: '',
  status: 'Open',
  stage: 'Implementation',
  site: '',
  scheduledStart: start - 10000,
  scheduledEnd: start + 10000,
  assets: ['db01.prod.test'],
  services: [],
};
const connected = {
  success: true,
  data: { configured: true, status: 'connected', expiresAt: 123 },
};
it('automatically displays paginated matches, explains evidence, and permits local decisions', async () => {
  const invoke = vi.fn().mockImplementation(async (command) =>
    command.action === 'status'
      ? connected
      : {
          success: true,
          data: {
            changesPage: {
              page: command.page,
              changes: command.page ? [change] : [],
              hasMore: command.page === 0,
            },
          },
        },
  );
  const openExternal = vi.fn();
  globalThis.api = { ...original, sdpAccount: invoke, openExternal } as BridgeAPI;
  render(<SdpProblemChanges problem={problem} />);
  await screen.findByText(/Systems & time match/);
  fireEvent.click(screen.getByText('Possible changes'));
  fireEvent.click(screen.getByText('CH 1 — Patch database'));
  expect(screen.getByText('Exact fully qualified hostname')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mark relevant' }));
  expect(screen.getByText(/Marked relevant/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(screen.getByText(/Dismissed/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reset decision' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open CH 1 in SDP' }));
  expect(openExternal).toHaveBeenCalledWith(
    'https://support.campingworld.com/app/itdesk/ChangeDetails.cc?CHANGEID=1',
  );
  expect(
    invoke.mock.calls.every(([command]) => ['status', 'readChanges'].includes(command.action)),
  ).toBe(true);
});
it('clears results on disconnect and rejects delayed data from the prior account', async () => {
  let finish!: (value: unknown) => void;
  const invoke = vi.fn().mockImplementation(async (command) =>
    command.action === 'status'
      ? connected
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
  render(<SdpProblemChanges problem={problem} />);
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  invoke.mockResolvedValue({ success: true, data: { status: 'disconnected' } });
  await act(async () => {
    window.dispatchEvent(new Event('relay:sdp-notifications-reset'));
  });
  await screen.findByText(/Connect your SDP work account in Tickets/);
  await act(async () =>
    finish({
      success: true,
      data: { changesPage: { page: 0, changes: [change], hasMore: false } },
    }),
  );
  expect(screen.queryByText(/Patch database/)).not.toBeInTheDocument();
});
it.each([
  { hasMore: true, detailsComplete: true, reads: 10 },
  { hasMore: false, detailsComplete: false, reads: 1 },
])(
  'labels partial coverage and clears stale matches when refresh fails ($reads reads)',
  async ({ hasMore, detailsComplete, reads }) => {
    const invoke = vi.fn().mockImplementation(async (command) =>
      command.action === 'status'
        ? connected
        : {
            success: true,
            data: {
              changesPage: { page: command.page, changes: [change], hasMore, detailsComplete },
            },
          },
    );
    globalThis.api = { ...original, sdpAccount: invoke } as BridgeAPI;
    render(<SdpProblemChanges problem={problem} />);
    await screen.findByText(/Partial coverage/);
    expect(invoke.mock.calls.filter(([command]) => command.action === 'readChanges')).toHaveLength(
      reads,
    );
    invoke.mockImplementation(async (command) =>
      command.action === 'status'
        ? connected
        : { success: true, data: { message: 'Changes read access unavailable' } },
    );
    fireEvent.click(screen.getByText('Possible changes'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh changes' }));
    await screen.findByText('Changes read access unavailable');
    expect(screen.queryByText(/Patch database/)).not.toBeInTheDocument();
  },
);
