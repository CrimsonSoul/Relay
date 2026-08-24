import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AlertReminderRecord } from '../../../services/alertReminderService';
import { useAlertReminders } from '../../../hooks/useAlertReminders';
import { useAlertReminderWorkflow } from '../useAlertReminderWorkflow';

vi.mock('../../../hooks/useAlertReminders', () => ({ useAlertReminders: vi.fn() }));

const useAlertRemindersMock = vi.mocked(useAlertReminders);

describe('useAlertReminderWorkflow', () => {
  it('owns reminder modal editing and routes an edit through updateReminder', async () => {
    const updateReminder = vi.fn(async () => true);
    useAlertRemindersMock.mockReturnValue({
      pendingReminders: [],
      completedReminders: [],
      loading: false,
      error: null,
      refetch: vi.fn(),
      scheduleReminder: vi.fn(async () => true),
      updateReminder,
      markDone: vi.fn(),
      dismissReminder: vi.fn(),
    } as never);
    const reminder: AlertReminderRecord = {
      id: 'reminder-1',
      title: 'Send outage update',
      note: '',
      dueAt: '2026-08-23T20:00:00.000Z',
      status: 'pending',
      snoozeUntil: '',
      severity: 'ISSUE',
      alertSubject: 'Database outage',
      alertBodyHtml: '<p>Investigating</p>',
      alertSender: 'IT',
      completedAt: '',
      dismissedAt: '',
      created: '2026-08-23T18:00:00.000Z',
      updated: '2026-08-23T18:00:00.000Z',
    };
    const { result } = renderHook(() =>
      useAlertReminderWorkflow({
        draft: {
          severity: 'ISSUE',
          subject: 'Database outage',
          bodyHtml: '<p>Investigating</p>',
          sender: 'IT',
        },
        showToast: vi.fn(),
      }),
    );

    act(() => result.current.editReminder(reminder));
    expect(result.current.reminderModal.isOpen).toBe(true);
    expect(result.current.editingReminder).toBe(reminder);

    await act(() =>
      result.current.submitReminder({
        title: 'Send final update',
        note: 'After recovery',
        dueAt: '2026-08-23T21:00:00.000Z',
      }),
    );

    expect(updateReminder).toHaveBeenCalledWith('reminder-1', {
      title: 'Send final update',
      note: 'After recovery',
      dueAt: '2026-08-23T21:00:00.000Z',
    });
  });
});
