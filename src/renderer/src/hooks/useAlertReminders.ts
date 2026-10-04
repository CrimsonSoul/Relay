import { useCallback, useMemo } from 'react';
import type { RecordModel } from 'pocketbase';
import { useToast } from '../components/Toast';
import { formatFailure } from '../utils/failureMessage';
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
  const resolved =
    reminder.completedAt || reminder.dismissedAt || reminder.updated || reminder.created;
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

  /** Names the alarm and keeps its unchanged state explicit in a failure toast. */
  const reportFailure = useCallback(
    (verb: string, id: string, error: unknown) => {
      const title = reminders.find((reminder) => reminder.id === id)?.title;
      const alarm = title ? 'the "' + title + '" alarm' : 'the alarm';
      showToast(
        formatFailure({
          what: `Couldn't ${verb} ${alarm}`,
          error,
          outcome: 'The alarm is unchanged.',
        }),
        'error',
      );
    },
    [reminders, showToast],
  );

  const scheduleReminder = useCallback(
    async (input: AlertReminderInput): Promise<boolean> => {
      const title = input.title.trim() || 'Send alert';
      try {
        await addAlertReminder(input);
        showToast(`Scheduled the "${title}" alarm`, 'success');
        return true;
      } catch (error) {
        showToast(
          formatFailure({
            what: `Couldn't schedule the "${title}" alarm`,
            error,
            outcome: 'Your entries are still in the form.',
          }),
          'error',
        );
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
      } catch (error) {
        reportFailure('snooze', id, error);
        return false;
      }
    },
    [reportFailure],
  );

  const updateReminder = useCallback(
    async (id: string, input: AlertReminderUpdateInput): Promise<boolean> => {
      try {
        await updateAlertReminder(id, input);
        return true;
      } catch (error) {
        reportFailure('save changes to', id, error);
        return false;
      }
    },
    [reportFailure],
  );

  const markDone = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await markAlertReminderDone(id);
        return true;
      } catch (error) {
        reportFailure('mark done', id, error);
        return false;
      }
    },
    [reportFailure],
  );

  const dismissReminder = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await dismissAlertReminder(id);
        return true;
      } catch (error) {
        reportFailure('dismiss', id, error);
        return false;
      }
    },
    [reportFailure],
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
