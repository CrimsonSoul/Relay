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
  function captureSender(reminder: AlertReminderRecord): string {
    const listener = vi.fn();
    window.addEventListener('relay:load-alert-reminder', listener as EventListener);
    try {
      dispatchReminderAlertLoad(reminder);
      return (listener.mock.calls[0]?.[0] as CustomEvent).detail.sender as string;
    } finally {
      window.removeEventListener('relay:load-alert-reminder', listener as EventListener);
    }
  }

  it.each([{ alertSender: '' }, { alertSender: undefined }])(
    'keeps an attributed blank or missing cosmetic sender blank: $alertSender',
    ({ alertSender }) => {
      expect(captureSender(makeReminder({ operatorId: 'operator-ryan', alertSender }))).toBe('');
    },
  );

  it('restores a nonblank cosmetic sender for attributed reminders', () => {
    expect(
      captureSender(makeReminder({ operatorId: 'operator-ryan', alertSender: 'Operations' })),
    ).toBe('Operations');
  });

  it.each([{ alertSender: '' }, { alertSender: undefined }])(
    'falls back to legacy createdBy when cosmetic sender is blank or missing: $alertSender',
    ({ alertSender }) => {
      expect(captureSender(makeReminder({ createdBy: 'Legacy Operations', alertSender }))).toBe(
        'Legacy Operations',
      );
    },
  );

  it('restores a nonblank cosmetic sender for legacy reminders', () => {
    expect(
      captureSender(makeReminder({ createdBy: 'Legacy Operator', alertSender: 'Legacy NOC' })),
    ).toBe('Legacy NOC');
  });

  // Regression: `createdBy` is optional, so an unattributed reminder with no
  // cosmetic sender published `sender: undefined`. The Alerts composer calls
  // `detail.sender.trim()` as soon as the alert loads, which threw.
  it.each([
    { alertSender: '', createdBy: undefined },
    { alertSender: undefined, createdBy: undefined },
  ])(
    'emits an empty sender rather than undefined when nothing is attributed: $alertSender',
    ({ alertSender, createdBy }) => {
      const sender = captureSender(makeReminder({ operatorId: undefined, alertSender, createdBy }));
      expect(sender).toBe('');
      expect(() => sender.trim()).not.toThrow();
    },
  );
});
