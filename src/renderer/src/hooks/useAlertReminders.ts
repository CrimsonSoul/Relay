import { useCallback, useMemo } from 'react';
import type { RecordModel } from 'pocketbase';
import { useToast } from '../components/Toast';
import { useCollection } from './useCollection';
import {
  addAlertReminder,
  dismissAlertReminder,
  markAlertReminderDone,
  snoozeAlertReminder,
  type AlertReminderInput,
  type AlertReminderRecord,
} from '../services/alertReminderService';

type CollectionAlertReminderRecord = AlertReminderRecord & RecordModel;

export function getAlertReminderEffectiveTime(reminder: AlertReminderRecord): number {
  const effective = reminder.snoozeUntil || reminder.dueAt;
  const time = new Date(effective).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

export function useAlertReminders() {
  const { showToast } = useToast();
  const { data, loading, error, refetch } = useCollection<CollectionAlertReminderRecord>(
    'alert_reminders',
    {
      sort: 'dueAt',
    },
  );

  const reminders = data as AlertReminderRecord[];

  const upcomingReminders = useMemo(() => {
    const now = Date.now();
    return reminders
      .filter((reminder) => {
        return reminder.status === 'pending' && getAlertReminderEffectiveTime(reminder) >= now;
      })
      .toSorted((a, b) => getAlertReminderEffectiveTime(a) - getAlertReminderEffectiveTime(b));
  }, [reminders]);

  const scheduleReminder = useCallback(
    async (input: AlertReminderInput): Promise<boolean> => {
      try {
        await addAlertReminder(input);
        showToast('Reminder scheduled', 'success');
        return true;
      } catch {
        showToast('Failed to schedule reminder', 'error');
        return false;
      }
    },
    [showToast],
  );

  const snoozeReminder = useCallback(
    async (id: string, snoozeUntil: string): Promise<boolean> => {
      try {
        await snoozeAlertReminder(id, snoozeUntil);
        return true;
      } catch {
        showToast('Failed to snooze reminder', 'error');
        return false;
      }
    },
    [showToast],
  );

  const markDone = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await markAlertReminderDone(id);
        return true;
      } catch {
        showToast('Failed to complete reminder', 'error');
        return false;
      }
    },
    [showToast],
  );

  const dismissReminder = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await dismissAlertReminder(id);
        return true;
      } catch {
        showToast('Failed to dismiss reminder', 'error');
        return false;
      }
    },
    [showToast],
  );

  return {
    reminders,
    upcomingReminders,
    loading,
    error,
    refetch,
    scheduleReminder,
    snoozeReminder,
    markDone,
    dismissReminder,
  };
}
