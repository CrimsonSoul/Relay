import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RadarSnapshot } from '@shared/ipc';
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

beforeEach(() => {
  listener = null;
  getRadarSnapshot.mockClear().mockResolvedValue(snapshotWith());
  refreshRadar.mockClear().mockResolvedValue(snapshotWith());
  openRadarSignIn.mockClear();

  Object.defineProperty(globalThis, 'api', {
    configurable: true,
    writable: true,
    value: {
      getRadarSnapshot,
      refreshRadar,
      openRadarSignIn,
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

  it('refreshes on demand', async () => {
    render(<RadarTab />);
    await screen.findByText('Healthy');

    fireEvent.click(screen.getByRole('button', { name: 'Refresh Radar now' }));

    await waitFor(() => expect(refreshRadar).toHaveBeenCalledOnce());
  });

  it('offers a sign-in when the session has expired', async () => {
    getRadarSnapshot.mockResolvedValue(snapshotWith({ signInRequired: true }));
    render(<RadarTab />);

    const signIn = await screen.findByRole('button', { name: 'Sign in to CW Dashboard' });
    fireEvent.click(signIn);

    await waitFor(() => expect(openRadarSignIn).toHaveBeenCalledOnce());
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
    expect(screen.getAllByText('—')).toHaveLength(2);
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
});
