import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RadarSnapshot } from '@shared/ipc';
import { ELECTRON_RUNTIME, WEB_RUNTIME } from '@shared/runtime';
import { RadarTab } from '../RadarTab';
import { formatOpsTime } from '../../utils/opsTime';

function snapshotWith(overrides: Partial<RadarSnapshot> = {}): RadarSnapshot {
  return {
    color: 'green',
    dispatchers: [
      {
        name: 'prod01',
        tone: 'green',
        lastScheduleDate: '7/28/2026 2:56:10 PM',
        lastPubSubDate: '7/28/2026 2:56:20 PM',
        queues: [{ name: 'TRANSACTION.MEMBERSHIPS.ERROR.QUEUE', depth: 1323 }],
      },
      {
        name: 'prod02',
        tone: 'green',
        lastScheduleDate: '7/28/2026 2:56:10 PM',
        lastPubSubDate: '7/28/2026 2:56:20 PM',
        queues: [],
      },
    ],
    papa: [
      { name: 'READY', depth: 0 },
      { name: 'UNACKED', depth: 0 },
    ],
    metrics: [
      { label: 'Order API Counts', value: '6063', tone: 'green' },
      { label: 'EDW Daily Load Date Status', value: null, tone: 'yellow' },
    ],
    xcenter: { ok: 2000, pending: 1807 },
    currentTime: '7/28/2026 2:57:01 PM',
    lastUpdated: Date.parse('2026-07-28T19:57:00Z'),
    signInRequired: false,
    error: null,
    ...overrides,
  };
}

let listener: ((snapshot: RadarSnapshot) => void) | null = null;
const getRadarSnapshot = vi.fn(async () => snapshotWith());
const refreshRadar = vi.fn(async () => snapshotWith());
const openRadarSignIn = vi.fn(async () => true);
const openExternal = vi.fn(async () => true);

beforeEach(() => {
  listener = null;
  getRadarSnapshot.mockClear().mockResolvedValue(snapshotWith());
  refreshRadar.mockClear().mockResolvedValue(snapshotWith());
  openRadarSignIn.mockClear();
  openExternal.mockClear();

  Object.defineProperty(globalThis, 'api', {
    configurable: true,
    writable: true,
    value: {
      runtime: ELECTRON_RUNTIME,
      getRadarSnapshot,
      refreshRadar,
      openRadarSignIn,
      openExternal,
      onRadarSnapshot: (callback: (snapshot: RadarSnapshot) => void) => {
        listener = callback;
        return () => {
          listener = null;
        };
      },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RadarTab', () => {
  it('shows the status and both XCenter counts from the snapshot', async () => {
    const { container } = render(<RadarTab />);

    expect(await screen.findByText('Healthy')).toBeInTheDocument();
    const heading = screen.getByRole('heading', { level: 2, name: 'Radar' });
    expect(heading).toHaveClass('tab-page-header__title');
    expect(heading.nextElementSibling).toHaveTextContent('CW Dashboard');
    const toolbar = screen.getByRole('toolbar', { name: 'Radar actions' });
    const utility = container.querySelector<HTMLElement>('.tab-command-group--utility');
    expect(toolbar).toContainElement(utility);
    expect(utility).toContainElement(screen.getByRole('button', { name: 'Open Radar' }));
    expect(utility).toContainElement(screen.getByRole('button', { name: 'Refresh Radar' }));
    // Refresh, then its freshness readout, lead the command bar; Open Radar follows them.
    const [refreshSlot, freshness, openRadarSlot] = Array.from(utility?.children ?? []);
    expect(refreshSlot).toHaveTextContent(/^Refresh$/);
    expect(freshness).toHaveTextContent(/^Updated \d{1,2}:\d{2} [AP]M$/);
    expect(openRadarSlot).toHaveTextContent(/^Open Radar ↗$/);
    expect(container.querySelector('.tab-page-header')).not.toHaveTextContent('Updated');
    expect(container.querySelector('.tab-command-group--workflow')).toBeNull();
    expect(container.querySelector('.radar-overall')).toHaveClass('tab-page-status');
    // One always-mounted output carries the status announcement.
    expect(screen.getByText('Radar status: Healthy.').tagName).toBe('OUTPUT');
    expect(container.querySelector('.radar-overall-dot')).toHaveClass('tab-page-status__dot');
    expect(screen.getByText('2,000')).toBeInTheDocument();
    expect(screen.getByText('1,807')).toBeInTheDocument();
  });

  /** Colour must never be the only carrier of the state. */
  it('labels every status colour in text', async () => {
    getRadarSnapshot.mockResolvedValue(snapshotWith({ color: 'red' }));
    render(<RadarTab />);

    expect(await screen.findByText('Critical')).toBeInTheDocument();
  });

  it('applies the dashboard colour to the overall indicator', async () => {
    getRadarSnapshot.mockResolvedValue(snapshotWith({ color: 'yellow' }));
    const { container } = render(<RadarTab />);

    await screen.findByText('prod01');
    const overall = container.querySelector('.radar-overall');
    expect(overall?.getAttribute('data-radar-tone')).toBe('yellow');
    expect(overall).toHaveTextContent('Warning');
  });

  it('places the health rail before dispatcher lanes in DOM order', async () => {
    const { container } = render(<RadarTab />);
    await screen.findByText('prod01');

    const workspace = container.querySelector('.radar-workspace');
    expect(workspace?.children[0]).toHaveClass('radar-health-rail');
    expect(workspace?.children[1]).toHaveClass('radar-dispatcher-lanes');
  });

  it('marks retained data stale without discarding the last good snapshot', async () => {
    getRadarSnapshot.mockResolvedValue(
      snapshotWith({
        color: 'green',
        error: 'ECONNREFUSED',
      }),
    );
    const { container } = render(<RadarTab />);

    const notice = await screen.findByRole('region', { name: 'Radar refresh failed (Stale)' });
    expect(screen.getByText('Radar refresh failed. Board status: Stale.').tagName).toBe('OUTPUT');
    // The notice title is the single place the status word appears; the header drops its copy.
    expect(container.querySelector('.radar-overall')).toBeNull();
    expect(screen.getByText('prod01')).toBeInTheDocument();
    expect(screen.getByText('TRANSACTION.MEMBERSHIPS.ERROR.QUEUE')).toBeInTheDocument();
    expect(notice).toHaveTextContent('The Radar server refused the connection');
    const details = screen.getByText('Technical details').closest('details');
    expect(details).toHaveTextContent('ECONNREFUSED');
    expect(
      screen.getByText('Last successful update').nextElementSibling?.querySelector('time'),
    ).toHaveAttribute('dateTime', '2026-07-28T19:57:00.000Z');
  });

  /** Per-dispatcher tones are independent of the board's overall colour. */
  it('carries each dispatcher’s own tone', async () => {
    getRadarSnapshot.mockResolvedValue(
      snapshotWith({
        color: 'red',
        dispatchers: [
          {
            name: 'prod01',
            tone: 'red',
            lastScheduleDate: 'x',
            lastPubSubDate: 'y',
            queues: [],
          },
        ],
      }),
    );
    render(<RadarTab />);

    const panel = await screen.findByLabelText('Dispatcher prod01 — Critical');
    expect(panel.querySelector('[data-radar-tone="red"]')).not.toBeNull();
  });

  it('renders pushed snapshots without a re-fetch', async () => {
    render(<RadarTab />);
    await screen.findByText('Healthy');

    listener?.(snapshotWith({ color: 'red', xcenter: { ok: 5, pending: 9000 } }));

    expect(await screen.findByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('9,000')).toBeInTheDocument();
    expect(getRadarSnapshot).toHaveBeenCalledOnce();
  });

  it('opens Radar through the concise external action', async () => {
    render(<RadarTab />);

    const button = await screen.findByRole('button', { name: 'Open Radar' });
    expect(button).toHaveTextContent(/^Open Radar ↗$/);
    expect(button).not.toHaveAttribute('title');
    expect(button).toHaveClass('tactile-button--secondary');

    fireEvent.click(button);

    expect(openExternal).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith('https://cw-intra-web/CWDashboard/Home/Radar');
  });

  it('refreshes on demand', async () => {
    render(<RadarTab />);
    await screen.findByText('Healthy');

    const refreshButton = screen.getByRole('button', { name: 'Refresh Radar' });
    expect(refreshButton).toHaveClass('tactile-button');
    expect(refreshButton).toHaveTextContent('Refresh');
    expect(refreshButton.querySelector('svg')).not.toBeNull();
    fireEvent.click(refreshButton);

    await waitFor(() => expect(refreshRadar).toHaveBeenCalledOnce());
  });

  it('keeps the snapshot visible and prevents repeated refresh while refreshing', async () => {
    let resolveRefresh: ((snapshot: RadarSnapshot) => void) | null = null;
    refreshRadar.mockReturnValue(
      new Promise<RadarSnapshot>((resolve) => {
        resolveRefresh = resolve;
      }),
    );
    render(<RadarTab />);
    await screen.findByText('prod01');

    fireEvent.click(screen.getByRole('button', { name: 'Refresh Radar' }));

    // The accessible name keeps the visible "Refreshing…" while busy (label in name).
    const refreshing = screen.getByRole('button', { name: 'Refreshing… Radar' });
    expect(refreshing).toHaveTextContent('Refreshing…');
    expect(refreshing).toBeDisabled();
    expect(refreshing.querySelector('svg')).toHaveClass('radar-refresh-icon--spinning');
    expect(screen.getByText('TRANSACTION.MEMBERSHIPS.ERROR.QUEUE')).toBeInTheDocument();
    fireEvent.click(refreshing);
    expect(refreshRadar).toHaveBeenCalledOnce();

    await act(async () => {
      resolveRefresh?.(snapshotWith());
    });
    await waitFor(() => expect(refreshing).not.toBeDisabled());
  });

  it('keeps retained data visible while offering sign-in recovery', async () => {
    getRadarSnapshot.mockResolvedValue(
      snapshotWith({
        color: 'green',
        signInRequired: true,
      }),
    );
    render(<RadarTab />);

    expect(await screen.findByText('Stale')).toBeInTheDocument();
    expect(screen.getByText('prod01')).toBeInTheDocument();
    expect(screen.getByText('TRANSACTION.MEMBERSHIPS.ERROR.QUEUE')).toBeInTheDocument();

    // A labelled section, not a live region holding a button; the persistent output announces.
    const notice = screen.getByRole('region', { name: 'CW Dashboard sign-in' });
    expect(notice.closest('output, [role="status"]')).toBeNull();
    expect(
      screen.getByText('CW Dashboard session expired. Sign in to refresh Radar.').tagName,
    ).toBe('OUTPUT');

    const signIn = within(notice).getByRole('button', { name: 'Sign In to CW Dashboard' });
    fireEvent.click(signIn);
    await waitFor(() => expect(openRadarSignIn).toHaveBeenCalledOnce());
  });

  it('directs Relay Web users to recover the server session without an inert sign-in button', async () => {
    getRadarSnapshot.mockResolvedValue(
      snapshotWith({
        color: 'green',
        signInRequired: true,
      }),
    );
    Object.defineProperty(globalThis, 'api', {
      configurable: true,
      writable: true,
      value: { ...globalThis.api, runtime: WEB_RUNTIME },
    });

    render(<RadarTab />);

    expect(
      await screen.findByText(
        "The Relay server PC's CW Dashboard session has expired. Open Relay Desktop on the server PC, sign in to CW Dashboard there, then refresh Radar.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Sign In to CW Dashboard' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'CW Dashboard session expired on the Relay server PC. Sign in there to refresh Radar.',
      ).tagName,
    ).toBe('OUTPUT');
  });

  it('turns a DNS failure into operator guidance while preserving technical details', async () => {
    getRadarSnapshot.mockResolvedValue(snapshotWith({ error: 'net::ERR_NAME_NOT_RESOLVED' }));
    render(<RadarTab />);

    const notice = await screen.findByRole('region', { name: /Radar refresh failed/ });
    expect(notice).toHaveTextContent('Relay could not find the Radar server');
    expect(notice).toHaveTextContent('trusted network or VPN');
    expect(notice).toHaveTextContent('Last good data from');
    expect(notice).toHaveTextContent(', shown below.');
    expect(screen.getByText('Technical details').closest('details')).toHaveTextContent(
      'net::ERR_NAME_NOT_RESOLVED',
    );
  });

  it('uses actionable generic guidance for an unfamiliar Radar failure', async () => {
    getRadarSnapshot.mockResolvedValue(snapshotWith({ error: 'upstream reset by gateway' }));
    render(<RadarTab />);

    const notice = await screen.findByRole('region', { name: /Radar refresh failed/ });
    expect(notice).toHaveTextContent('Relay could not refresh Radar');
    // One retry instruction: the cause sentence never adds its own "then refresh / try again".
    expect(notice).toHaveTextContent('Use Refresh above to try now.');
    expect(notice).not.toHaveTextContent(/then (refresh|try again)/);
    expect(screen.getByText('Technical details').closest('details')).toHaveTextContent(
      'upstream reset by gateway',
    );
  });

  it('replaces the empty board with one unavailable block when nothing has loaded', async () => {
    const failingSince = Date.parse('2026-07-28T19:05:00Z');
    getRadarSnapshot.mockResolvedValue(
      snapshotWith({
        color: 'unknown',
        dispatchers: [],
        lastUpdated: 0,
        error: 'ECONNREFUSED',
        failingSince,
      }),
    );
    const { container } = render(<RadarTab />);

    const block = await screen.findByRole('region', { name: 'Radar unavailable' });
    expect(screen.getByText('No Radar data has loaded and refreshes are failing.').tagName).toBe(
      'OUTPUT',
    );
    expect(block).toHaveTextContent('The Radar server refused the connection');
    expect(block).toHaveTextContent(`Failing since ${formatOpsTime(failingSince)}.`);
    expect(block).toHaveTextContent('Relay retries automatically every minute.');
    expect(block).not.toHaveTextContent(/retained|last good data/i);
    expect(screen.getAllByText(/unavailable/i)).toHaveLength(1);
    expect(container.querySelector('.radar-overall')).toBeNull();
    // The five empty modules give way to the single block.
    expect(container.querySelector('.radar-workspace')).toBeNull();
    // Open Radar stays a normal secondary button: the live dashboard is still a way in.
    expect(screen.getByRole('button', { name: 'Open Radar' })).toHaveClass(
      'tactile-button--secondary',
    );
    expect(block).toHaveTextContent('Use Refresh above to try now.');
    expect(screen.queryByRole('region', { name: 'XCenter counts' })).not.toBeInTheDocument();
    expect(screen.queryByText('No dispatcher data yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
    expect(screen.queryByText('Stale')).not.toBeInTheDocument();
    expect(screen.getByText('Technical details').closest('details')).toHaveTextContent(
      'ECONNREFUSED',
    );

    // The command bar's Refresh stays put as the page's only refresh; the block points to it.
    expect(screen.getAllByRole('button', { name: /refresh/i })).toHaveLength(1);
    const refresh = screen.getByRole('button', { name: 'Refresh Radar' });
    expect(refresh.closest('.radar-unavailable')).toBeNull();
    expect(refresh.closest('[role="toolbar"]')).not.toBeNull();
    fireEvent.click(refresh);
    await waitFor(() => expect(refreshRadar).toHaveBeenCalledOnce());
  });

  it('keeps the full board and says how long refreshes have failed when stale data exists', async () => {
    const failingSince = Date.parse('2026-07-28T19:05:00Z');
    getRadarSnapshot.mockResolvedValue(snapshotWith({ error: 'ECONNREFUSED', failingSince }));
    render(<RadarTab />);

    const notice = await screen.findByRole('region', { name: /Radar refresh failed/ });
    expect(notice).toHaveTextContent(`Failing since ${formatOpsTime(failingSince)}.`);
    expect(screen.getByRole('region', { name: 'XCenter counts' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Refresh Radar' })).toHaveLength(1);
    expect(document.querySelector('.radar-unavailable')).toBeNull();
  });

  it('keeps one refresh control and points the failure notice to it', async () => {
    getRadarSnapshot.mockResolvedValue(snapshotWith({ error: 'ECONNREFUSED' }));
    render(<RadarTab />);

    const notice = await screen.findByRole('region', { name: /Radar refresh failed/ });
    expect(notice).toHaveTextContent('Use Refresh above to try now.');
    expect(screen.getAllByRole('button', { name: /refresh|retry/i })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh Radar' }));

    await waitFor(() => expect(refreshRadar).toHaveBeenCalledOnce());
  });

  it('shows a placeholder rather than a zero before the first reading', async () => {
    getRadarSnapshot.mockResolvedValue(
      snapshotWith({
        color: 'unknown',
        dispatchers: [],
        papa: [],
        metrics: [],
        xcenter: { ok: null, pending: null },
        currentTime: null,
        lastUpdated: 0,
      }),
    );
    render(<RadarTab />);

    expect(await screen.findByText('Waiting for data')).toBeInTheDocument();
    const xcenter = screen.getByRole('region', { name: 'XCenter counts' });
    expect(within(xcenter).getAllByText('—')).toHaveLength(2);
    const papa = screen.getByRole('region', { name: 'PaPA Processor Service' });
    expect(papa).toHaveTextContent('No PaPA data');
    expect(screen.getByRole('region', { name: 'Service metrics' })).toHaveTextContent(
      'No service data',
    );
    expect(screen.getByRole('region', { name: 'Dashboard timing' })).toHaveTextContent(
      'Dashboard clock—',
    );
    expect(screen.getByText('No dispatcher data yet')).toBeInTheDocument();
    expect(screen.queryByText(/^Updated /)).not.toBeInTheDocument();
  });

  it('rebuilds the dispatchers, their queues and the board clock', async () => {
    render(<RadarTab />);

    expect(await screen.findByText('prod01')).toBeInTheDocument();
    expect(screen.getByText('prod02')).toBeInTheDocument();
    expect(screen.getByText('TRANSACTION.MEMBERSHIPS.ERROR.QUEUE')).toBeInTheDocument();
    expect(screen.getByText('1,323')).toBeInTheDocument();
    expect(screen.getByText('No queues reported')).toBeInTheDocument();
    expect(screen.getByText(/7\/28\/2026 2:57:01 PM/)).toBeInTheDocument();
  });

  it('shows the PaPA message types and the service metrics', async () => {
    render(<RadarTab />);

    expect(await screen.findByText('READY')).toBeInTheDocument();
    expect(screen.getByText('UNACKED')).toBeInTheDocument();
    expect(screen.getByText('Order API Counts')).toBeInTheDocument();
    expect(screen.getByText('6,063')).toBeInTheDocument();
  });

  /** The EDW row carries only a colour, so its tone has to stand in for a value. */
  it('labels a colour-only metric with its state instead of a blank', async () => {
    render(<RadarTab />);

    const edw = await screen.findByText('EDW Daily Load Date Status');
    expect(edw.closest('li')).toHaveTextContent('Warning');
  });

  it('pairs every service tone with an accessible status word', async () => {
    render(<RadarTab />);

    expect(
      await screen.findByRole('listitem', { name: 'Order API Counts — Healthy: 6,063' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('listitem', { name: 'EDW Daily Load Date Status — Warning' }),
    ).toBeInTheDocument();
  });

  it('keeps a complete long queue name available while allowing visual truncation', async () => {
    const queueName = 'TRANSACTION.MEMBERSHIPS.RECONCILIATION.EXCEPTION.RETRY.DEAD.LETTER.QUEUE';
    getRadarSnapshot.mockResolvedValue(
      snapshotWith({
        dispatchers: [
          {
            name: 'prod01',
            tone: 'yellow',
            lastScheduleDate: 'x',
            lastPubSubDate: 'y',
            queues: [{ name: queueName, depth: 12534 }],
          },
        ],
      }),
    );
    render(<RadarTab />);

    const name = await screen.findByText(queueName);
    expect(name).not.toHaveAttribute('title');
    expect(name).toHaveAttribute('tabindex', '0');
    fireEvent.focus(name);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(queueName);
    expect(screen.getByText('12,534')).not.toHaveAttribute('data-radar-tone');
  });
});
