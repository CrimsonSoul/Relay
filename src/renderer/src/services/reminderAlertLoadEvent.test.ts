import { describe, expect, it, vi } from 'vitest';
import type { AlertReminderRecord } from './alertReminderService';
import { dispatchReminderAlertLoad } from './reminderAlertLoadEvent';

function makeReminder(overrides: Partial<AlertReminderRecord> = {}): AlertReminderRecord {
  return {
    id: 'rem-1',
    title: 'Send outage alert',
    note: '',
    dueAt: '2026-05-28T20:00:00.000Z',
    status: 'pending',
    snoozeUntil: '',
    severity: 'ISSUE',
    alertSubject: 'Outage',
    alertBodyHtml: '<p>Body</p>',
    createdBy: 'Ryan Bell',
    completedAt: '',
    dismissedAt: '',
    created: '2026-05-28T19:00:00.000Z',
    updated: '2026-05-28T19:00:00.000Z',
    ...overrides,
  };
}

describe('dispatchReminderAlertLoad', () => {
  it('restores the cosmetic alert sender for attributed reminders', () => {
    const listener = vi.fn();
    window.addEventListener('relay:load-alert-reminder', listener as EventListener);

    dispatchReminderAlertLoad(
      makeReminder({ operatorId: 'operator-ryan', alertSender: 'Operations' }),
    );

    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail.sender).toBe('Operations');
    window.removeEventListener('relay:load-alert-reminder', listener as EventListener);
  });

  it('falls back to legacy createdBy values when alertSender is absent', () => {
    const listener = vi.fn();
    window.addEventListener('relay:load-alert-reminder', listener as EventListener);

    dispatchReminderAlertLoad(makeReminder({ createdBy: 'Legacy Operations' }));

    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail.sender).toBe('Legacy Operations');
    window.removeEventListener('relay:load-alert-reminder', listener as EventListener);
  });
});
