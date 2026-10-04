import { useCallback, useState } from 'react';
import { useAlertReminders } from '../../hooks/useAlertReminders';
import { useModalState } from '../../hooks/useModalState';
import type { AlertReminderInput, AlertReminderRecord } from '../../services/alertReminderService';
import {
  getReminderAlarmLabel,
  hasCustomReminderAlarmSource,
  resetReminderAlarmSource,
  saveReminderAlarmSource,
} from '../../services/reminderAlarmSoundService';
import { formatFailure } from '../../utils/failureMessage';

export function useAlertReminderWorkflow({
  showToast,
}: {
  showToast: (message: string, type: 'success' | 'error') => void;
}) {
  const reminderModal = useModalState();
  const reminderManagerModal = useModalState();
  const [editingReminder, setEditingReminder] = useState<AlertReminderRecord | null>(null);
  const [reminderAlarmLabel, setReminderAlarmLabel] = useState(getReminderAlarmLabel);
  const [hasCustomReminderAlarm, setHasCustomReminderAlarm] = useState(
    hasCustomReminderAlarmSource,
  );
  const reminders = useAlertReminders();
  const nextReminder = reminders.pendingReminders[0];
  const additionalReminderCount = Math.max(0, reminders.pendingReminders.length - 1);

  const openNewReminder = useCallback(() => {
    setEditingReminder(null);
    reminderModal.open();
  }, [reminderModal]);

  const closeReminder = useCallback(() => {
    reminderModal.close();
    setEditingReminder(null);
  }, [reminderModal]);

  const submitReminder = useCallback(
    async (input: AlertReminderInput): Promise<boolean> => {
      if (editingReminder) {
        return await reminders.updateReminder(editingReminder.id, {
          title: input.title,
          note: input.note,
          dueAt: input.dueAt,
        });
      }
      return await reminders.scheduleReminder(input);
    },
    [editingReminder, reminders],
  );

  const scheduleFromManager = useCallback(() => {
    reminderManagerModal.close();
    openNewReminder();
  }, [openNewReminder, reminderManagerModal]);

  const editReminder = useCallback(
    (reminder: AlertReminderRecord) => {
      reminderManagerModal.close();
      setEditingReminder(reminder);
      reminderModal.open();
    },
    [reminderManagerModal, reminderModal],
  );

  const refreshAlarmState = useCallback(() => {
    setReminderAlarmLabel(getReminderAlarmLabel());
    setHasCustomReminderAlarm(hasCustomReminderAlarmSource());
  }, []);

  const chooseAlarmSound = useCallback(async () => {
    const result = await globalThis.api?.selectReminderSound?.();
    if (result?.success && result.data) {
      if (saveReminderAlarmSource(result.data)) {
        refreshAlarmState();
        showToast('Set your MP3 as the alarm sound', 'success');
      } else {
        showToast(
          "Couldn't use that file as the alarm sound. It isn't an MP3. The current sound is kept. Choose an MP3 file.",
          'error',
        );
      }
    } else if (result?.error && result.error !== 'Cancelled') {
      showToast(
        formatFailure({
          what: "Couldn't set the alarm sound",
          error: result.error,
          outcome: 'The current sound is kept.',
          next: 'Choose an MP3 file.',
        }),
        'error',
      );
    }
  }, [refreshAlarmState, showToast]);

  const resetAlarmSound = useCallback(() => {
    resetReminderAlarmSource();
    refreshAlarmState();
    showToast('Alarm sound reset', 'success');
  }, [refreshAlarmState, showToast]);

  return {
    ...reminders,
    reminderModal,
    reminderManagerModal,
    editingReminder,
    nextReminder,
    additionalReminderCount,
    reminderAlarmLabel,
    hasCustomReminderAlarm,
    openNewReminder,
    closeReminder,
    submitReminder,
    scheduleFromManager,
    editReminder,
    chooseAlarmSound,
    resetAlarmSound,
  };
}
