import { useCallback, useMemo } from 'react';
import type { RecordModel } from 'pocketbase';
import { useToast } from '../components/Toast';
import { useCollection } from './useCollection';
import {
  addAlertReminder,
  dismissAlertReminder,
  markAlertReminderDone,
  snoozeAlertReminder,
  updateAlertReminder,
  type AlertReminderInput,
  type AlertReminderRecord,
  type AlertReminderUpdateInput,
} from '../services/alertReminderService';

type CollectionAlertReminderRecord = AlertReminderRecord & RecordModel;

export function getAlertReminderEffectiveTime(reminder: AlertReminderRecord): number {
  const effective = reminder.snoozeUntil || reminder.dueAt;
  const time = new Date(effective).getTime();
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

function getAlertReminderResolvedTime(reminder: AlertReminderRecord): number {
  const resolved = reminder.completedAt || reminder.dismissedAt || reminder.updated || reminder.created;
  const time = new Date(resolved).getTime();
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
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

  const pendingReminders = useMemo(() => {
    return reminders
      .filter((reminder) => reminder.status === 'pending')
      .toSorted((a, b) => getAlertReminderEffectiveTime(a) - getAlertReminderEffectiveTime(b));
  }, [reminders]);

  const completedReminders = useMemo(() => {
    return reminders
      .filter((reminder) => reminder.status === 'done' || reminder.status === 'dismissed')
      .toSorted((a, b) => getAlertReminderResolvedTime(b) - getAlertReminderResolvedTime(a));
  }, [reminders]);

  const upcomingReminders = useMemo(() => {
    const now = Date.now();
    return pendingReminders.filter((reminder) => getAlertReminderEffectiveTime(reminder) >= now);
  }, [pendingReminders]);

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

  const updateReminder = useCallback(
    async (id: string, input: AlertReminderUpdateInput): Promise<boolean> => {
      try {
        await updateAlertReminder(id, input);
        return true;
      } catch {
        showToast('Failed to update reminder', 'error');
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
    pendingReminders,
    completedReminders,
    upcomingReminders,
    loading,
    error,
    refetch,
    scheduleReminder,
    snoozeReminder,
    updateReminder,
    markDone,
    dismissReminder,
  };
}
