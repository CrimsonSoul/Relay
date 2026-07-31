import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RadarSnapshot } from '@shared/ipc';
import { ELECTRON_RUNTIME, WEB_RUNTIME } from '@shared/runtime';
import { RadarTab } from '../RadarTab';

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
    render(<RadarTab />);

    expect(await screen.findByText('Healthy')).toBeInTheDocument();
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

    expect(await screen.findByText('Stale')).toBeInTheDocument();
    expect(container.querySelector('.radar-overall')).toHaveAttribute('data-radar-tone', 'unknown');
    expect(screen.getByText('prod01')).toBeInTheDocument();
    expect(screen.getByText('TRANSACTION.MEMBERSHIPS.ERROR.QUEUE')).toBeInTheDocument();
    expect(screen.getByText(/ECONNREFUSED/)).toHaveTextContent('stale');
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

  it('opens the canonical original Radar page through the secure external action', async () => {
    render(<RadarTab />);

    const button = await screen.findByRole('button', {
      name: 'Open original Dispatcher Radar page',
    });
    expect(button).toHaveTextContent('OPEN ORIGINAL');
    expect(button).toHaveAttribute('title', 'Open original Dispatcher Radar page');
    expect(button).toHaveClass('tactile-button--secondary', 'radar-header-action');

    fireEvent.click(button);

    expect(openExternal).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith('https://cw-intra-web/CWDashboard/Home/Radar');
  });

  it('refreshes on demand', async () => {
    render(<RadarTab />);
    await screen.findByText('Healthy');

    const refreshButton = screen.getByRole('button', { name: 'Refresh Radar now' });
    expect(refreshButton).toHaveClass('radar-refresh');
    expect(refreshButton).not.toHaveClass('tactile-button');
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

    fireEvent.click(screen.getByRole('button', { name: 'Refresh Radar now' }));

    const refreshing = screen.getByRole('button', { name: 'Refresh Radar now' });
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

    const signIn = screen.getByRole('button', { name: 'Sign in to CW Dashboard' });
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
      screen.queryByRole('button', { name: 'Sign in to CW Dashboard' }),
    ).not.toBeInTheDocument();
  });

  it('surfaces a fetch failure instead of presenting stale counts as live', async () => {
    getRadarSnapshot.mockResolvedValue(snapshotWith({ error: 'ECONNREFUSED' }));
    render(<RadarTab />);

    expect(await screen.findByText(/ECONNREFUSED/)).toBeInTheDocument();
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

    expect(await screen.findByText('Unknown')).toBeInTheDocument();
    const xcenter = screen.getByRole('region', { name: 'XCenter counts' });
    expect(within(xcenter).getAllByText('—')).toHaveLength(2);
    expect(screen.getByRole('region', { name: 'PaPA Processor Service' })).toHaveTextContent(
      'No PaPA data',
    );
    expect(screen.getByRole('region', { name: 'Service metrics' })).toHaveTextContent(
      'No service data',
    );
    expect(screen.getByRole('region', { name: 'Dashboard timing' })).toHaveTextContent(
      'Dashboard clock—',
    );
    expect(screen.getByText('Radar snapshot unavailable')).toBeInTheDocument();
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

    expect(await screen.findByText(queueName)).toHaveAttribute('title', queueName);
    expect(screen.getByText('12,534')).not.toHaveAttribute('data-radar-tone');
  });
});
