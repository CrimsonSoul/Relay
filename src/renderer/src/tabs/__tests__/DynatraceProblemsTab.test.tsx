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

const HISTORY_PREFERENCES_STORAGE_KEY = 'relay-dynatrace-history-preferences';

function makeHistoryProblem(
  problemId: string,
  title: string,
  startTime: number,
): DynatraceProblemRecord {
  return {
    ...openProblem,
    id: `pb-${problemId}`,
    problemId,
    displayId: `P-${problemId}`,
    title,
    status: 'CLOSED',
    startTime,
    endTime: startTime + 30 * 60_000,
  };
}

function selectResolver(name = 'Ryan') {
  fireEvent.change(screen.getByRole('combobox', { name: 'Resolved by' }), {
    target: { value: name },
  });
}

describe('DynatraceProblemsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(HISTORY_PREFERENCES_STORAGE_KEY);
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
    expect(screen.getByRole('button', { name: 'Mark addressed locally' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save response' })).not.toBeInTheDocument();
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

  it('sorts history by local disposition or response while keeping each group newest first', () => {
    const newestWithoutResponse = makeHistoryProblem(
      'no-response',
      'Newest without local response',
      400,
    );
    const newerWithNote = makeHistoryProblem('with-note', 'Newer with a NOC note', 300);
    const olderAddressed = makeHistoryProblem('addressed', 'Older addressed locally', 100);
    mocks.hookValue = {
      ...mocks.hookValue,
      problems: [olderAddressed, newestWithoutResponse, newerWithNote],
      stateByProblemId: new Map([
        [
          olderAddressed.problemId,
          {
            id: 'state-addressed',
            problemId: olderAddressed.problemId,
            addressed: true,
            addressedAt: '2026-07-22T20:00:00.000Z',
            addressedBy: 'Ryan',
          },
        ],
      ]),
      notesByProblemId: new Map([
        [
          newerWithNote.problemId,
          [
            {
              id: 'note-response',
              problemId: newerWithNote.problemId,
              note: 'Traffic shifted to the healthy pool.',
              author: 'Tristan',
              created: '2026-07-22T19:00:00.000Z',
            },
          ],
        ],
      ]),
    };

    render(<DynatraceProblemsTab relayMode="client" />);
    fireEvent.click(screen.getByRole('tab', { name: /History\s*3/i }));

    const queue = screen.getByRole('region', { name: 'Dynatrace problem history' });
    const rowTitles = () =>
      within(queue)
        .getAllByRole('button')
        .map((row) => row.textContent);

    expect(rowTitles()).toEqual([
      expect.stringContaining('Newest without local response'),
      expect.stringContaining('Newer with a NOC note'),
      expect.stringContaining('Older addressed locally'),
    ]);

    fireEvent.change(screen.getByRole('combobox', { name: 'Sort history' }), {
      target: { value: 'addressed-first' },
    });
    expect(rowTitles()).toEqual([
      expect.stringContaining('Older addressed locally'),
      expect.stringContaining('Newest without local response'),
      expect.stringContaining('Newer with a NOC note'),
    ]);

    fireEvent.change(screen.getByRole('combobox', { name: 'Sort history' }), {
      target: { value: 'response-first' },
    });
    expect(rowTitles()).toEqual([
      expect.stringContaining('Newer with a NOC note'),
      expect.stringContaining('Older addressed locally'),
      expect.stringContaining('Newest without local response'),
    ]);

    fireEvent.change(screen.getByRole('combobox', { name: 'Sort history' }), {
      target: { value: 'no-response-first' },
    });
    expect(rowTitles()).toEqual([
      expect.stringContaining('Newest without local response'),
      expect.stringContaining('Newer with a NOC note'),
      expect.stringContaining('Older addressed locally'),
    ]);
  });

  it('filters history by response type and exposes resolver, note count, and ticket metadata', () => {
    const addressedWithTicket = makeHistoryProblem(
      'addressed-ticket',
      'Addressed with a ticket',
      400,
    );
    const noteOnly = makeHistoryProblem('note-only', 'NOC note only', 300);
    const ticketOnly = makeHistoryProblem('ticket-only', 'Ticket only', 200);
    const noResponse = makeHistoryProblem('none', 'No local response', 100);
    mocks.hookValue = {
      ...mocks.hookValue,
      problems: [addressedWithTicket, noteOnly, ticketOnly, noResponse],
      stateByProblemId: new Map([
        [
          addressedWithTicket.problemId,
          {
            id: 'state-addressed-ticket',
            problemId: addressedWithTicket.problemId,
            addressed: true,
            addressedAt: '2026-07-22T20:00:00.000Z',
            addressedBy: 'Ryan',
          },
        ],
      ]),
      notesByProblemId: new Map([
        [
          addressedWithTicket.problemId,
          [
            {
              id: 'ticket-addressed',
              problemId: addressedWithTicket.problemId,
              note: 'Ticket: INC0012345',
              author: 'Ryan',
              created: '2026-07-22T20:00:00.000Z',
            },
          ],
        ],
        [
          noteOnly.problemId,
          [
            {
              id: 'note-only',
              problemId: noteOnly.problemId,
              note: 'Restarted the unhealthy service.',
              author: 'Tristan',
              created: '2026-07-22T19:00:00.000Z',
            },
          ],
        ],
        [
          ticketOnly.problemId,
          [
            {
              id: 'ticket-only',
              problemId: ticketOnly.problemId,
              note: 'Ticket: REQ0042000',
              author: 'Connor',
              created: '2026-07-22T18:00:00.000Z',
            },
          ],
        ],
      ]),
    };

    render(<DynatraceProblemsTab relayMode="client" />);
    fireEvent.click(screen.getByRole('tab', { name: /History\s*4/i }));

    const queue = screen.getByRole('region', { name: 'Dynatrace problem history' });
    const resultStatus = within(queue).getByRole('status');
    expect(resultStatus).toHaveTextContent('4 shown');
    expect(
      within(queue).getByRole('button', { name: /Addressed with a ticket/i }),
    ).toHaveTextContent('Ryan · INC0012345');
    expect(within(queue).getByRole('button', { name: /NOC note only/i })).toHaveTextContent(
      'Tristan · 1 note',
    );
    expect(within(queue).getByRole('button', { name: /No local response/i })).toHaveTextContent(
      'No local response',
    );

    const responseFilter = screen.getByRole('combobox', { name: 'Filter history by response' });
    fireEvent.change(responseFilter, { target: { value: 'local-response' } });
    expect(resultStatus).toHaveTextContent('3 shown');
    expect(within(queue).getAllByRole('button')).toHaveLength(3);
    expect(within(queue).queryByRole('button', { name: /No local response/i })).toBeNull();

    fireEvent.change(responseFilter, { target: { value: 'notes' } });
    expect(resultStatus).toHaveTextContent('1 shown');
    expect(within(queue).getAllByRole('button')).toHaveLength(1);
    expect(within(queue).getByRole('button', { name: /NOC note only/i })).toBeVisible();

    fireEvent.change(responseFilter, { target: { value: 'tickets' } });
    expect(within(queue).getAllByRole('button')).toHaveLength(2);
    expect(within(queue).getByRole('button', { name: /Addressed with a ticket/i })).toBeVisible();
    expect(within(queue).getByRole('button', { name: /Ticket only/i })).toBeVisible();

    fireEvent.change(responseFilter, { target: { value: 'addressed' } });
    expect(within(queue).getAllByRole('button')).toHaveLength(1);
    expect(within(queue).getByRole('button', { name: /Addressed with a ticket/i })).toBeVisible();

    fireEvent.change(responseFilter, { target: { value: 'none' } });
    expect(within(queue).getAllByRole('button')).toHaveLength(1);
    expect(within(queue).getByRole('button', { name: /No local response/i })).toBeVisible();
  });

  it('shows the newest ticket reference in compact History metadata', () => {
    const multipleTickets = makeHistoryProblem('multiple-tickets', 'Multiple linked tickets', 200);
    mocks.hookValue = {
      ...mocks.hookValue,
      problems: [multipleTickets],
      notesByProblemId: new Map([
        [
          multipleTickets.problemId,
          [
            {
              id: 'ticket-old',
              problemId: multipleTickets.problemId,
              note: 'Ticket: INC0011111',
              author: 'Weston',
              created: '2026-07-22T18:00:00.000Z',
            },
            {
              id: 'ticket-new',
              problemId: multipleTickets.problemId,
              note: 'Ticket: CHG0099999',
              author: 'Weston',
              created: '2026-07-22T20:00:00.000Z',
            },
          ],
        ],
      ]),
    };

    render(<DynatraceProblemsTab relayMode="client" />);
    fireEvent.click(screen.getByRole('tab', { name: /History\s*1/i }));

    const row = screen.getByRole('button', { name: /Multiple linked tickets/i });
    expect(row).toHaveTextContent('CHG0099999');
    expect(row).not.toHaveTextContent('INC0011111');
    expect(row.querySelector('.dt-problem-row__response-ticket')).toHaveAttribute(
      'title',
      'CHG0099999',
    );
  });

  it('restores and persists History sort and response preferences', () => {
    const ticketOnly = makeHistoryProblem('ticket-only', 'Ticket only', 200);
    mocks.hookValue = {
      ...mocks.hookValue,
      problems: [ticketOnly],
      notesByProblemId: new Map([
        [
          ticketOnly.problemId,
          [
            {
              id: 'ticket-only',
              problemId: ticketOnly.problemId,
              note: 'Ticket: CHG0001234',
              author: 'Weston',
              created: '2026-07-22T18:00:00.000Z',
            },
          ],
        ],
      ]),
    };
    localStorage.setItem(
      HISTORY_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ sort: 'response-first', responseFilter: 'tickets' }),
    );

    const { unmount } = render(<DynatraceProblemsTab relayMode="client" />);
    fireEvent.click(screen.getByRole('tab', { name: /History\s*1/i }));

    const sort = screen.getByRole('combobox', { name: 'Sort history' });
    const responseFilter = screen.getByRole('combobox', { name: 'Filter history by response' });
    expect(sort).toHaveValue('response-first');
    expect(responseFilter).toHaveValue('tickets');

    fireEvent.change(sort, { target: { value: 'no-response-first' } });
    fireEvent.change(responseFilter, { target: { value: 'none' } });
    expect(JSON.parse(localStorage.getItem(HISTORY_PREFERENCES_STORAGE_KEY) ?? '{}')).toEqual({
      sort: 'no-response-first',
      responseFilter: 'none',
    });

    unmount();
    render(<DynatraceProblemsTab relayMode="client" />);
    fireEvent.click(screen.getByRole('tab', { name: /History\s*1/i }));
    expect(screen.getByRole('combobox', { name: 'Sort history' })).toHaveValue('no-response-first');
    expect(screen.getByRole('combobox', { name: 'Filter history by response' })).toHaveValue(
      'none',
    );
  });

  it('distinguishes an empty response filter from an empty problem history', () => {
    const ticketOnly = makeHistoryProblem('ticket-only', 'Ticket only', 200);
    mocks.hookValue = {
      ...mocks.hookValue,
      problems: [ticketOnly],
      notesByProblemId: new Map([
        [
          ticketOnly.problemId,
          [
            {
              id: 'ticket-only',
              problemId: ticketOnly.problemId,
              note: 'Ticket: CHG0001234',
              author: 'Weston',
              created: '2026-07-22T18:00:00.000Z',
            },
          ],
        ],
      ]),
    };

    render(<DynatraceProblemsTab relayMode="client" />);
    fireEvent.click(screen.getByRole('tab', { name: /History\s*1/i }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter history by response' }), {
      target: { value: 'notes' },
    });

    expect(screen.getByText('No history matches this response filter')).toBeVisible();
    expect(screen.queryByText('No resolved problems in the one-year history')).toBeNull();
  });

  it('does not blame the response filter when search removes the History matches', () => {
    const ticketOnly = makeHistoryProblem('ticket-only', 'Ticket only', 200);
    mocks.hookValue = {
      ...mocks.hookValue,
      problems: [ticketOnly],
      notesByProblemId: new Map([
        [
          ticketOnly.problemId,
          [
            {
              id: 'ticket-only',
              problemId: ticketOnly.problemId,
              note: 'Ticket: CHG0001234',
              author: 'Weston',
              created: '2026-07-22T18:00:00.000Z',
            },
          ],
        ],
      ]),
    };

    render(<DynatraceProblemsTab relayMode="client" />);
    fireEvent.click(screen.getByRole('tab', { name: /History\s*1/i }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter history by response' }), {
      target: { value: 'tickets' },
    });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search problems' }), {
      target: { value: 'not present' },
    });

    expect(screen.getByText('No problems match this queue')).toBeVisible();
    expect(screen.queryByText('No history matches this response filter')).toBeNull();
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

  it('saves a ticket response from the selected History problem', async () => {
    const historyProblem = makeHistoryProblem('history-ticket', 'Resolved payment problem', 200);
    mocks.hookValue = { ...mocks.hookValue, problems: [historyProblem] };

    render(<DynatraceProblemsTab relayMode="client" />);
    fireEvent.click(screen.getByRole('tab', { name: /History\s*1/i }));
    await screen.findByRole('heading', { name: historyProblem.title });

    fireEvent.change(screen.getByLabelText('Service Desk ticket number'), {
      target: { value: 'REQ0042000' },
    });
    const save = screen.getByRole('button', { name: 'Save response' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Response by' }), {
      target: { value: 'Ryan' },
    });
    fireEvent.click(save);

    await waitFor(() =>
      expect(mocks.addNote).toHaveBeenCalledWith(
        historyProblem.problemId,
        'Ticket: REQ0042000',
        'Ryan',
      ),
    );
    expect(screen.queryByRole('button', { name: 'Add ticket reference' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add note' })).not.toBeInTheDocument();
  });

  it('does not expose the response action when History has no selected problem', () => {
    mocks.hookValue = { ...mocks.hookValue, problems: [] };

    render(<DynatraceProblemsTab relayMode="client" />);
    fireEvent.click(screen.getByRole('tab', { name: /History\s*0/i }));

    expect(screen.getByText('Select a problem')).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Response by' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save response' })).not.toBeInTheDocument();
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

  it('retries a failed disposition without saving the response twice', async () => {
    mocks.setAddressed.mockRejectedValueOnce(new Error('Unable to save the local disposition.'));
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    fireEvent.change(screen.getByLabelText('Add a note'), {
      target: { value: 'Traffic shifted to the secondary pool.' },
    });
    selectResolver();
    const address = screen.getByRole('button', { name: 'Mark addressed locally' });
    fireEvent.click(address);

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        'Unable to save the local disposition.',
        'error',
      ),
    );
    expect(mocks.addNote).toHaveBeenCalledTimes(1);
    expect(address).toBeEnabled();

    fireEvent.click(address);

    await waitFor(() => expect(mocks.setAddressed).toHaveBeenCalledTimes(2));
    expect(mocks.addNote).toHaveBeenCalledTimes(1);
    expect(mocks.setAddressed).toHaveBeenLastCalledWith(
      openProblem.problemId,
      true,
      'new-response-note',
      'Ryan',
    );
  });

  it('retries only the unsaved note when a two-part response partially fails', async () => {
    mocks.addNote
      .mockResolvedValueOnce({ id: 'ticket-response-note' })
      .mockRejectedValueOnce(new Error('Unable to queue the NOC note.'))
      .mockResolvedValueOnce({ id: 'noc-response-note' });
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    fireEvent.change(screen.getByLabelText('Service Desk ticket number'), {
      target: { value: 'INC0012345' },
    });
    fireEvent.change(screen.getByLabelText('Add a note'), {
      target: { value: 'Traffic shifted to the secondary pool.' },
    });
    selectResolver();
    const address = screen.getByRole('button', { name: 'Mark addressed locally' });
    fireEvent.click(address);

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith('Unable to queue the NOC note.', 'error'),
    );
    expect(screen.getByLabelText('Service Desk ticket number')).toHaveValue('');
    expect(screen.getByLabelText('Add a note')).toHaveValue(
      'Traffic shifted to the secondary pool.',
    );

    fireEvent.click(address);

    await waitFor(() => expect(mocks.setAddressed).toHaveBeenCalledTimes(1));
    expect(mocks.addNote.mock.calls.map(([, value]) => value)).toEqual([
      'Ticket: INC0012345',
      'Traffic shifted to the secondary pool.',
      'Traffic shifted to the secondary pool.',
    ]);
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

  it('shows Return to queue as the only action for an addressed open problem', async () => {
    mocks.hookValue = {
      ...mocks.hookValue,
      stateByProblemId: new Map([
        [
          openProblem.problemId,
          {
            id: 'state-addressed',
            problemId: openProblem.problemId,
            addressed: true,
            addressedAt: '2026-07-23T18:00:00.000Z',
            addressedBy: 'Ryan',
          },
        ],
      ]),
    };

    render(<DynatraceProblemsTab relayMode="client" />);
    fireEvent.click(screen.getByRole('tab', { name: /Addressed locally\s*1/i }));
    await screen.findByRole('heading', { name: openProblem.title });

    expect(screen.getByRole('button', { name: 'Return to queue' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save response' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Service Desk ticket number')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Add a note')).not.toBeInTheDocument();
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
