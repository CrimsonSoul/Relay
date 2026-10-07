import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DynatraceProblemRecord } from '@shared/dynatraceProblems';
import { DynatraceProblemsTab } from '../DynatraceProblemsTab';
import { LAST_RESOLVER_STORAGE_KEY } from '../useProblemDispositionWorkflow';
import { formatOpsTime } from '../../utils/opsTime';

/** The freshness readout by its whole text; its caption, time and note are separate spans. */
const readout = (text: string | RegExp) => (_content: string, element: Element | null) =>
  !!element?.classList.contains('tab-freshness') &&
  (typeof text === 'string' ? element.textContent === text : text.test(element.textContent ?? ''));

// The queue header's Shortcuts toggle is a button too; row assertions skip it.
const notShortcuts = (name: string) => name !== 'Shortcuts';

const mocks = vi.hoisted(() => ({
  showToast: vi.fn(),
  setAddressed: vi.fn(async () => ({})),
  addNote: vi.fn(async (_problemId: string, _note: string, _author?: string) => ({
    id: 'new-response-note',
  })),
  refetch: vi.fn(async () => undefined),
  loadMoreHistory: vi.fn(async () => undefined),
  saveProfileFilter: vi.fn(async () => ({ success: true, data: { count: 1 } })),
  connectionState: 'online',
  privilegedSession: {
    state: 'signed-out',
    capabilities: [],
  } as { state: 'signed-out' | 'active'; capabilities: string[] },
  hookValue: {} as Record<string, unknown>,
}));

/**
 * Reads the nth entry of a mock's invocation order, failing loudly rather than
 * silently comparing `undefined` when the mock was called fewer times.
 */
const nthCallOrder = (
  mock: { mock: { invocationCallOrder: number[] } },
  index: number,
  label: string,
): number => {
  const order = mock.mock.invocationCallOrder.at(index);
  if (order === undefined) {
    throw new Error(`Expected ${label} to have been called at least ${index + 1} time(s)`);
  }
  return order;
};

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));

vi.mock('../../hooks/useDynatraceProblems', () => ({
  useDynatraceProblems: () => mocks.hookValue,
}));

vi.mock('../../hooks/useCollection', () => ({
  useCollection: () => ({ data: [], loading: false, error: null, refetch: vi.fn() }),
}));

vi.mock('../../contexts/PrivilegedAccessContext', () => ({
  usePrivilegedAccess: () => ({ session: mocks.privilegedSession }),
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
    localStorage.removeItem(LAST_RESOLVER_STORAGE_KEY);
    mocks.connectionState = 'online';
    mocks.privilegedSession = { state: 'signed-out', capabilities: [] };
    mocks.hookValue = {
      problems: [openProblem],
      stateByProblemId: new Map(),
      notesByProblemId: new Map(),
      totalHistoryCount: 0,
      hasMoreHistory: false,
      historyCachedPartial: false,
      loadMoreHistory: mocks.loadMoreHistory,
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
      openServiceDeskUrl: vi.fn(async () => true),
      writeClipboard: vi.fn(async () => true),
      syncDynatraceProblems: vi.fn(async () => ({ success: true, data: { count: 1 } })),
      saveDynatraceProblemProfileFilter: mocks.saveProfileFilter,
    } as never;
  });

  it('uses the shared scoped search control for the local problem queue', async () => {
    const { container } = render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    const heading = screen.getByRole('heading', { level: 2, name: 'Problems' });
    expect(heading).toHaveClass('tab-page-header__title');
    expect(heading.nextElementSibling).toHaveTextContent('Dynatrace NOC response');
    // Sync state sits with the queue it describes; its time is the freshness beside Refresh.
    expect(container.querySelector('.tab-page-header__meta')).toBeNull();
    expect(
      container.querySelector('.dt-problems__queue > .dt-problems__sync-state'),
    ).toHaveTextContent(/^Dynatrace sync on$/);
    const toolbar = screen.getByRole('toolbar', { name: 'Problem queue actions' });
    const utility = container.querySelector<HTMLElement>('.tab-command-group--utility');
    expect(toolbar).toContainElement(utility);
    expect(utility).toContainElement(screen.getByRole('group', { name: 'Problem queue filters' }));
    expect(screen.queryByRole('button', { name: /Alerting profiles/i })).not.toBeInTheDocument();
    expect(utility).toContainElement(screen.getByRole('searchbox', { name: 'Search problems' }));
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    expect(utility).toContainElement(refresh);
    // Refresh and its freshness lead the bar, as on Status and Radar; filters and search follow.
    const sync = container.querySelector<HTMLElement>('.dt-problems__sync');
    expect(utility?.firstElementChild).toBe(sync);
    expect(sync).toContainElement(refresh);
    expect(sync).toHaveTextContent(/Updated \d{1,2}:\d{2} [AP]M$/);
    expect(utility?.lastElementChild).toContainElement(
      screen.getByRole('searchbox', { name: 'Search problems' }),
    );
    // The keycap legend opens from the one-row queue header instead of wrapping beside it.
    expect(screen.getByRole('button', { name: 'Shortcuts' })).toBeVisible();
    expect(screen.getByLabelText('Keyboard shortcuts')).toHaveAttribute('popover', 'auto');
    expect(screen.getByText(/Alt\+↑\/↓/)).toBeInTheDocument();
    expect(screen.getByText(/Alt\+N/)).toBeInTheDocument();
    expect(container.querySelector('.tab-command-group--workflow')).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Search problems' })).toHaveClass(
      'scoped-search-input',
    );
  });

  it('syncs Dynatrace problems and alerting profiles before refreshing Relay data', async () => {
    render(<DynatraceProblemsTab relayMode="server" />);

    fireEvent.click(screen.getByRole('button', { name: 'Sync Now from Dynatrace' }));

    await waitFor(() => expect(globalThis.api?.syncDynatraceProblems).toHaveBeenCalledOnce());
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('reloads Relay data without requesting a privileged sync in unprivileged Relay Web', async () => {
    if (!globalThis.api) throw new Error('Expected bridge fixture');
    (globalThis.api as unknown as { runtime: { kind: 'web' } }).runtime = { kind: 'web' };
    mocks.privilegedSession = {
      state: 'active',
      capabilities: ['privileged.status.read'],
    };

    render(<DynatraceProblemsTab relayMode="server" />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(mocks.refetch).toHaveBeenCalledOnce());
    expect(globalThis.api.syncDynatraceProblems).not.toHaveBeenCalled();
  });

  it('says Refreshing… on the Refresh button while it re-reads Relay’s copy', async () => {
    let finish: () => void = () => undefined;
    mocks.refetch.mockReturnValueOnce(
      new Promise<undefined>((resolve) => {
        finish = () => resolve(undefined);
      }),
    );
    render(<DynatraceProblemsTab relayMode="client" />);
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    fireEvent.click(refresh);

    expect(await screen.findByRole('button', { name: 'Refreshing…' })).toBeDisabled();
    finish();
    expect(await screen.findByRole('button', { name: 'Refresh' })).toBeEnabled();
  });

  it('allows Relay Web operators with settings.manage to sync before reloading Relay data', async () => {
    if (!globalThis.api) throw new Error('Expected bridge fixture');
    (globalThis.api as unknown as { runtime: { kind: 'web' } }).runtime = { kind: 'web' };
    mocks.privilegedSession = {
      state: 'active',
      capabilities: ['privileged.status.read', 'settings.manage'],
    };

    render(<DynatraceProblemsTab relayMode="server" />);
    fireEvent.click(screen.getByRole('button', { name: 'Sync Now from Dynatrace' }));

    await waitFor(() => expect(globalThis.api?.syncDynatraceProblems).toHaveBeenCalledOnce());
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('shows the unaddressed queue and selected problem context', async () => {
    render(<DynatraceProblemsTab relayMode="client" />);

    expect(screen.getByRole('heading', { level: 2, name: 'Problems' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^All/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Unaddressed\s*1/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: openProblem.title })).toBeInTheDocument();
    });
    expect(screen.getAllByText('payments-api').length).toBeGreaterThan(0);
    expect(screen.getByText('Local to Relay. Dynatrace and SDP are unchanged.')).toBeVisible();
    expect(screen.queryByText(/then Mark addressed/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark Addressed in Relay' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save response' })).not.toBeInTheDocument();
  });
  it('presents NOC workflow naming and context without replacing canonical problem facts', async () => {
    mocks.hookValue = {
      ...mocks.hookValue,
      problems: [
        {
          ...openProblem,
          workflowTitle: 'NOC · Payment path degraded',
          workflowDescription: 'Escalate when checkout latency remains elevated.',
          workflowTags: ['teams:payments', 'customer-impacting'],
          workflowAffectedEntityTypes: ['SERVICE'],
        },
      ],
    };

    render(<DynatraceProblemsTab relayMode="client" />);

    expect(
      await screen.findByRole('heading', { name: 'NOC · Payment path degraded' }),
    ).toBeVisible();
    expect(screen.getByText('Selected problem NOC · Payment path degraded')).toBeInTheDocument();
    expect(screen.getByText('Problem details')).toBeVisible();
    expect(screen.getByText('Escalate when checkout latency remains elevated.')).toBeVisible();
    expect(screen.queryByText('Workflow tags')).not.toBeInTheDocument();
    expect(screen.queryByText('Affected types')).not.toBeInTheDocument();
    expect(screen.queryByText('teams:payments')).not.toBeInTheDocument();
    expect(screen.queryByText('customer-impacting')).not.toBeInTheDocument();
    expect(screen.getByText('Dynatrace problem')).toBeVisible();
    expect(screen.getByText(openProblem.title)).toBeVisible();
    // The NOC response follows the facts directly; problem details and SDP/system context follow it.
    const response = screen.getByRole('region', { name: 'NOC response' });
    expect(response.compareDocumentPosition(screen.getByText('Problem details'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(response.compareDocumentPosition(screen.getByText('Systems affected'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('shows the recorded email name without its status square in the queue and details', async () => {
    const subject = '🟥 AZ-EMAZ-365 │ PROD | P-26097177 | Device Offline | PTMP-CPE01-3';
    const displayTitle = 'AZ-EMAZ-365 │ PROD | P-26097177 | Device Offline | PTMP-CPE01-3';
    mocks.hookValue = {
      ...mocks.hookValue,
      problems: [
        {
          ...openProblem,
          title: 'Network availability monitor outage',
          notificationTitle: subject,
          notificationStatus: 'OPEN',
          notificationUpdatedAt: 2000,
        },
      ],
    };
    render(<DynatraceProblemsTab relayMode="client" />);
    expect(await screen.findByRole('heading', { name: displayTitle })).toBeVisible();
    expect(screen.getAllByText(displayTitle).length).toBeGreaterThan(1);
    expect(screen.queryByText(subject)).not.toBeInTheDocument();
    expect(screen.getByText('Dynatrace problem')).toBeVisible();
    expect(screen.getByText('Network availability monitor outage')).toBeVisible();
  });

  it('does not render an empty workflow context when its title duplicates the canonical title', async () => {
    mocks.hookValue = {
      ...mocks.hookValue,
      problems: [
        {
          ...openProblem,
          workflowTitle: openProblem.title.toUpperCase(),
          workflowDescription: `  ${openProblem.title.toUpperCase()}  `,
          workflowTags: ['teams:payments'],
          workflowAffectedEntityTypes: ['SERVICE'],
        },
      ],
    };

    render(<DynatraceProblemsTab relayMode="client" />);

    expect(
      await screen.findByRole('heading', { name: openProblem.title.toUpperCase() }),
    ).toBeVisible();
    expect(screen.queryByText('Problem details')).not.toBeInTheDocument();
  });

  it('prioritizes active sync state and exposes the exact last successful timestamp', () => {
    mocks.hookValue = {
      ...mocks.hookValue,
      sync: {
        ...(mocks.hookValue.sync as object),
        state: 'syncing',
        lastSuccessAt: '2026-08-07T17:45:00.000Z',
      },
    };

    render(<DynatraceProblemsTab relayMode="server" />);

    const status = screen.getAllByText('Syncing from Dynatrace now')[0]!;
    expect(status).not.toHaveAttribute('title');
    // The exact time rides on the freshness readout beside Refresh.
    const freshness = screen.getByText(readout(/^Updated \d{1,2}:\d{2} [AP]M$/));
    expect(freshness).toHaveAttribute('tabindex', '0');
    fireEvent.focus(freshness);
    expect(screen.getByRole('tooltip')).toHaveTextContent(/Last successful sync .*Aug/);
  });

  it('warns when Dynatrace reports a truncated result set', () => {
    mocks.hookValue = {
      ...mocks.hookValue,
      sync: {
        ...(mocks.hookValue.sync as object),
        resultTruncated: true,
      },
    };

    render(<DynatraceProblemsTab relayMode="server" />);

    // A warning-rail note (diamond pip), not live: the queue's persistent sync status announces it.
    const notice = screen.getByText('Dynatrace result limit reached.').closest('[role="note"]');
    expect(notice).toHaveClass('ink-rail--warning');
    expect(notice).toHaveTextContent(/result limit/i);
    expect(notice).toHaveTextContent(/history may be incomplete/i);
    expect(screen.queryByRole('alert')).toBeNull();
    const announcer = Array.from(document.querySelectorAll('output.sr-only')).find((node) =>
      /result limit reached/i.test(node.textContent ?? ''),
    );
    expect(announcer).toBeDefined();
  });

  it('loads more resolved history without loading the full year up front', async () => {
    const historical = makeHistoryProblem(
      'history-page-1',
      'Resolved payment latency',
      Date.now() - 60_000,
    );
    mocks.hookValue = {
      ...mocks.hookValue,
      problems: [historical],
      totalHistoryCount: 250,
      hasMoreHistory: true,
    };

    render(<DynatraceProblemsTab relayMode="client" />);
    fireEvent.click(screen.getByRole('button', { name: /History\s*250/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Load 100 More' }));

    await waitFor(() => expect(mocks.loadMoreHistory).toHaveBeenCalledOnce());
    expect(screen.getByText(/1\/250 loaded/i)).toBeVisible();
  });

  it('labels partial offline history as cached while preserving the authoritative total', () => {
    const historical = makeHistoryProblem(
      'history-cached',
      'Cached payment latency',
      Date.now() - 60_000,
    );
    mocks.hookValue = {
      ...mocks.hookValue,
      problems: [historical],
      totalHistoryCount: 250,
      historyCachedPartial: true,
    };

    render(<DynatraceProblemsTab relayMode="client" />);
    fireEvent.click(screen.getByRole('button', { name: /History\s*250/i }));

    expect(screen.getByText(/1\/250 cached/i)).toBeVisible();
  });

  it('cycles Alt+Down through the visible view instead of jumping to another tab', async () => {
    const nextProblem = {
      ...openProblem,
      id: 'pb-2',
      problemId: 'problem-2',
      displayId: 'P-240792',
      title: 'Checkout service response time degradation',
      startTime: openProblem.startTime - 1,
    };
    const addressedProblem = {
      ...openProblem,
      id: 'pb-3',
      problemId: 'problem-3',
      title: 'Already handled disk pressure',
    };
    mocks.hookValue = {
      ...mocks.hookValue,
      problems: [openProblem, nextProblem, addressedProblem],
      stateByProblemId: new Map([
        [
          addressedProblem.problemId,
          { id: 'state-3', problemId: addressedProblem.problemId, addressed: true },
        ],
      ]),
    };
    render(<DynatraceProblemsTab relayMode="client" active />);
    await screen.findByRole('heading', { name: openProblem.title });

    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });
    expect(
      await screen.findByRole('heading', { name: 'Checkout service response time degradation' }),
    ).toBeVisible();

    const filters = screen.getByRole('group', { name: 'Problem queue filters' });
    fireEvent.keyDown(window, { key: '2', code: 'Digit2', altKey: true });
    expect(within(filters).getByRole('button', { name: /Addressed in Relay/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });
    expect(
      await screen.findByRole('heading', { name: 'Already handled disk pressure' }),
    ).toBeVisible();
    expect(within(filters).getByRole('button', { name: /Addressed in Relay/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('submits the drafted response with Mod+Enter only once prerequisites are met', async () => {
    render(<DynatraceProblemsTab relayMode="client" active />);
    await screen.findByRole('heading', { name: openProblem.title });
    const note = screen.getByLabelText('NOC note');

    fireEvent.change(note, { target: { value: 'Failed over the checkout pool.' } });
    fireEvent.keyDown(note, { key: 'Enter', ctrlKey: true });
    expect(mocks.setAddressed).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'Resolved by' })).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('Select your name.');

    fireEvent.change(screen.getByRole('combobox', { name: 'Resolved by' }), {
      target: { value: 'Ryan' },
    });
    fireEvent.keyDown(note, { key: 'Enter', ctrlKey: true });

    await waitFor(() =>
      expect(mocks.setAddressed).toHaveBeenCalledWith(
        openProblem.problemId,
        true,
        expect.any(String),
        'Ryan',
      ),
    );
  });

  it('focuses search with / and offers Clear search when nothing matches', async () => {
    render(<DynatraceProblemsTab relayMode="client" active />);
    await screen.findByRole('heading', { name: openProblem.title });
    const search = screen.getByRole('searchbox', { name: 'Search problems' });

    fireEvent.keyDown(window, { key: '/' });
    expect(search).toHaveFocus();

    fireEvent.change(search, { target: { value: 'no-such-problem' } });
    expect(screen.getByText('No problems match “no-such-problem”')).toBeVisible();
    expect(document.querySelector('.dt-problems__queue .empty-state__glyph svg')).toHaveAttribute(
      'data-icon',
      'search',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear Search' }));

    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
    expect(screen.getByRole('heading', { name: openProblem.title })).toBeVisible();
  });

  it('lists every queue shortcut, including Alt+1–3 and Mod+Enter, in the hint row', async () => {
    render(<DynatraceProblemsTab relayMode="client" active />);
    await screen.findByRole('heading', { name: openProblem.title });

    const hints = screen.getByLabelText('Keyboard shortcuts');
    const keys = within(hints)
      .getAllByText((_, element) => element?.tagName === 'KBD')
      .map((key) => key.textContent);
    expect(keys).toEqual([
      'Alt+↑/↓',
      'Alt+1–3',
      'Alt+N',
      expect.stringMatching(/^(⌘|Ctrl)\+Enter$/),
      '/',
    ]);
  });

  it('explains that marking addressed stays local to Relay', async () => {
    render(<DynatraceProblemsTab relayMode="client" active />);
    await screen.findByRole('heading', { name: openProblem.title });

    expect(
      screen.getByRole('button', { name: 'Mark Addressed in Relay' }),
    ).toHaveAccessibleDescription(expect.stringContaining('Dynatrace and SDP are unchanged.'));
  });

  it('focuses the selected note editor with Alt+N without changing draft or disposition', async () => {
    render(<DynatraceProblemsTab relayMode="client" active />);
    await screen.findByRole('heading', { name: openProblem.title });

    fireEvent.keyDown(window, { key: 'n', altKey: true });

    expect(screen.getByLabelText('NOC note')).toHaveFocus();
    expect(mocks.setAddressed).not.toHaveBeenCalled();
    expect(mocks.addNote).not.toHaveBeenCalled();
  });

  it('reports an empty view once per triage key activation', () => {
    mocks.hookValue = { ...mocks.hookValue, problems: [] };
    render(<DynatraceProblemsTab relayMode="client" active />);

    fireEvent.keyDown(window, { key: 'ArrowDown', altKey: true });

    expect(mocks.showToast).toHaveBeenCalledOnce();
    expect(mocks.showToast).toHaveBeenCalledWith('No problems in this view.', 'info');
  });

  it('keeps a drafted NOC note when the search box narrows the queue', async () => {
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    fireEvent.change(screen.getByLabelText('NOC note'), {
      target: { value: 'Paged the payments on-call, bridge opening.' },
    });

    // Filtering is not a request to throw the note away
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search problems' }), {
      target: { value: 'unrelated-search-text' },
    });

    expect(screen.getByLabelText('NOC note')).toHaveValue(
      'Paged the payments on-call, bridge opening.',
    );
    expect(screen.getByRole('heading', { name: openProblem.title })).toBeInTheDocument();
  });

  it('keeps a drafted NOC note when a background sync resolves the problem', async () => {
    const { rerender } = render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    fireEvent.change(screen.getByLabelText('NOC note'), {
      target: { value: 'Vendor engaged, monitoring recovery.' },
    });
    selectResolver();

    // Dynatrace closes the problem on its own — no operator action at all — and it stops
    // matching the unaddressed queue.
    mocks.hookValue = {
      ...mocks.hookValue,
      problems: [{ ...openProblem, status: 'CLOSED', endTime: Date.now() }],
    };
    rerender(<DynatraceProblemsTab relayMode="client" />);

    expect(screen.getByLabelText('NOC note')).toHaveValue('Vendor engaged, monitoring recovery.');
    // A resolved problem relabels the same select, but the chosen resolver is still there
    expect(screen.getByRole('combobox', { name: 'Response by' })).toHaveValue('Ryan');
  });

  it('keeps each problem draft separate when the operator switches problems', async () => {
    const second: DynatraceProblemRecord = {
      ...openProblem,
      id: 'pb-2',
      problemId: 'problem-2',
      displayId: 'P-240792',
      title: 'Checkout latency spike',
      startTime: openProblem.startTime - 1,
    };
    mocks.hookValue = { ...mocks.hookValue, problems: [openProblem, second] };

    render(<DynatraceProblemsTab relayMode="client" />);
    const queue = await screen.findByRole('region', { name: 'Dynatrace problem queue' });

    fireEvent.change(screen.getByLabelText('NOC note'), { target: { value: 'Payments note' } });

    fireEvent.click(within(queue).getByRole('button', { name: /Checkout latency spike/i }));
    expect(screen.getByLabelText('NOC note')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('NOC note'), { target: { value: 'Checkout note' } });

    fireEvent.click(
      within(queue).getByRole('button', { name: new RegExp(openProblem.title, 'i') }),
    );
    expect(screen.getByLabelText('NOC note')).toHaveValue('Payments note');
  });

  it('requires one listed resolver and a drafted response before enabling local resolution', async () => {
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    const resolver = screen.getByRole('combobox', { name: 'Resolved by' });
    const address = screen.getByRole('button', { name: 'Mark Addressed in Relay' });
    expect(
      within(resolver)
        .getAllByRole('option')
        .map(({ textContent }) => textContent),
    ).toEqual(['Select your name', 'Paris', 'Tristan', 'Connor', 'Weston', 'Vlad', 'Ryan']);

    fireEvent.change(screen.getByLabelText('NOC note'), {
      target: { value: 'Traffic shifted to the secondary pool.' },
    });
    expect(address).toBeEnabled();
    fireEvent.click(address);
    expect(resolver).toHaveFocus();
    expect(resolver).toHaveAttribute('aria-invalid', 'true');
    expect(resolver).toHaveAccessibleDescription('Select your name.');
    expect(mocks.addNote).not.toHaveBeenCalled();
    expect(mocks.setAddressed).not.toHaveBeenCalled();

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
      // The resolver is remembered for the next problem rather than cleared.
      expect(resolver).toHaveValue('Ryan');
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

    // Exact name: the ↗ glyph is aria-hidden. It sits in the title band, not the footer below
    // the fold.
    const openDynatrace = screen.getByRole('button', { name: 'Open Dynatrace' });
    expect(openDynatrace.closest('.dt-problem-detail__header')).not.toBeNull();
    expect(openDynatrace).toHaveTextContent('Open Dynatrace ↗');
    fireEvent.click(openDynatrace);

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
        `Couldn't open ${openProblem.displayId} in Dynatrace. Search for ${openProblem.displayId} in Dynatrace in your browser.`,
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
        `Couldn't open ${openProblem.displayId} in Dynatrace. Search for ${openProblem.displayId} in Dynatrace in your browser.`,
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
    const rows = within(queue).getAllByRole('button', { name: notShortcuts });
    expect(rows[0]).toHaveTextContent('Newer informational problem');
    expect(rows[1]).toHaveTextContent('Older availability problem');
  });

  it('uses the record ID as a stable tie-breaker for equal problem timestamps', () => {
    const lowerId = {
      ...openProblem,
      id: 'pb-a',
      problemId: 'problem-a',
      title: 'Lower ID problem',
    };
    const higherId = {
      ...openProblem,
      id: 'pb-z',
      problemId: 'problem-z',
      title: 'Higher ID problem',
    };
    mocks.hookValue = { ...mocks.hookValue, problems: [lowerId, higherId] };

    render(<DynatraceProblemsTab relayMode="client" />);

    const queue = screen.getByRole('region', { name: 'Dynatrace problem queue' });
    const rows = within(queue).getAllByRole('button', { name: notShortcuts });
    expect(rows[0]).toHaveTextContent('Higher ID problem');
    expect(rows[1]).toHaveTextContent('Lower ID problem');
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
    fireEvent.click(screen.getByRole('button', { name: /History\s*3/i }));

    const queue = screen.getByRole('region', { name: 'Dynatrace problem history' });
    const rowTitles = () =>
      within(queue)
        .getAllByRole('button', { name: notShortcuts })
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
    fireEvent.click(screen.getByRole('button', { name: /History\s*4/i }));

    const queue = screen.getByRole('region', { name: 'Dynatrace problem history' });
    // The queue also carries a sync-freshness status; target the result count by its text.
    const resultStatus = within(queue).getByText(/4\/4 loaded/);
    expect(resultStatus).toHaveAttribute('role', 'status');
    expect(
      within(queue).getByRole('button', { name: /Addressed with a ticket/i }),
    ).toHaveTextContent('Ryan · INC0012345');
    expect(within(queue).getByRole('button', { name: /NOC note only/i })).toHaveTextContent(
      'Tristan · 1 note',
    );
    expect(within(queue).getByRole('button', { name: /No local response/i })).toHaveTextContent(
      'No NOC response',
    );

    const responseFilter = screen.getByRole('combobox', { name: 'Response filter' });
    fireEvent.change(responseFilter, { target: { value: 'local-response' } });
    expect(resultStatus).toHaveTextContent('3 shown');
    expect(within(queue).getAllByRole('button', { name: notShortcuts })).toHaveLength(3);
    expect(within(queue).queryByRole('button', { name: /No local response/i })).toBeNull();

    fireEvent.change(responseFilter, { target: { value: 'notes' } });
    expect(resultStatus).toHaveTextContent('1 shown');
    expect(within(queue).getAllByRole('button', { name: notShortcuts })).toHaveLength(1);
    expect(within(queue).getByRole('button', { name: /NOC note only/i })).toBeVisible();

    fireEvent.change(responseFilter, { target: { value: 'tickets' } });
    expect(within(queue).getAllByRole('button', { name: notShortcuts })).toHaveLength(2);
    expect(within(queue).getByRole('button', { name: /Addressed with a ticket/i })).toBeVisible();
    expect(within(queue).getByRole('button', { name: /Ticket only/i })).toBeVisible();

    fireEvent.change(responseFilter, { target: { value: 'addressed' } });
    expect(within(queue).getAllByRole('button', { name: notShortcuts })).toHaveLength(1);
    expect(within(queue).getByRole('button', { name: /Addressed with a ticket/i })).toBeVisible();

    fireEvent.change(responseFilter, { target: { value: 'none' } });
    expect(within(queue).getAllByRole('button', { name: notShortcuts })).toHaveLength(1);
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
    fireEvent.click(screen.getByRole('button', { name: /History\s*1/i }));

    const row = screen.getByRole('button', { name: /Multiple linked tickets/i });
    expect(row).toHaveTextContent('CHG0099999');
    expect(row).not.toHaveTextContent('INC0011111');
    // The row button's name carries the full reference and the detail pane shows it untruncated,
    // so the truncated cell carries no duplicate hover title.
    const ticket = row.querySelector('.dt-problem-row__response-ticket');
    expect(ticket).toHaveTextContent('CHG0099999');
    expect(ticket).not.toHaveAttribute('title');
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
    fireEvent.click(screen.getByRole('button', { name: /History\s*1/i }));

    const sort = screen.getByRole('combobox', { name: 'Sort history' });
    const responseFilter = screen.getByRole('combobox', { name: 'Response filter' });
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
    fireEvent.click(screen.getByRole('button', { name: /History\s*1/i }));
    expect(screen.getByRole('combobox', { name: 'Sort history' })).toHaveValue('no-response-first');
    expect(screen.getByRole('combobox', { name: 'Response filter' })).toHaveValue('none');
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
    fireEvent.click(screen.getByRole('button', { name: /History\s*1/i }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Response filter' }), {
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
    fireEvent.click(screen.getByRole('button', { name: /History\s*1/i }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Response filter' }), {
      target: { value: 'tickets' },
    });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search problems' }), {
      target: { value: 'not present' },
    });

    expect(screen.getByText('No problems match “not present”')).toBeVisible();
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

  it('shows impacted entities in detail and leaves storage scope in Administration', async () => {
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

    expect(screen.getAllByText('pos62term3.freedomroads.local')).not.toHaveLength(0);
    fireEvent.click(screen.getByText('Systems affected'));
    expect(screen.getByText('Impacted entities')).toBeVisible();
    expect(screen.queryByText('Management zones')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Alerting profiles' })).not.toBeInTheDocument();
  });

  it('awaits an attributed drafted note before marking addressed', async () => {
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    fireEvent.change(screen.getByLabelText('NOC note'), {
      target: { value: 'Mitigated by shifting traffic to the secondary pool.' },
    });
    selectResolver();
    fireEvent.click(screen.getByRole('button', { name: 'Mark Addressed in Relay' }));

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
    expect(nthCallOrder(mocks.addNote, 0, 'addNote')).toBeLessThan(
      nthCallOrder(mocks.setAddressed, 0, 'setAddressed'),
    );
  });

  it('saves a NOC note from the selected History problem', async () => {
    const historyProblem = makeHistoryProblem('history-ticket', 'Resolved payment problem', 200);
    mocks.hookValue = { ...mocks.hookValue, problems: [historyProblem] };

    render(<DynatraceProblemsTab relayMode="client" />);
    fireEvent.click(screen.getByRole('button', { name: /History\s*1/i }));
    await screen.findByRole('heading', { name: historyProblem.title });

    fireEvent.change(screen.getByLabelText('NOC note'), {
      target: { value: 'Confirmed payment recovery.' },
    });
    const save = screen.getByRole('button', { name: 'Save response' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(screen.getByRole('combobox', { name: 'Response by' })).toHaveFocus();
    expect(mocks.addNote).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox', { name: 'Response by' }), {
      target: { value: 'Ryan' },
    });
    fireEvent.click(save);

    await waitFor(() =>
      expect(mocks.addNote).toHaveBeenCalledWith(
        historyProblem.problemId,
        'Confirmed payment recovery.',
        'Ryan',
      ),
    );
    expect(screen.queryByRole('button', { name: 'Add ticket reference' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Note' })).not.toBeInTheDocument();
  });

  it('does not expose the response action when History has no selected problem', () => {
    mocks.hookValue = { ...mocks.hookValue, problems: [] };

    render(<DynatraceProblemsTab relayMode="client" />);
    fireEvent.click(screen.getByRole('button', { name: /History\s*0/i }));

    expect(screen.getByText('Select a problem')).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Response by' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save response' })).not.toBeInTheDocument();
  });

  it('retains the note draft and does not address when note persistence fails', async () => {
    mocks.addNote.mockRejectedValueOnce(new Error('Unable to queue the NOC note.'));
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });
    fireEvent.change(screen.getByLabelText('NOC note'), {
      target: { value: 'Keep this draft for retry.' },
    });
    selectResolver();
    fireEvent.click(screen.getByRole('button', { name: 'Mark Addressed in Relay' }));

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        "Couldn't mark P-240791 addressed in Relay. Unable to queue the NOC note. Try again.",
        'error',
      ),
    );
    expect(mocks.setAddressed).not.toHaveBeenCalled();
    expect(screen.getByLabelText('NOC note')).toHaveValue('Keep this draft for retry.');
  });

  it('retries a failed disposition without saving the response twice', async () => {
    mocks.setAddressed.mockRejectedValueOnce(new Error('Unable to save the local disposition.'));
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    fireEvent.change(screen.getByLabelText('NOC note'), {
      target: { value: 'Traffic shifted to the secondary pool.' },
    });
    selectResolver();
    const address = screen.getByRole('button', { name: 'Mark Addressed in Relay' });
    fireEvent.click(address);

    await waitFor(() =>
      expect(mocks.showToast).toHaveBeenCalledWith(
        "Couldn't mark P-240791 addressed in Relay. Unable to save the local disposition. Try again.",
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

  it('queues the note before addressed state while offline', async () => {
    mocks.connectionState = 'offline';
    let finishNote: (() => void) | undefined;
    mocks.addNote.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishNote = () => resolve({ id: 'queued-response-note' });
        }),
    );
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });
    fireEvent.change(screen.getByLabelText('NOC note'), {
      target: { value: 'Queued NOC context.' },
    });
    selectResolver();
    fireEvent.click(screen.getByRole('button', { name: 'Mark Addressed in Relay' }));

    await waitFor(() => expect(mocks.addNote).toHaveBeenCalledTimes(1));
    expect(mocks.setAddressed).not.toHaveBeenCalled();
    finishNote?.();
    await waitFor(() => {
      expect(mocks.addNote).toHaveBeenCalledTimes(1);
      expect(mocks.setAddressed).toHaveBeenCalledTimes(1);
    });
    expect(nthCallOrder(mocks.addNote, 0, 'addNote')).toBeLessThan(
      nthCallOrder(mocks.setAddressed, 0, 'setAddressed'),
    );
  });

  it('shows Return to Queue as the only action for an addressed open problem', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: /Addressed in Relay\s*1/i }));
    await screen.findByRole('heading', { name: openProblem.title });

    expect(screen.getByRole('button', { name: 'Return to Queue' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Save response' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Service Desk ticket number')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('NOC note')).not.toBeInTheDocument();
  });

  it('does not mark addressed without a resolver selection', async () => {
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    fireEvent.change(screen.getByLabelText('NOC note'), {
      target: { value: 'Investigating the current problem.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mark Addressed in Relay' }));
    expect(screen.getByRole('combobox', { name: 'Resolved by' })).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('Select your name.');
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
    fireEvent.change(screen.getByLabelText('NOC note'), {
      target: { value: 'Queued mitigation note.' },
    });
    selectResolver();
    fireEvent.click(screen.getByRole('button', { name: 'Mark Addressed in Relay' }));

    await waitFor(() => expect(mocks.addNote).toHaveBeenCalledTimes(1));
    expect(mocks.setAddressed).not.toHaveBeenCalled();
    finishNote?.();
    await waitFor(() => expect(mocks.setAddressed).toHaveBeenCalledTimes(1));
    expect(nthCallOrder(mocks.addNote, 0, 'addNote')).toBeLessThan(
      nthCallOrder(mocks.setAddressed, 0, 'setAddressed'),
    );
  });

  it('does not mark addressed and reports the error when the drafted note fails', async () => {
    mocks.addNote.mockRejectedValueOnce(new Error('Unable to queue the NOC note.'));
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

    fireEvent.change(screen.getByLabelText('NOC note'), {
      target: { value: 'Mitigation could not be persisted.' },
    });
    selectResolver();
    fireEvent.click(screen.getByRole('button', { name: 'Mark Addressed in Relay' }));

    await waitFor(() => {
      expect(mocks.addNote).toHaveBeenCalledOnce();
      expect(mocks.showToast).toHaveBeenCalledWith(
        "Couldn't mark P-240791 addressed in Relay. Unable to queue the NOC note. Try again.",
        'error',
      );
    });
    expect(mocks.setAddressed).not.toHaveBeenCalled();
  });

  it.each([
    ['reconnecting', 'Wait for Relay to reconnect'],
    ['auth-failed', 'Sign in to the Relay server first'],
  ])('blocks mutations while %s and says why', async (connectionState, reason) => {
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

    expect(screen.getByLabelText('NOC note')).toBeDisabled();
    const address = screen.getByRole('button', { name: 'Mark Addressed in Relay' });
    expect(address).toBeDisabled();
    expect(address).toHaveAccessibleDescription(expect.stringContaining(reason));
  });

  it('does not let saved response history stand in for a new response', async () => {
    const { rerender } = render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });

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

    selectResolver();
    fireEvent.click(screen.getByRole('button', { name: 'Mark Addressed in Relay' }));

    expect(screen.getByLabelText('NOC note')).toHaveFocus();
    expect(mocks.showToast).toHaveBeenCalledWith(
      'Add a NOC note before marking this problem addressed in Relay.',
      'warning',
    );
    expect(mocks.addNote).not.toHaveBeenCalled();
    expect(mocks.setAddressed).not.toHaveBeenCalled();
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
    expect(within(ticketEntry!).getByText('Ticket reference, not linked to SDP')).toBeVisible();
    expect(within(ticketEntry!).getByText('Ryan Bell')).toBeVisible();
    fireEvent.click(within(ticketEntry!).getByRole('button', { name: 'Copy INC0012345' }));
    await waitFor(() => {
      expect(globalThis.api?.writeClipboard).toHaveBeenCalledWith('INC0012345');
    });
  });

  it('opens an HTTPS Service Desk reference when the stored reference is a URL', async () => {
    mocks.hookValue = {
      ...mocks.hookValue,
      notesByProblemId: new Map([
        [
          'problem-1',
          [
            {
              id: 'ticket-url',
              problemId: 'problem-1',
              note: 'Ticket: https://servicedesk.example.com/INC0012345',
              author: 'Ryan',
              created: '2026-07-15T12:30:00.000Z',
            },
          ],
        ],
      ]),
    };

    render(<DynatraceProblemsTab relayMode="client" />);
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Open Reference https://servicedesk.example.com/INC0012345',
      }),
    );

    expect(globalThis.api?.openServiceDeskUrl).toHaveBeenCalledWith(
      'https://servicedesk.example.com/INC0012345',
    );
  });

  it('names a missing response and resolver only once marking addressed is attempted', async () => {
    render(<DynatraceProblemsTab relayMode="client" />);
    await screen.findByRole('heading', { name: openProblem.title });
    const address = screen.getByRole('button', { name: 'Mark Addressed in Relay' });
    expect(address).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Service Desk ticket number')).not.toBeInTheDocument();

    fireEvent.click(address);

    expect(screen.getByLabelText('NOC note')).toHaveFocus();
    expect(mocks.showToast).toHaveBeenCalledWith(
      'Add a NOC note and select your name before marking this problem addressed in Relay.',
      'warning',
    );
    expect(screen.getByRole('combobox', { name: 'Resolved by' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(mocks.addNote).not.toHaveBeenCalled();
    expect(mocks.setAddressed).not.toHaveBeenCalled();
  });

  it('words sync off as "not syncing" with cause, saved copy, owner and fix', async () => {
    mocks.hookValue = {
      ...mocks.hookValue,
      sync: { ...(mocks.hookValue.sync as object), state: 'disabled' },
    };
    const requested: unknown[] = [];
    const listener = (event: Event) => requested.push((event as CustomEvent<unknown>).detail);
    globalThis.addEventListener('relay:open-settings-section', listener);
    try {
      const { unmount } = render(<DynatraceProblemsTab relayMode="server" />);
      fireEvent.click(await screen.findByRole('button', { name: 'Open Dynatrace Settings' }));
      // Sync off is a warning banner in the queue that says what the queue is and how old it is.
      const banner = document.querySelector('.dt-problems__queue > .dt-problems__sync-state');
      expect(banner).toHaveClass('dt-problems__sync-state--stale');
      expect(banner?.querySelector('.dt-problems__sync-label')).toHaveTextContent(
        "Dynatrace isn't syncing.",
      );
      expect(banner?.querySelector('.dt-problems__sync-owner')).toHaveTextContent(
        "The queue is Relay's last saved copy (from just now). An Administrator can turn sync on in Settings › Dynatrace. Open Dynatrace Settings",
      );
      expect(requested).toEqual(['dynatrace']);
      unmount();

      render(<DynatraceProblemsTab relayMode="client" />);
      expect(
        await screen.findByText(
          /An Administrator on the Relay server can turn sync on in Settings › Dynatrace\./,
        ),
      ).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Open Dynatrace Settings' })).toBeNull();
    } finally {
      globalThis.removeEventListener('relay:open-settings-section', listener);
    }
  });

  it('calls problems with no sync time Relay\'s saved copy, never "never synced"', async () => {
    mocks.hookValue = {
      ...mocks.hookValue,
      sync: { ...(mocks.hookValue.sync as object), state: 'error', lastSuccessAt: undefined },
    };
    const { container } = render(<DynatraceProblemsTab relayMode="client" />);
    const banner = await waitFor(() => {
      const found = container.querySelector('.dt-problems__queue > .dt-problems__sync-state');
      expect(found).not.toBeNull();
      return found;
    });
    expect(banner).toHaveClass('dt-problems__sync-state--stale');
    expect(banner).toHaveTextContent(
      "Dynatrace isn't syncing: the last sync failed.The queue is Relay's saved copy, with no recorded sync time.",
    );
    expect(banner).not.toHaveTextContent('never synced');
  });

  it('gives the last sync as a clock time beside Refresh while sync is on', async () => {
    const lastSuccessAt = '2026-10-03T21:16:00.000Z';
    mocks.hookValue = {
      ...mocks.hookValue,
      sync: { ...(mocks.hookValue.sync as object), state: 'ok', lastSuccessAt },
    };
    render(<DynatraceProblemsTab relayMode="client" />);
    const freshness = await screen.findByText(readout(`Updated ${formatOpsTime(lastSuccessAt)}`));
    expect(freshness).toHaveClass('tab-freshness');
    expect(screen.getByRole('toolbar', { name: 'Problem queue actions' })).toContainElement(
      freshness,
    );
    expect(screen.queryByText(/· updated/)).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: /History\s*1/i }));
    await screen.findByRole('heading', { name: openProblem.title });

    const historyTitle = screen.getByText('History (1 year)');
    expect(historyTitle).toHaveAttribute('tabindex', '0');
    fireEvent.focus(historyTitle);
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Resolved problems are retained for one year.',
    );
    fireEvent.blur(historyTitle);

    expect(
      screen.queryByRole('button', { name: 'Mark Addressed in Relay' }),
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
    fireEvent.click(screen.getByRole('button', { name: /Addressed in Relay\s*1/i }));
    await screen.findByRole('heading', { name: openProblem.title });

    expect(screen.getAllByText(/Unattributed/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Relay workstation/)).not.toBeInTheDocument();
  });
});
