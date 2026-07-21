import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DynatraceProblemRecord } from '@shared/dynatraceProblems';
import { DynatraceProblemsTab } from '../DynatraceProblemsTab';

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  setAddressed: vi.fn(async () => ({})),
  addNote: vi.fn(async () => ({ id: 'new-response-note' })),
  refetch: vi.fn(async () => undefined),
  saveProfileFilter: vi.fn(async () => ({ success: true, data: { count: 1 } })),
  connectionState: 'online',
  hookValue: {} as Record<string, unknown>,
}));

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));

vi.mock('../../hooks/useDynatraceProblems', () => ({
  useDynatraceProblems: () => mocks.hookValue,
}));

vi.mock('../../services/pocketbase', () => ({
  getConnectionState: () => mocks.connectionState,
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

function selectResolver(name = 'Ryan') {
  fireEvent.change(screen.getByRole('combobox', { name: 'Resolved by' }), {
    target: { value: name },
  });
}

describe('DynatraceProblemsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectionState = 'online';
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

  it('uses the shared scoped search control for the local problem queue', async () => {
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    expect(screen.getByRole('searchbox', { name: 'Search problems' })).toHaveClass(
      'scoped-search-input',
    );
  });

  it('shows the unaddressed queue and selected problem context', async () => {
    render(<DynatraceProblemsTab relayMode="client" />);

    expect(screen.getByRole('heading', { name: 'Local Response Queue' })).toBeInTheDocument();
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
      screen.getByText(/Choose your name, then add a ticket or note below/i),
    ).toBeInTheDocument();
  });

  it('requires one listed resolver and a drafted response before enabling local resolution', async () => {
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    const resolver = screen.getByRole('combobox', { name: 'Resolved by' });
    const address = screen.getByRole('button', { name: 'Mark addressed locally' });
    expect(
      within(resolver)
        .getAllByRole('option')
        .map(({ textContent }) => textContent),
    ).toEqual(['Select your name', 'Paris', 'Tristan', 'Connor', 'Weston', 'Vlad', 'Ryan']);

    fireEvent.change(screen.getByLabelText('Add a note'), {
      target: { value: 'Traffic shifted to the secondary pool.' },
    });
    expect(address).toBeDisabled();

    fireEvent.change(resolver, { target: { value: 'Ryan' } });
    expect(address).toBeEnabled();
    fireEvent.click(address);

    await waitFor(() => {
      expect(mocks.addNote).toHaveBeenCalledWith(
        'problem-1',
        'Traffic shifted to the secondary pool.',
        'Ryan',
      );
      expect(mocks.setAddressed).toHaveBeenCalledWith(
        'problem-1',
        true,
        'new-response-note',
        'Ryan',
      );
      expect(resolver).toHaveValue('');
    });
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
    expect(screen.getByRole('dialog', { name: 'Alerting profile filter' })).toHaveAttribute(
      'data-variant',
      'standard',
    );
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

  it('awaits an attributed drafted note before marking addressed', async () => {
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    fireEvent.change(screen.getByLabelText('Add a note'), {
      target: { value: 'Mitigated by shifting traffic to the secondary pool.' },
    });
    selectResolver();
    fireEvent.click(screen.getByRole('button', { name: 'Mark addressed locally' }));

    await waitFor(() => {
      expect(mocks.addNote).toHaveBeenCalledWith(
        'problem-1',
        'Mitigated by shifting traffic to the secondary pool.',
        'Ryan',
      );
      expect(mocks.setAddressed).toHaveBeenCalledWith(
        'problem-1',
        true,
        'new-response-note',
        'Ryan',
      );
    });
    expect(globalThis.api?.getClientHostname).not.toHaveBeenCalled();
    expect(mocks.addNote.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setAddressed.mock.invocationCallOrder[0],
    );
  });

  it('accepts a ticket reference instead of a NOC note and timestamps it before addressing', async () => {
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    const address = screen.getByRole('button', { name: 'Mark addressed locally' });
    fireEvent.change(screen.getByLabelText('Service Desk ticket number'), {
      target: { value: '  INC0012345  ' },
    });
    selectResolver();
    expect(address).toBeEnabled();
    fireEvent.click(address);

    await waitFor(() => {
      expect(mocks.addNote).toHaveBeenCalledWith('problem-1', 'Ticket: INC0012345', 'Ryan');
      expect(mocks.setAddressed).toHaveBeenCalledWith(
        'problem-1',
        true,
        'new-response-note',
        'Ryan',
      );
    });
    expect(mocks.addNote.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setAddressed.mock.invocationCallOrder[0],
    );
  });

  it('saves ticket then note then local disposition when both drafts exist', async () => {
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    fireEvent.change(screen.getByLabelText('Service Desk ticket number'), {
      target: { value: 'INC0099999' },
    });
    fireEvent.change(screen.getByLabelText('Add a note'), {
      target: { value: 'Traffic shifted to the secondary pool.' },
    });
    selectResolver();
    fireEvent.click(screen.getByRole('button', { name: 'Mark addressed locally' }));

    await waitFor(() => expect(mocks.setAddressed).toHaveBeenCalledTimes(1));
    expect(mocks.addNote.mock.calls.map(([, value]) => value)).toEqual([
      'Ticket: INC0099999',
      'Traffic shifted to the secondary pool.',
    ]);
    expect(mocks.addNote.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.addNote.mock.invocationCallOrder[1],
    );
    expect(mocks.addNote.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.setAddressed.mock.invocationCallOrder[0],
    );
  });

  it('saves a standalone ticket through the unified response action', async () => {
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });
    fireEvent.change(screen.getByLabelText('Service Desk ticket number'), {
      target: { value: 'REQ0042000' },
    });
    const save = screen.getByRole('button', { name: 'Save response' });
    expect(save).toBeDisabled();
    selectResolver();
    fireEvent.click(save);

    await waitFor(() =>
      expect(mocks.addNote).toHaveBeenCalledWith('problem-1', 'Ticket: REQ0042000', 'Ryan'),
    );
    expect(screen.queryByRole('button', { name: 'Add ticket reference' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add note' })).not.toBeInTheDocument();
  });

  it('retains ticket and note drafts and does not address when ticket persistence fails', async () => {
    mocks.addNote.mockRejectedValueOnce(new Error('Unable to queue the ticket reference.'));
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });
    fireEvent.change(screen.getByLabelText('Service Desk ticket number'), {
      target: { value: 'INC0012345' },
    });
    fireEvent.change(screen.getByLabelText('Add a note'), {
      target: { value: 'Keep this draft for retry.' },
    });
    selectResolver();
    fireEvent.click(screen.getByRole('button', { name: 'Mark addressed locally' }));

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        'Unable to queue the ticket reference.',
        'error',
      ),
    );
    expect(mocks.setAddressed).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Service Desk ticket number')).toHaveValue('INC0012345');
    expect(screen.getByLabelText('Add a note')).toHaveValue('Keep this draft for retry.');
  });

  it('queues ticket then note then addressed state in order while offline', async () => {
    mocks.connectionState = 'offline';
    let finishTicket: (() => void) | undefined;
    mocks.addNote.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishTicket = () => resolve({});
        }),
    );
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });
    fireEvent.change(screen.getByLabelText('Service Desk ticket number'), {
      target: { value: 'INC0012345' },
    });
    fireEvent.change(screen.getByLabelText('Add a note'), {
      target: { value: 'Queued NOC context.' },
    });
    selectResolver();
    fireEvent.click(screen.getByRole('button', { name: 'Mark addressed locally' }));

    await waitFor(() => expect(mocks.addNote).toHaveBeenCalledTimes(1));
    expect(mocks.setAddressed).not.toHaveBeenCalled();
    finishTicket?.();
    await waitFor(() => {
      expect(mocks.addNote).toHaveBeenCalledTimes(2);
      expect(mocks.setAddressed).toHaveBeenCalledTimes(1);
    });
    expect(mocks.addNote.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.addNote.mock.invocationCallOrder[1],
    );
    expect(mocks.addNote.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.setAddressed.mock.invocationCallOrder[0],
    );
  });

  it('saves a standalone note through the unified response action', async () => {
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    fireEvent.change(screen.getByLabelText('Add a note'), {
      target: { value: 'Escalated to the payments team.' },
    });
    const save = screen.getByRole('button', { name: 'Save response' });
    expect(save).toBeDisabled();
    selectResolver();
    fireEvent.click(save);

    await waitFor(() => {
      expect(mocks.addNote).toHaveBeenCalledWith(
        'problem-1',
        'Escalated to the payments team.',
        'Ryan',
      );
    });
    expect(globalThis.api?.getClientHostname).not.toHaveBeenCalled();
  });

  it('keeps an attributed saved response eligible for local resolution', async () => {
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    fireEvent.change(screen.getByLabelText('Add a note'), {
      target: { value: 'Mitigation is complete.' },
    });
    selectResolver();
    fireEvent.click(screen.getByRole('button', { name: 'Save response' }));

    const address = screen.getByRole('button', { name: 'Mark addressed locally' });
    await waitFor(() => expect(address).toBeEnabled());
    expect(screen.getByLabelText('Add a note')).toHaveValue('');
    fireEvent.click(address);

    await waitFor(() => {
      expect(mocks.addNote).toHaveBeenCalledTimes(1);
      expect(mocks.setAddressed).toHaveBeenCalledWith(
        'problem-1',
        true,
        'new-response-note',
        'Ryan',
      );
    });
  });

  it('does not mark addressed without a resolver selection', async () => {
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    fireEvent.change(screen.getByLabelText('Add a note'), {
      target: { value: 'Investigating the current problem.' },
    });
    expect(screen.getByRole('button', { name: 'Mark addressed locally' })).toBeDisabled();
    expect(mocks.addNote).not.toHaveBeenCalled();
    expect(mocks.setAddressed).not.toHaveBeenCalled();
  });

  it('queues an offline drafted note before queuing the addressed state', async () => {
    mocks.connectionState = 'offline';
    let finishNote: (() => void) | undefined;
    mocks.addNote.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishNote = () => resolve({ id: 'new-response-note' });
        }),
    );
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    expect(screen.getByText(/changes will sync when Relay reconnects/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Add a note'), {
      target: { value: 'Queued mitigation note.' },
    });
    selectResolver();
    fireEvent.click(screen.getByRole('button', { name: 'Mark addressed locally' }));

    await waitFor(() => expect(mocks.addNote).toHaveBeenCalledTimes(1));
    expect(mocks.setAddressed).not.toHaveBeenCalled();
    finishNote?.();
    await waitFor(() => expect(mocks.setAddressed).toHaveBeenCalledTimes(1));
    expect(mocks.addNote.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.setAddressed.mock.invocationCallOrder[0],
    );
  });

  it('does not mark addressed and reports the error when the drafted note fails', async () => {
    mocks.addNote.mockRejectedValueOnce(new Error('Unable to queue the NOC note.'));
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    fireEvent.change(screen.getByLabelText('Add a note'), {
      target: { value: 'Mitigation could not be persisted.' },
    });
    selectResolver();
    fireEvent.click(screen.getByRole('button', { name: 'Mark addressed locally' }));

    await waitFor(() => {
      expect(mocks.addNote).toHaveBeenCalledOnce();
      expect(mocks.showToast).toHaveBeenCalledWith('Unable to queue the NOC note.', 'error');
    });
    expect(mocks.setAddressed).not.toHaveBeenCalled();
  });

  it.each(['reconnecting', 'auth-failed'])('blocks mutations while %s', async (connectionState) => {
    mocks.connectionState = connectionState;
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
              author: 'Historical Operator',
              created: new Date().toISOString(),
            },
          ],
        ],
      ]),
    };

    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    expect(screen.getByLabelText('Add a note')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mark addressed locally' })).toBeDisabled();
  });

  it('does not let saved response history enable a new addressed action', async () => {
    const { rerender } = render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    expect(screen.getByRole('button', { name: 'Mark addressed locally' })).toBeDisabled();
    expect(
      screen.getByText(/Choose your name, then add a ticket or note below/i),
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

    expect(screen.getByRole('button', { name: 'Mark addressed locally' })).toBeDisabled();
  });

  it('renders Relay ticket notes as timestamped Service Desk references', async () => {
    mocks.hookValue = {
      ...mocks.hookValue,
      notesByProblemId: new Map([
        [
          'problem-1',
          [
            {
              id: 'ticket-1',
              problemId: 'problem-1',
              note: 'Ticket: INC0012345',
              operatorId: 'operator-ryan',
              author: 'Ryan Bell',
              created: '2026-07-15T12:30:00.000Z',
            },
          ],
        ],
      ]),
    };
    render(<DynatraceProblemsTab relayMode="client" />);
    const ticketValue = await screen.findByText('INC0012345');
    const ticketEntry = ticketValue.closest('article');
    expect(ticketEntry).not.toBeNull();
    expect(within(ticketEntry!).getByText('Service Desk ticket')).toBeVisible();
    expect(within(ticketEntry!).getByText('Ryan Bell')).toBeVisible();
  });

  it('explains that a resolver and response are required', async () => {
    render(<DynatraceProblemsTab relayMode="client" />);
    expect(
      await screen.findByText(/Choose your name, then add a ticket or note below/i),
    ).toBeVisible();
    expect(screen.getByText(/Relay records the ticket number for notation only/i)).toBeVisible();
  });

  it('keeps historical notes and addressed metadata without operator IDs visible', async () => {
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

  it('labels new records without stored author snapshots as Unattributed', async () => {
    mocks.hookValue = {
      ...mocks.hookValue,
      stateByProblemId: new Map([
        [
          openProblem.problemId,
          {
            id: 'state-unattributed',
            problemId: openProblem.problemId,
            addressed: true,
            addressedAt: '2026-07-17T18:00:00.000Z',
          },
        ],
      ]),
      notesByProblemId: new Map([
        [
          openProblem.problemId,
          [
            {
              id: 'note-unattributed',
              problemId: openProblem.problemId,
              note: 'Response recorded without a protected account.',
              created: '2026-07-17T18:01:00.000Z',
            },
          ],
        ],
      ]),
    };

    render(<DynatraceProblemsTab relayMode="client" />);
    fireEvent.click(screen.getByRole('tab', { name: /Addressed locally\s*1/i }));
    await screen.findByRole('heading', { name: openProblem.title });

    expect(screen.getAllByText(/Unattributed/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Relay workstation/)).not.toBeInTheDocument();
  });
});
