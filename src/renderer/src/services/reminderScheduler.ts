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
    const effectiveTime = reminderEffectiveTime(reminder);
    // An overdue reminder is already surfaced; folding it into the minimum
    // yields a zero delay, and the caller arms no timer for it — which would
    // strand every later reminder until the next reconciliation refetch.
    if (effectiveTime <= now) continue;
    nextTime = Math.min(nextTime, effectiveTime);
  }
  if (!Number.isFinite(nextTime)) return null;
  return Math.min(nextTime - now, MAX_REMINDER_TIMEOUT_MS);
}
