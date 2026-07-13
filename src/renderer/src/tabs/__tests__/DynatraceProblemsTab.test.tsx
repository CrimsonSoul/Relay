import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DynatraceProblemRecord } from '@shared/dynatraceProblems';
import { DynatraceProblemsTab } from '../DynatraceProblemsTab';

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  setAddressed: vi.fn(async () => ({})),
  addNote: vi.fn(async () => ({})),
  refetch: vi.fn(async () => undefined),
  saveProfileFilter: vi.fn(async () => ({ success: true, data: { count: 1 } })),
  hookValue: {} as Record<string, unknown>,
}));

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));

vi.mock('../../hooks/useDynatraceProblems', () => ({
  useDynatraceProblems: () => mocks.hookValue,
}));

vi.mock('../../services/pocketbase', () => ({
  getConnectionState: () => 'online',
  onConnectionStateChange: () => () => undefined,
}));

vi.mock('react-virtualized-auto-sizer', () => ({
  AutoSizer: ({
    renderProp,
  }: {
    renderProp: (size: { height: number; width: number }) => React.ReactNode;
  }) => renderProp({ height: 620, width: 520 }),
}));

const openProblem: DynatraceProblemRecord = {
  id: 'pb-1',
  problemId: 'problem-1',
  displayId: 'P-240791',
  title: 'Payment service response time degradation',
  status: 'OPEN',
  severity: 'PERFORMANCE',
  impactLevel: 'SERVICES',
  startTime: Date.now() - 30 * 60_000,
  endTime: -1,
  rootCauseName: 'payments-api',
  affectedEntities: [{ id: 'SERVICE-1', type: 'SERVICE', name: 'payments-api' }],
  impactedEntities: [],
  managementZones: [{ id: 'mz-1', name: 'NOC' }],
  alertingProfiles: ['Payments Production'],
  environmentUrl: 'https://abc123.live.dynatrace.com',
  syncedAt: new Date().toISOString(),
};

describe('DynatraceProblemsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hookValue = {
      problems: [openProblem],
      stateByProblemId: new Map(),
      notesByProblemId: new Map(),
      sync: {
        id: 'sync-1',
        key: 'primary',
        state: 'ok',
        lastSuccessAt: new Date().toISOString(),
        availableAlertingProfiles: ['Payments Production', 'Retail Stores'],
        selectedAlertingProfiles: [],
        profileFilterConfigured: false,
      },
      loading: false,
      error: null,
      setAddressed: mocks.setAddressed,
      addNote: mocks.addNote,
      refetch: mocks.refetch,
    };
    globalThis.api = {
      getClientHostname: vi.fn(async () => 'noc-laptop-07'),
      openExternal: vi.fn(async () => true),
      syncDynatraceProblems: vi.fn(async () => ({ success: true, data: { count: 1 } })),
      saveDynatraceProblemProfileFilter: mocks.saveProfileFilter,
    } as never;
  });

  it('shows the unaddressed queue and selected problem context', async () => {
    render(<DynatraceProblemsTab relayMode="client" />);

    expect(screen.getByRole('heading', { name: 'Local response queue' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^All/i })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Unaddressed\s*1/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: openProblem.title })).toBeInTheDocument();
    });
    expect(screen.getAllByText('payments-api').length).toBeGreaterThan(0);
    expect(
      screen.getByText('Add a NOC note below before marking this problem addressed locally.'),
    ).toBeInTheDocument();
  });

  it('opens the exact Dynatrace Platform Problems URL for the selected problem', async () => {
    const problemId = '2251993042228772816_1783622735060V2';
    mocks.hookValue = {
      ...mocks.hookValue,
      problems: [{ ...openProblem, problemId }],
    };
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    fireEvent.click(screen.getByRole('button', { name: /Open Dynatrace/i }));

    await waitFor(() => {
      expect(globalThis.api?.openExternal).toHaveBeenCalledWith(
        'https://abc123.apps.dynatrace.com/ui/apps/dynatrace.davis.problems/problem/' + problemId,
      );
    });
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it('shows an error toast when the Dynatrace problem URL is invalid', async () => {
    mocks.hookValue = {
      ...mocks.hookValue,
      problems: [{ ...openProblem, environmentUrl: 'https://example.com' }],
    };
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    fireEvent.click(screen.getByRole('button', { name: /Open Dynatrace/i }));

    await waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalledWith(
        'Unable to open this problem in Dynatrace.',
        'error',
      );
    });
    expect(globalThis.api?.openExternal).not.toHaveBeenCalled();
  });

  it('shows an error toast when the Dynatrace problem URL fails to open', async () => {
    globalThis.api = {
      ...globalThis.api,
      openExternal: vi.fn(async () => false),
    } as never;
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    fireEvent.click(screen.getByRole('button', { name: /Open Dynatrace/i }));

    await waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalledWith(
        'Unable to open this problem in Dynatrace.',
        'error',
      );
    });
  });

  it('sorts the problem queue strictly newest first regardless of severity', () => {
    const olderCritical: DynatraceProblemRecord = {
      ...openProblem,
      id: 'pb-older',
      problemId: 'problem-older',
      title: 'Older availability problem',
      severity: 'AVAILABILITY',
      startTime: Date.now() - 60 * 60_000,
    };
    const newerInfo: DynatraceProblemRecord = {
      ...openProblem,
      id: 'pb-newer',
      problemId: 'problem-newer',
      title: 'Newer informational problem',
      severity: 'INFO',
      startTime: Date.now() - 5 * 60_000,
    };
    mocks.hookValue = { ...mocks.hookValue, problems: [olderCritical, newerInfo] };

    render(<DynatraceProblemsTab relayMode="client" />);

    const queue = screen.getByRole('region', { name: 'Dynatrace problem queue' });
    const rows = within(queue).getAllByRole('button');
    expect(rows[0]).toHaveTextContent('Newer informational problem');
    expect(rows[1]).toHaveTextContent('Older availability problem');
  });

  it('renders a bounded number of rows for a 3,000-problem queue', () => {
    mocks.hookValue = {
      ...mocks.hookValue,
      problems: Array.from({ length: 3_000 }, (_, index) => ({
        ...openProblem,
        id: `pb-${index}`,
        problemId: `problem-${index}`,
        displayId: `P-${index}`,
        title: `Problem ${index}`,
        startTime: openProblem.startTime - index,
      })),
    };

    const { container } = render(<DynatraceProblemsTab relayMode="client" />);

    expect(container.querySelectorAll('.dt-problem-row').length).toBeLessThanOrEqual(40);
  });

  it('allocates enough virtual height for a four-tier problem row', () => {
    mocks.hookValue = { ...mocks.hookValue, problems: [openProblem] };

    render(<DynatraceProblemsTab relayMode="client" />);

    const queue = screen.getByRole('region', { name: 'Dynatrace problem queue' });
    expect(within(queue).getByRole('listitem')).toHaveStyle({ height: '124px' });
  });

  it('exposes the primary entity in the queue and filters by alerting profile', async () => {
    const hostProblem: DynatraceProblemRecord = {
      ...openProblem,
      id: 'pb-2',
      problemId: 'problem-2',
      displayId: 'P-240792',
      title: 'Host or monitoring unavailable',
      rootCauseName: '',
      affectedEntities: [],
      impactedEntities: [{ id: 'HOST-1', type: 'HOST', name: 'pos62term3.freedomroads.local' }],
      alertingProfiles: ['Retail Stores'],
    };
    mocks.hookValue = { ...mocks.hookValue, problems: [openProblem, hostProblem] };

    render(<DynatraceProblemsTab relayMode="server" />);

    expect(screen.getByText('pos62term3.freedomroads.local')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Alerting profiles/i }));
    const paymentsProfile = await screen.findByRole('checkbox', {
      name: 'Payments Production',
    });
    expect(paymentsProfile).toBeChecked();
    fireEvent.click(paymentsProfile);

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /Payment service response time degradation/i }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Host or monitoring unavailable/i })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save retention filter' }));
    await waitFor(() => {
      expect(mocks.saveProfileFilter).toHaveBeenCalledWith(['Retail Stores']);
    });
  });

  it('adds a drafted note before marking the problem addressed locally', async () => {
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    fireEvent.change(screen.getByLabelText('Add a note'), {
      target: { value: 'Mitigated by shifting traffic to the secondary pool.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mark addressed locally' }));

    await waitFor(() => {
      expect(mocks.addNote).toHaveBeenCalledWith(
        'problem-1',
        'Mitigated by shifting traffic to the secondary pool.',
        'noc-laptop-07',
      );
      expect(mocks.setAddressed).toHaveBeenCalledWith('problem-1', true, 'noc-laptop-07');
    });
    expect(mocks.addNote.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setAddressed.mock.invocationCallOrder[0],
    );
  });

  it('requires a saved or drafted NOC note before enabling the addressed action', async () => {
    const { rerender } = render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    expect(screen.getByRole('button', { name: 'Mark addressed locally' })).toBeDisabled();
    expect(
      screen.getByText('Add a NOC note below before marking this problem addressed locally.'),
    ).toBeInTheDocument();

    mocks.hookValue = {
      ...mocks.hookValue,
      notesByProblemId: new Map([
        [
          'problem-1',
          [
            {
              id: 'note-1',
              problemId: 'problem-1',
              note: 'Investigation is in progress.',
              author: 'noc-laptop-07',
              created: new Date().toISOString(),
            },
          ],
        ],
      ]),
    };
    rerender(<DynatraceProblemsTab relayMode="client" />);

    expect(screen.getByRole('button', { name: 'Mark addressed locally' })).toBeEnabled();
  });

  it('keeps notes and addressed metadata visible in read-only resolved history', async () => {
    mocks.hookValue = {
      ...mocks.hookValue,
      problems: [{ ...openProblem, status: 'CLOSED', endTime: Date.now() }],
      stateByProblemId: new Map([
        [
          openProblem.problemId,
          {
            id: 'state-1',
            problemId: openProblem.problemId,
            addressed: true,
            addressedAt: '2026-07-09T18:00:00.000Z',
            addressedBy: 'noc-laptop-07',
          },
        ],
      ]),
      notesByProblemId: new Map([
        [
          openProblem.problemId,
          [
            {
              id: 'note-1',
              problemId: openProblem.problemId,
              note: 'Mitigation completed before Dynatrace confirmed recovery.',
              author: 'noc-laptop-07',
              created: '2026-07-09T18:01:00.000Z',
            },
          ],
        ],
      ]),
    };
    render(<DynatraceProblemsTab relayMode="client" />);
    fireEvent.click(screen.getByRole('tab', { name: /History\s*1/i }));
    await screen.findByRole('heading', { name: openProblem.title });

    expect(screen.getByText('Resolved problems are retained for one year.')).toBeInTheDocument();

    expect(
      screen.queryByRole('button', { name: 'Mark addressed locally' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText('Mitigation completed before Dynatrace confirmed recovery.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/noc-laptop-07 · Jul/)).toBeInTheDocument();
  });
});
