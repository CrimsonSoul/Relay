import type { AlertReminderRecord } from './alertReminderService';

export const MAX_REMINDER_TIMEOUT_MS = 2_147_000_000;

export function reminderEffectiveTime(reminder: AlertReminderRecord): number {
  const timestamp = new Date(reminder.snoozeUntil || reminder.dueAt).getTime();
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

export function nextReminderDelay(
  reminders: AlertReminderRecord[],
  now = Date.now(),
): number | null {
  let nextTime = Number.POSITIVE_INFINITY;
  for (const reminder of reminders) {
    if (reminder.status !== 'pending') continue;
    nextTime = Math.min(nextTime, reminderEffectiveTime(reminder));
  }
  if (!Number.isFinite(nextTime)) return null;
  return Math.max(0, Math.min(nextTime - now, MAX_REMINDER_TIMEOUT_MS));
}
