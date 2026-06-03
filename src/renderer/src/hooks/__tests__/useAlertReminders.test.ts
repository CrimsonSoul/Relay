import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const showToast = vi.fn();

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ showToast }),
}));

const mockCollectionData = { current: [] as unknown[] };
const mockRefetch = vi.fn();
const mockUseCollection = vi.fn(() => ({
  data: mockCollectionData.current,
  loading: false,
  error: null,
  refetch: mockRefetch,
}));

vi.mock('../useCollection', () => ({
  useCollection: (...args: unknown[]) => mockUseCollection(...args),
}));

const mockAddAlertReminder = vi.fn();
const mockSnoozeAlertReminder = vi.fn();
const mockMarkAlertReminderDone = vi.fn();
const mockDismissAlertReminder = vi.fn();
const mockUpdateAlertReminder = vi.fn();

vi.mock('../../services/alertReminderService', () => ({
  addAlertReminder: (...args: unknown[]) => mockAddAlertReminder(...args),
  snoozeAlertReminder: (...args: unknown[]) => mockSnoozeAlertReminder(...args),
  markAlertReminderDone: (...args: unknown[]) => mockMarkAlertReminderDone(...args),
  dismissAlertReminder: (...args: unknown[]) => mockDismissAlertReminder(...args),
  updateAlertReminder: (...args: unknown[]) => mockUpdateAlertReminder(...args),
}));

import { useAlertReminders } from '../useAlertReminders';
import type { AlertReminderRecord } from '../../services/alertReminderService';

const makeRecord = (overrides: Partial<AlertReminderRecord> = {}): AlertReminderRecord => ({
  id: 'rem-1',
  title: 'Send alert',
  note: '',
  dueAt: '2026-05-28T20:00:00.000Z',
  status: 'pending',
  snoozeUntil: '',
  severity: 'INFO',
  alertSubject: 'Subject',
  alertBodyHtml: '<p>Body</p>',
  createdBy: 'IT',
  completedAt: '',
  dismissedAt: '',
  created: '2026-05-28T19:00:00.000Z',
  updated: '2026-05-28T19:00:00.000Z',
  ...overrides,
});

describe('useAlertReminders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-28T19:30:00.000Z'));
    mockCollectionData.current = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads reminders from the shared collection sorted by due time', () => {
    mockCollectionData.current = [makeRecord()];

    const { result } = renderHook(() => useAlertReminders());

    expect(mockUseCollection).toHaveBeenCalledWith('alert_reminders', { sort: 'dueAt' });
    expect(result.current.reminders).toHaveLength(1);
    expect(result.current.loading).toBe(false);
  });

  it('returns pending upcoming reminders ordered by effective due time', () => {
    mockCollectionData.current = [
      makeRecord({ id: 'done', status: 'done', dueAt: '2026-05-28T19:40:00.000Z' }),
      makeRecord({ id: 'later', dueAt: '2026-05-28T21:00:00.000Z' }),
      makeRecord({ id: 'soon', dueAt: '2026-05-28T19:45:00.000Z' }),
      makeRecord({ id: 'snoozed', snoozeUntil: '2026-05-28T19:35:00.000Z' }),
      makeRecord({ id: 'past', dueAt: '2026-05-28T19:00:00.000Z' }),
    ];

    const { result } = renderHook(() => useAlertReminders());

    expect(result.current.upcomingReminders.map((r) => r.id)).toEqual(['snoozed', 'soon', 'later']);
  });

  it('returns all pending reminders ordered by effective due time', () => {
    mockCollectionData.current = [
      makeRecord({ id: 'later', dueAt: '2026-05-28T21:00:00.000Z' }),
      makeRecord({ id: 'past', dueAt: '2026-05-28T19:00:00.000Z' }),
      makeRecord({ id: 'dismissed', status: 'dismissed', dueAt: '2026-05-28T18:00:00.000Z' }),
      makeRecord({ id: 'snoozed', snoozeUntil: '2026-05-28T19:35:00.000Z' }),
    ];

    const { result } = renderHook(() => useAlertReminders());

    expect(result.current.pendingReminders.map((r) => r.id)).toEqual(['past', 'snoozed', 'later']);
  });

  it('returns completed reminders newest first', () => {
    mockCollectionData.current = [
      makeRecord({
        id: 'done-old',
        status: 'done',
        completedAt: '2026-05-28T19:10:00.000Z',
      }),
      makeRecord({ id: 'pending', status: 'pending' }),
      makeRecord({
        id: 'dismissed-new',
        status: 'dismissed',
        dismissedAt: '2026-05-28T19:20:00.000Z',
      }),
    ];

    const { result } = renderHook(() => useAlertReminders());

    expect(result.current.completedReminders.map((r) => r.id)).toEqual([
      'dismissed-new',
      'done-old',
    ]);
  });

  it('schedules a reminder and shows confirmation', async () => {
    mockAddAlertReminder.mockResolvedValue(makeRecord({ id: 'created' }));

    const { result } = renderHook(() => useAlertReminders());

    let success = false;
    await act(async () => {
      success = await result.current.scheduleReminder({
        title: 'Send maintenance alert',
        dueAt: '2026-05-28T20:00:00.000Z',
        note: 'Before the window',
      });
    });

    expect(success).toBe(true);
    expect(mockAddAlertReminder).toHaveBeenCalledWith({
      title: 'Send maintenance alert',
      dueAt: '2026-05-28T20:00:00.000Z',
      note: 'Before the window',
    });
    expect(showToast).toHaveBeenCalledWith('Alarm scheduled', 'success');
  });

  it('returns false and shows an error toast when scheduling fails', async () => {
    mockAddAlertReminder.mockRejectedValue(new Error('write failed'));

    const { result } = renderHook(() => useAlertReminders());

    let success = true;
    await act(async () => {
      success = await result.current.scheduleReminder({
        title: 'Send alert',
        dueAt: '2026-05-28T20:00:00.000Z',
      });
    });

    expect(success).toBe(false);
    expect(showToast).toHaveBeenCalledWith('Failed to schedule alarm', 'error');
  });

  it('updates a reminder and shows an error toast on failure', async () => {
    mockUpdateAlertReminder.mockResolvedValueOnce(makeRecord({ id: 'rem-1' }));
    mockUpdateAlertReminder.mockRejectedValueOnce(new Error('update failed'));

    const { result } = renderHook(() => useAlertReminders());

    await act(async () => {
      expect(
        await result.current.updateReminder('rem-1', {
          title: 'Updated',
          note: 'New note',
          dueAt: '2026-05-28T21:00:00.000Z',
        }),
      ).toBe(true);
      expect(
        await result.current.updateReminder('rem-1', {
          title: 'Updated again',
          dueAt: '2026-05-28T22:00:00.000Z',
        }),
      ).toBe(false);
    });

    expect(mockUpdateAlertReminder).toHaveBeenCalledWith('rem-1', {
      title: 'Updated',
      note: 'New note',
      dueAt: '2026-05-28T21:00:00.000Z',
    });
    expect(showToast).toHaveBeenCalledWith('Failed to update alarm', 'error');
  });

  it('wraps snooze, done, and dismiss service actions', async () => {
    mockSnoozeAlertReminder.mockResolvedValue(makeRecord({ id: 'rem-1' }));
    mockMarkAlertReminderDone.mockResolvedValue(makeRecord({ id: 'rem-1', status: 'done' }));
    mockDismissAlertReminder.mockResolvedValue(makeRecord({ id: 'rem-1', status: 'dismissed' }));

    const { result } = renderHook(() => useAlertReminders());

    await act(async () => {
      expect(await result.current.snoozeReminder('rem-1', '2026-05-28T20:10:00.000Z')).toBe(true);
      expect(await result.current.markDone('rem-1')).toBe(true);
      expect(await result.current.dismissReminder('rem-1')).toBe(true);
    });

    expect(mockSnoozeAlertReminder).toHaveBeenCalledWith('rem-1', '2026-05-28T20:10:00.000Z');
    expect(mockMarkAlertReminderDone).toHaveBeenCalledWith('rem-1');
    expect(mockDismissAlertReminder).toHaveBeenCalledWith('rem-1');
  });
});
