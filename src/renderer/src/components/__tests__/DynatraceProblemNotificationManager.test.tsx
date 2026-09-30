import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DynatraceProblemRecord } from '@shared/dynatraceProblems';
import { DynatraceProblemNotificationManager } from '../DynatraceProblemNotificationManager';

const mocks = vi.hoisted(() => ({
  collection: { data: [] as DynatraceProblemRecord[], loading: false },
  showToast: vi.fn(),
  playAlertSound: vi.fn(async () => true),
}));

vi.mock('../../hooks/useCollection', () => ({
  useCollection: () => ({ ...mocks.collection, error: null, refetch: vi.fn() }),
}));

vi.mock('../Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}));

const problem = (overrides: Partial<DynatraceProblemRecord> = {}): DynatraceProblemRecord => ({
  id: 'record-1',
  problemId: 'PROBLEM-1',
  displayId: 'P-1001',
  title: 'Checkout service unavailable',
  status: 'OPEN',
  severity: 'AVAILABILITY',
  impactLevel: 'SERVICES',
  startTime: Date.now(),
  endTime: -1,
  rootCauseName: 'checkout-api',
  affectedEntities: [],
  impactedEntities: [],
  managementZones: [],
  alertingProfiles: [],
  environmentUrl: 'https://abc123.live.dynatrace.com',
  syncedAt: new Date().toISOString(),
  ...overrides,
});

function setup() {
  const onOpenProblems = vi.fn();
  const view = render(<DynatraceProblemNotificationManager onOpenProblems={onOpenProblems} />);
  return {
    ...view,
    onOpenProblems,
    update(data: DynatraceProblemRecord[]) {
      mocks.collection = { data, loading: false };
      view.rerender(<DynatraceProblemNotificationManager onOpenProblems={onOpenProblems} />);
    },
  };
}

async function advance(ms: number) {
  await act(async () => vi.advanceTimersByTimeAsync(ms));
}

const namedProblem = (overrides: Partial<DynatraceProblemRecord> = {}) =>
  problem({
    notificationTitle: 'Workflow email subject',
    notificationStatus: 'OPEN',
    ...overrides,
  });

function expectMessage(title: string) {
  expect(mocks.showToast).toHaveBeenCalledWith(
    `P-1001 · ${title}`,
    expect.any(String),
    expect.anything(),
  );
}

describe('DynatraceProblemNotificationManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.collection = { data: [], loading: false };
    globalThis.api = { playAlertSound: mocks.playAlertSound } as never;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('keeps the initial collection silent even when its names arrive later', async () => {
    mocks.collection = { data: [problem()], loading: false };
    const view = setup();
    view.update([namedProblem()]);
    await advance(90_000);
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(mocks.playAlertSound).not.toHaveBeenCalled();
  });

  it('delivers an already named problem once with its action and sound', async () => {
    const view = setup();
    view.update([namedProblem()]);
    await advance(250);
    expectMessage('Workflow email subject');
    expect(mocks.showToast).toHaveBeenCalledOnce();
    expect(mocks.playAlertSound).toHaveBeenCalledOnce();
    mocks.showToast.mock.calls[0]?.[2]?.action?.onClick();
    expect(view.onOpenProblems).toHaveBeenCalledOnce();
    view.update([namedProblem({ notificationTitle: 'Later edit' })]);
    await advance(90_000);
    expect(mocks.showToast).toHaveBeenCalledOnce();
  });

  it.each([100, 1_000, 70_000])('uses a workflow name arriving after %i ms', async (delay) => {
    const view = setup();
    view.update([problem()]);
    await advance(delay);
    expect(mocks.showToast).not.toHaveBeenCalled();
    view.update([namedProblem()]);
    await advance(250);
    expectMessage('Workflow email subject');
    expect(mocks.showToast).toHaveBeenCalledOnce();
    expect(mocks.playAlertSound).toHaveBeenCalledOnce();
  });

  it.each([
    { notificationTitle: undefined, notificationStatus: undefined },
    { notificationTitle: 'Closed workflow subject', notificationStatus: 'CLOSED' as const },
    { notificationTitle: '   ', notificationStatus: 'OPEN' as const },
  ])('falls back once when no matching subject arrives: %j', async (metadata) => {
    const view = setup();
    view.update([problem(metadata)]);
    await advance(89_999);
    expect(mocks.showToast).not.toHaveBeenCalled();
    await advance(1);
    expectMessage('Checkout service unavailable');
    view.update([namedProblem()]);
    await advance(90_000);
    expect(mocks.showToast).toHaveBeenCalledOnce();
  });

  it('uses the latest fallback data without extending the original deadline', async () => {
    const view = setup();
    view.update([problem()]);
    await advance(60_000);
    view.update([problem({ workflowTitle: 'Updated event name' })]);
    await advance(30_000);
    expectMessage('Updated event name');
    expect(mocks.showToast).toHaveBeenCalledOnce();
  });

  it.each(['removed', 'closed', 'excluded'])(
    'drops a pending problem when it is %s',
    async (state) => {
      const view = setup();
      view.update([problem()]);
      await advance(1_000);
      view.update(
        state === 'removed'
          ? []
          : [problem(state === 'closed' ? { status: 'CLOSED' } : { scopeExcluded: true })],
      );
      await advance(90_000);
      expect(mocks.showToast).not.toHaveBeenCalled();
      expect(mocks.playAlertSound).not.toHaveBeenCalled();
    },
  );

  it('batches new problems and uses the highest-priority problem’s enriched name', async () => {
    const view = setup();
    const other = namedProblem({ problemId: 'PROBLEM-2', severity: 'PERFORMANCE' });
    view.update([problem(), other]);
    await advance(1_000);
    expect(mocks.showToast).not.toHaveBeenCalled();
    view.update([namedProblem(), other]);
    await advance(250);
    expectMessage('Workflow email subject (+1 more)');
    expect(mocks.showToast).toHaveBeenCalledOnce();
    expect(mocks.playAlertSound).toHaveBeenCalledOnce();
  });

  it('does not let additional arrivals postpone a pending batch indefinitely', async () => {
    const view = setup();
    view.update([problem()]);
    await advance(60_000);
    view.update([problem(), problem({ problemId: 'PROBLEM-2', severity: 'INFO' })]);
    await advance(30_000);
    expectMessage('Checkout service unavailable (+1 more)');
    expect(mocks.showToast).toHaveBeenCalledOnce();
  });

  it.each([
    ['AVAILABILITY', 'error'],
    ['MONITORING_UNAVAILABLE', 'error'],
    ['ERROR', 'error'],
    ['PERFORMANCE', 'warning'],
    ['RESOURCE_CONTENTION', 'warning'],
    ['CUSTOM_ALERT', 'warning'],
    ['INFO', 'warning'],
  ] as const)('preserves alert priority for %s problems', async (severity, toastType) => {
    const view = setup();
    view.update([namedProblem({ severity })]);
    await advance(250);
    expect(mocks.showToast).toHaveBeenCalledWith(
      expect.any(String),
      toastType,
      expect.objectContaining({ delivery: 'dynatrace-problem' }),
    );
  });

  it('cancels pending delivery on unmount', async () => {
    const view = setup();
    view.update([problem()]);
    view.unmount();
    await advance(90_000);
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(mocks.playAlertSound).not.toHaveBeenCalled();
  });
});
