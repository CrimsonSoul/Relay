import type { RecordModel } from 'pocketbase';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertReminderManager } from '../AlertReminderManager';
import { useAlertReminderWorkflow } from '../../tabs/alerts/useAlertReminderWorkflow';
import { resetCollectionStoreRegistry } from '../../stores/collectionStoreRegistry';

type RealtimeEvent = { action: string; record: RecordModel };

const mocked = vi.hoisted(() => {
  const state = {
    records: [] as RecordModel[],
    realtimeListener: null as ((event: RealtimeEvent) => void) | null,
    client: null as unknown,
  };
  state.client = {
    collection: () => ({
      getFullList: async () => state.records,
      subscribe: async (_topic: string, listener: (event: RealtimeEvent) => void) => {
        state.realtimeListener = listener;
        return () => undefined;
      },
    }),
  };
  return state;
});

vi.mock('@renderer/services/pocketbase', () => ({
  getPb: () => mocked.client,
  handleApiError: vi.fn(),
  isOnline: () => true,
  onConnectionStateChange: () => () => undefined,
  getPocketBaseClientGeneration: () => 0,
  onPocketBaseClientChange: () => () => undefined,
}));

vi.mock('../Toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

const HOUR = 60 * 60_000;

function makeReminder(index: number, status: string, dueAt: number): RecordModel {
  return {
    id: `reminder-${String(index).padStart(4, '0')}`,
    collectionId: 'alert-reminders-id',
    collectionName: 'alert_reminders',
    title: `Reminder ${index}`,
    note: '',
    dueAt: new Date(dueAt).toISOString(),
    status,
    snoozeUntil: '',
    severity: '',
    alertSubject: '',
    alertBodyHtml: '',
    completedAt: '',
    dismissedAt: '',
    created: '2026-10-01 00:00:00.000Z',
    updated: '2026-10-01 00:00:00.000Z',
  } as RecordModel;
}

function NextAlarmProbe() {
  const workflow = useAlertReminderWorkflow({ showToast: vi.fn() });
  return (
    <span data-testid="next-alarm">
      {workflow.nextReminder?.title ?? 'none'} +{workflow.additionalReminderCount}
    </span>
  );
}

const flushMicrotasks = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('alert reminder realtime burst', () => {
  beforeEach(() => {
    const now = Date.now();
    mocked.records = Array.from({ length: 500 }, (_, index) => {
      if (index < 163) return makeReminder(index, 'pending', now + (index + 1) * HOUR);
      return makeReminder(index, index % 2 ? 'done' : 'dismissed', now - HOUR);
    });
  });

  afterEach(() => {
    resetCollectionStoreRegistry();
    mocked.realtimeListener = null;
  });

  it('applies a burst of pending reminder updates without a render loop', async () => {
    const uncaught: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      uncaught.push(event.error ?? event.message);
      event.preventDefault();
    };
    globalThis.addEventListener('error', onError);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const view = render(
      <>
        <AlertReminderManager />
        <NextAlarmProbe />
      </>,
    );
    await act(async () => {
      await vi.waitFor(() => expect(mocked.realtimeListener).not.toBeNull());
    });
    expect(view.getByTestId('next-alarm')).toHaveTextContent('Reminder 0 +162');

    const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      const now = Date.now();
      // EventSource dispatches every event in one network chunk back to back:
      // microtasks run between listeners, but no task does.
      for (const [index, record] of mocked.records.slice(0, 163).entries()) {
        mocked.realtimeListener?.({
          action: 'update',
          record: { ...record, dueAt: new Date(now + (200 - index) * HOUR).toISOString() },
        });
        await flushMicrotasks();
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
      globalThis.removeEventListener('error', onError);
    }

    const reported = [
      ...uncaught,
      ...consoleError.mock.calls.flat().filter((arg) => String(arg).includes('Maximum update')),
    ];
    consoleError.mockRestore();
    expect(reported).toEqual([]);
    expect(view.getByTestId('next-alarm')).toHaveTextContent('Reminder 162 +162');
  });
});
