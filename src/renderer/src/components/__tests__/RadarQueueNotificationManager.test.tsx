import React from 'react';
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RadarSnapshot, RadarStatusColor } from '@shared/ipc';
import {
  RadarQueueNotificationManager,
  readRadarTargetTones,
} from '../RadarQueueNotificationManager';

const mocks = vi.hoisted(() => ({
  snapshot: null as RadarSnapshot | null,
  showToast: vi.fn(),
  playAlertSound: vi.fn(async () => true),
}));

vi.mock('../../hooks/useRadarSnapshot', () => ({
  useRadarSnapshot: () => ({
    snapshot: mocks.snapshot,
    refreshing: false,
    refresh: vi.fn(),
    signIn: vi.fn(),
  }),
}));

vi.mock('../Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));

type SnapshotOptions = {
  prod01?: RadarStatusColor | null;
  prod02?: RadarStatusColor | null;
  email?: RadarStatusColor | null;
  lastUpdated?: number;
  signInRequired?: boolean;
  error?: string | null;
};

function snapshotWith({
  prod01 = 'green',
  prod02 = 'green',
  email = 'green',
  lastUpdated = 1,
  signInRequired = false,
  error = null,
}: SnapshotOptions = {}): RadarSnapshot {
  return {
    color: 'green',
    dispatchers: [
      ...(prod01 === null
        ? []
        : [
            {
              name: 'prod01',
              tone: prod01,
              lastScheduleDate: '',
              lastPubSubDate: '',
              queues: [],
            },
          ]),
      ...(prod02 === null
        ? []
        : [
            {
              name: 'prod02',
              tone: prod02,
              lastScheduleDate: '',
              lastPubSubDate: '',
              queues: [],
            },
          ]),
    ],
    papa: [],
    metrics:
      email === null
        ? []
        : [{ label: 'Transactional Emails Queue Depth', value: '0', tone: email }],
    xcenter: { ok: 2_000, pending: 1_807 },
    currentTime: null,
    lastUpdated,
    signInRequired,
    error,
  };
}

describe('RadarQueueNotificationManager', () => {
  const onOpenRadar = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.snapshot = snapshotWith();
    globalThis.api = { playAlertSound: mocks.playAlertSound } as never;
  });

  it('uses an initially red snapshot as a silent baseline', () => {
    mocks.snapshot = snapshotWith({ prod01: 'red' });

    render(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);

    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(mocks.playAlertSound).not.toHaveBeenCalled();
  });

  it('waits for the first usable snapshot before establishing the silent baseline', () => {
    mocks.snapshot = snapshotWith({ prod01: 'red', lastUpdated: 0 });
    const view = render(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);

    mocks.snapshot = snapshotWith({ prod01: 'red', lastUpdated: 1 });
    view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);

    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it.each([
    ['Prod01', { prod01: 'red' as const }],
    ['Prod02', { prod02: 'red' as const }],
    ['Transactional Emails Queue Depth', { email: 'red' as const }],
  ])('notifies when %s transitions to red', (label, targetOverride) => {
    const view = render(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
    mocks.snapshot = snapshotWith({ ...targetOverride, lastUpdated: 2 });

    view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);

    expect(mocks.showToast).toHaveBeenCalledWith(
      `${label} is red on Dispatcher Radar.`,
      'error',
      expect.objectContaining({
        title: 'Radar queue critical',
        durationMs: 8_000,
        delivery: 'radar-critical',
      }),
    );
  });

  it('batches simultaneous red transitions in one ordered toast', () => {
    const view = render(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
    mocks.snapshot = snapshotWith({
      prod01: 'red',
      prod02: 'red',
      email: 'red',
      lastUpdated: 2,
    });

    view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);

    expect(mocks.showToast).toHaveBeenCalledOnce();
    expect(mocks.showToast).toHaveBeenCalledWith(
      'Prod01, Prod02, and Transactional Emails Queue Depth are red on Dispatcher Radar.',
      'error',
      expect.objectContaining({
        title: 'Radar queues critical',
        durationMs: 8_000,
        delivery: 'radar-critical',
      }),
    );
  });

  it('re-arms only after an explicit non-red tone', () => {
    const view = render(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);

    mocks.snapshot = snapshotWith({ prod01: 'red', lastUpdated: 2 });
    view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
    expect(mocks.showToast).toHaveBeenCalledTimes(1);

    mocks.snapshot = snapshotWith({ prod01: 'red', lastUpdated: 3 });
    view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
    mocks.snapshot = snapshotWith({ prod01: null, lastUpdated: 4 });
    view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
    mocks.snapshot = snapshotWith({ prod01: 'red', lastUpdated: 5 });
    view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
    expect(mocks.showToast).toHaveBeenCalledTimes(1);

    mocks.snapshot = snapshotWith({ prod01: 'green', lastUpdated: 6 });
    view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
    mocks.snapshot = snapshotWith({ prod01: 'red', lastUpdated: 7 });
    view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
    expect(mocks.showToast).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['an uninitialized snapshot', { lastUpdated: 0 }],
    ['a sign-in-required snapshot', { signInRequired: true }],
    ['an errored snapshot', { error: 'ECONNREFUSED' }],
  ] as const)('ignores %s without resetting transition state', (_label, unusableOverride) => {
    const view = render(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);

    mocks.snapshot = snapshotWith({
      prod01: 'red',
      lastUpdated: 2,
      ...unusableOverride,
    });
    view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
    expect(mocks.showToast).not.toHaveBeenCalled();

    mocks.snapshot = snapshotWith({ prod01: 'red', lastUpdated: 3 });
    view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
    expect(mocks.showToast).toHaveBeenCalledOnce();
  });

  it('matches the supported target aliases case-insensitively', () => {
    const snapshot = snapshotWith();
    snapshot.dispatchers[0]!.name = 'PROD1';
    snapshot.dispatchers[1]!.name = 'Prod02';
    snapshot.metrics[0]!.label = 'transactional EMAILS queue DEPTH';

    expect([...readRadarTargetTones(snapshot)]).toEqual([
      ['prod01', 'green'],
      ['prod02', 'green'],
      ['transactionalEmails', 'green'],
    ]);
  });

  it('opens Radar from the toast action without playing a sound', () => {
    const view = render(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);
    mocks.snapshot = snapshotWith({ prod01: 'red', lastUpdated: 2 });
    view.rerender(<RadarQueueNotificationManager onOpenRadar={onOpenRadar} />);

    const options = mocks.showToast.mock.calls[0]?.[2];
    expect(options?.action?.label).toBe('Open Radar');
    options?.action?.onClick();

    expect(onOpenRadar).toHaveBeenCalledOnce();
    expect(mocks.playAlertSound).not.toHaveBeenCalled();
  });
});
