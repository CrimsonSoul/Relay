import { describe, expect, it } from 'vitest';
import type { AlertReminderRecord } from './alertReminderService';
import { nextReminderDelay } from './reminderScheduler';

const NOW = Date.parse('2026-07-10T18:00:00.000Z');

function reminder(overrides: Partial<AlertReminderRecord> = {}): AlertReminderRecord {
  return {
    id: 'reminder-1',
    title: 'Send update',
    note: '',
    dueAt: new Date(NOW + 60_000).toISOString(),
    status: 'pending',
    snoozeUntil: '',
    severity: 'ISSUE',
    alertSubject: '',
    alertBodyHtml: '',
    createdBy: 'NOC',
    completedAt: '',
    dismissedAt: '',
    created: new Date(NOW).toISOString(),
    updated: new Date(NOW).toISOString(),
    ...overrides,
  };
}

describe('nextReminderDelay', () => {
  it('returns null when the only pending reminder is already due', () => {
    expect(
      nextReminderDelay([reminder({ dueAt: new Date(NOW - 1).toISOString() })], NOW),
    ).toBeNull();
  });

  it('schedules the next future reminder even while an overdue one is on screen', () => {
    expect(
      nextReminderDelay(
        [
          reminder({ id: 'overdue', dueAt: new Date(NOW - 600_000).toISOString() }),
          reminder({ id: 'upcoming', dueAt: new Date(NOW + 1_800_000).toISOString() }),
        ],
        NOW,
      ),
    ).toBe(1_800_000);
  });

  it('returns the delay to the earliest future pending reminder', () => {
    expect(
      nextReminderDelay(
        [reminder({ dueAt: new Date(NOW + 120_000).toISOString() }), reminder()],
        NOW,
      ),
    ).toBe(60_000);
  });

  it('uses snooze time instead of the original due time', () => {
    expect(
      nextReminderDelay(
        [
          reminder({
            dueAt: new Date(NOW - 60_000).toISOString(),
            snoozeUntil: new Date(NOW + 300_000).toISOString(),
          }),
        ],
        NOW,
      ),
    ).toBe(300_000);
  });

  it('ignores completed, dismissed, and invalid reminders', () => {
    expect(
      nextReminderDelay(
        [
          reminder({ status: 'done' }),
          reminder({ id: 'dismissed', status: 'dismissed' }),
          reminder({ id: 'invalid', dueAt: 'not-a-date' }),
        ],
        NOW,
      ),
    ).toBeNull();
  });
});
