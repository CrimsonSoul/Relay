import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockGetFullList = vi.fn();

vi.mock('./pocketbase', () => ({
  getPb: () => ({
    collection: () => ({
      create: mockCreate,
      update: mockUpdate,
      getFullList: mockGetFullList,
    }),
  }),
  handleApiError: vi.fn(),
  requireOnline: vi.fn(),
  getConnectionState: vi.fn(() => 'online'),
  escapeFilter: (value: string) => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"'),
}));

import {
  addAlertReminder,
  dismissAlertReminder,
  listDueAlertReminders,
  markAlertReminderDone,
  snoozeAlertReminder,
  updateAlertReminder,
  type AlertReminderInput,
  type AlertReminderRecord,
} from './alertReminderService';
import { getConnectionState, handleApiError, requireOnline } from './pocketbase';
import type { OperatorAttribution } from '@shared/operators';

const mockHandleApiError = vi.mocked(handleApiError);
const mockRequireOnline = vi.mocked(requireOnline);
const mockGetConnectionState = vi.mocked(getConnectionState);

const sampleRecord: AlertReminderRecord = {
  id: 'rem-1',
  title: 'Send outage alert',
  note: 'Use the prepared template',
  dueAt: '2026-05-28T20:00:00.000Z',
  status: 'pending',
  snoozeUntil: '',
  severity: 'ISSUE',
  alertSubject: 'POS outage',
  alertBodyHtml: '<p>Details</p>',
  operatorId: 'operator-ryan',
  createdBy: 'Ryan Bell',
  alertSender: 'IT',
  completedAt: '',
  dismissedAt: '',
  created: '2026-05-28T19:00:00.000Z',
  updated: '2026-05-28T19:00:00.000Z',
};

const sampleInput: AlertReminderInput = {
  title: 'Send outage alert',
  note: 'Use the prepared template',
  dueAt: '2026-05-28T20:00:00.000Z',
  severity: 'ISSUE',
  alertSubject: 'POS outage',
  alertBodyHtml: '<p>Details</p>',
  alertSender: 'IT',
};

const attribution: OperatorAttribution = {
  operatorId: 'operator-ryan',
  operatorName: 'Ryan Bell',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetConnectionState.mockReturnValue('online');
  globalThis.api = undefined as never;
});

describe('addAlertReminder', () => {
  it('creates a pending reminder with operator attribution separate from its cosmetic sender', async () => {
    mockCreate.mockResolvedValueOnce(sampleRecord);

    const result = await addAlertReminder(sampleInput, attribution);

    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith({
      ...sampleInput,
      note: 'Use the prepared template',
      status: 'pending',
      operatorId: 'operator-ryan',
      createdBy: 'Ryan Bell',
    });
    expect(result).toEqual(sampleRecord);
  });

  it('omits unset optional date fields so PocketBase does not reject empty dates', async () => {
    mockCreate.mockResolvedValueOnce(sampleRecord);

    await addAlertReminder(sampleInput, attribution);

    const payload = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('snoozeUntil');
    expect(payload).not.toHaveProperty('completedAt');
    expect(payload).not.toHaveProperty('dismissedAt');
  });

  it('handles and rethrows creation failures', async () => {
    const error = new Error('create failed');
    mockCreate.mockRejectedValueOnce(error);

    await expect(addAlertReminder(sampleInput, attribution)).rejects.toThrow('create failed');
    expect(mockHandleApiError).toHaveBeenCalledWith(error);
  });

  it('queues operator attribution and the independent cosmetic sender while offline', async () => {
    mockGetConnectionState.mockReturnValue('offline');
    const queuedRecord = {
      ...sampleRecord,
      alertSender: 'Network Operations',
    };
    const mutateOffline = vi.fn().mockResolvedValue({
      ok: true,
      mutationId: 'mutation-reminder-1',
      collection: 'alert_reminders',
      action: 'create',
      record: queuedRecord,
      pendingCount: 1,
    });
    globalThis.api = { mutateOffline } as never;

    await addAlertReminder({ ...sampleInput, alertSender: '  Network Operations  ' }, attribution);

    expect(mutateOffline).toHaveBeenCalledWith({
      collection: 'alert_reminders',
      action: 'create',
      data: {
        title: 'Send outage alert',
        note: 'Use the prepared template',
        dueAt: '2026-05-28T20:00:00.000Z',
        status: 'pending',
        severity: 'ISSUE',
        alertSubject: 'POS outage',
        alertBodyHtml: '<p>Details</p>',
        operatorId: 'operator-ryan',
        createdBy: 'Ryan Bell',
        alertSender: 'Network Operations',
      },
    });
  });
});

describe('listDueAlertReminders', () => {
  it('queries pending reminders due by the provided time', async () => {
    mockGetFullList.mockResolvedValueOnce([sampleRecord]);

    const result = await listDueAlertReminders(new Date('2026-05-28T20:01:00.000Z'));

    expect(mockGetFullList).toHaveBeenCalledWith({
      sort: 'snoozeUntil,dueAt,created',
      filter:
        'status = "pending" && ((snoozeUntil != "" && snoozeUntil <= "2026-05-28T20:01:00.000Z") || (snoozeUntil = "" && dueAt <= "2026-05-28T20:01:00.000Z"))',
      requestKey: null,
    });
    expect(result).toEqual([sampleRecord]);
  });
});

describe('snoozeAlertReminder', () => {
  it('keeps the reminder pending and updates snoozeUntil', async () => {
    const snoozed = { ...sampleRecord, snoozeUntil: '2026-05-28T20:11:00.000Z' };
    mockUpdate.mockResolvedValueOnce(snoozed);

    const result = await snoozeAlertReminder('rem-1', '2026-05-28T20:11:00.000Z');

    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledWith('rem-1', {
      status: 'pending',
      snoozeUntil: '2026-05-28T20:11:00.000Z',
    });
    expect(result).toEqual(snoozed);
  });
});

describe('updateAlertReminder', () => {
  it('updates editable fields, keeps the reminder pending, and clears snoozeUntil', async () => {
    const updated = {
      ...sampleRecord,
      title: 'Updated reminder',
      note: 'Updated note',
      dueAt: '2026-05-28T21:00:00.000Z',
      snoozeUntil: '',
    };
    mockUpdate.mockResolvedValueOnce(updated);

    const result = await updateAlertReminder('rem-1', {
      title: ' Updated reminder ',
      note: ' Updated note ',
      dueAt: '2026-05-28T21:00:00.000Z',
    });

    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledWith('rem-1', {
      title: 'Updated reminder',
      note: 'Updated note',
      dueAt: '2026-05-28T21:00:00.000Z',
      status: 'pending',
      snoozeUntil: '',
    });
    expect(result).toEqual(updated);
  });
});

describe('markAlertReminderDone', () => {
  it('marks the reminder done with a completion timestamp', async () => {
    const done = {
      ...sampleRecord,
      status: 'done' as const,
      completedAt: '2026-05-28T20:02:00.000Z',
    };
    mockUpdate.mockResolvedValueOnce(done);

    const result = await markAlertReminderDone('rem-1', new Date('2026-05-28T20:02:00.000Z'));

    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledWith('rem-1', {
      status: 'done',
      completedAt: '2026-05-28T20:02:00.000Z',
    });
    expect(result).toEqual(done);
  });
});

describe('dismissAlertReminder', () => {
  it('dismisses the reminder with a dismissal timestamp', async () => {
    const dismissed = {
      ...sampleRecord,
      status: 'dismissed' as const,
      dismissedAt: '2026-05-28T20:03:00.000Z',
    };
    mockUpdate.mockResolvedValueOnce(dismissed);

    const result = await dismissAlertReminder('rem-1', new Date('2026-05-28T20:03:00.000Z'));

    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledWith('rem-1', {
      status: 'dismissed',
      dismissedAt: '2026-05-28T20:03:00.000Z',
    });
    expect(result).toEqual(dismissed);
  });
});
