import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DynatraceProblemRecord } from '@shared/dynatraceProblems';
import { DynatraceProblemNotificationManager } from '../DynatraceProblemNotificationManager';

const mocks = vi.hoisted(() => ({
  collection: { data: [] as DynatraceProblemRecord[], loading: false },
  useCollection: vi.fn(),
  showToast: vi.fn(),
  playAlertSound: vi.fn(async () => true),
}));

vi.mock('../../hooks/useCollection', () => ({
  useCollection: (...args: unknown[]) => {
    mocks.useCollection(...args);
    return { ...mocks.collection, error: null, refetch: vi.fn() };
  },
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

describe('DynatraceProblemNotificationManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.collection = { data: [], loading: false };
    globalThis.api = { playAlertSound: mocks.playAlertSound } as never;
  });

  it('uses the initial collection as a silent notification baseline', () => {
    mocks.collection = { data: [problem()], loading: false };
    render(<DynatraceProblemNotificationManager onOpenProblems={vi.fn()} />);

    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(mocks.playAlertSound).not.toHaveBeenCalled();
    expect(mocks.useCollection).toHaveBeenCalledWith('dynatrace_problems', {
      sort: '-startTime',
      filter: 'scopeExcluded=false && status="OPEN"',
    });
  });

  it('toasts, sounds once, and exposes an action for a newly arriving open problem', async () => {
    const onOpenProblems = vi.fn();
    const { rerender } = render(
      <DynatraceProblemNotificationManager onOpenProblems={onOpenProblems} />,
    );
    mocks.collection = { data: [problem()], loading: false };
    rerender(<DynatraceProblemNotificationManager onOpenProblems={onOpenProblems} />);

    await waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalledOnce();
      expect(mocks.playAlertSound).toHaveBeenCalledOnce();
    });
    expect(mocks.showToast).toHaveBeenCalledWith(
      'P-1001 · Checkout service unavailable',
      'error',
      expect.objectContaining({
        title: 'New Dynatrace problem',
        durationMs: 8_000,
        delivery: 'dynatrace-problem',
      }),
    );

    const options = mocks.showToast.mock.calls[0]?.[2];
    options?.action?.onClick();
    expect(onOpenProblems).toHaveBeenCalledOnce();
  });
  it('uses the NOC workflow name when enriched metadata is available', async () => {
    const onOpenProblems = vi.fn();
    const { rerender } = render(
      <DynatraceProblemNotificationManager onOpenProblems={onOpenProblems} />,
    );
    mocks.collection = {
      data: [problem({ workflowTitle: 'NOC · Checkout unavailable' })],
      loading: false,
    };
    rerender(<DynatraceProblemNotificationManager onOpenProblems={onOpenProblems} />);

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledOnce());
    expect(mocks.showToast).toHaveBeenCalledWith(
      'P-1001 · NOC · Checkout unavailable',
      'error',
      expect.objectContaining({ delivery: 'dynatrace-problem' }),
    );
  });

  it.each([
    ['AVAILABILITY', 'error'],
    ['MONITORING_UNAVAILABLE', 'error'],
    ['ERROR', 'error'],
    ['PERFORMANCE', 'warning'],
    ['RESOURCE_CONTENTION', 'warning'],
    ['CUSTOM_ALERT', 'warning'],
    ['INFO', 'warning'],
  ] as const)('notifies for a newly opened %s problem', async (severity, toastType) => {
    const onOpenProblems = vi.fn();
    const { rerender } = render(
      <DynatraceProblemNotificationManager onOpenProblems={onOpenProblems} />,
    );

    mocks.collection = {
      data: [problem({ problemId: `PROBLEM-${severity}`, severity })],
      loading: false,
    };
    rerender(<DynatraceProblemNotificationManager onOpenProblems={onOpenProblems} />);

    await waitFor(() => expect(mocks.showToast).toHaveBeenCalledOnce());
    expect(mocks.showToast).toHaveBeenCalledWith(
      'P-1001 · Checkout service unavailable',
      toastType,
      expect.objectContaining({ delivery: 'dynatrace-problem' }),
    );
  });

  it('does not notify for a newly synchronized closed problem or repeat a seen problem', async () => {
    const onOpenProblems = vi.fn();
    const { rerender } = render(
      <DynatraceProblemNotificationManager onOpenProblems={onOpenProblems} />,
    );

    mocks.collection = {
      data: [problem({ problemId: 'CLOSED-1', status: 'CLOSED', endTime: Date.now() })],
      loading: false,
    };
    rerender(<DynatraceProblemNotificationManager onOpenProblems={onOpenProblems} />);
    mocks.collection = { data: [problem()], loading: false };
    rerender(<DynatraceProblemNotificationManager onOpenProblems={onOpenProblems} />);
    rerender(<DynatraceProblemNotificationManager onOpenProblems={onOpenProblems} />);

    await waitFor(() => {
      expect(mocks.showToast).toHaveBeenCalledOnce();
      expect(mocks.playAlertSound).toHaveBeenCalledOnce();
    });
  });
});
