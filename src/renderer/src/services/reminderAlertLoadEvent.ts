import type { AlertReminderRecord } from './alertReminderService';

export const REMINDER_ALERT_LOAD_EVENT = 'relay:load-alert-reminder';

export type ReminderAlertLoadDetail = {
  reminderId: string;
  title: string;
  severity: AlertReminderRecord['severity'];
  subject: string;
  bodyHtml: string;
  sender: string;
};

export function hasLoadableReminderAlert(reminder: AlertReminderRecord): boolean {
  return Boolean(reminder.alertSubject.trim() || reminder.alertBodyHtml.trim());
}

export function dispatchReminderAlertLoad(reminder: AlertReminderRecord): void {
  window.dispatchEvent(
    new CustomEvent<ReminderAlertLoadDetail>(REMINDER_ALERT_LOAD_EVENT, {
      detail: {
        reminderId: reminder.id,
        title: reminder.title,
        severity: reminder.severity,
        subject: reminder.alertSubject,
        bodyHtml: reminder.alertBodyHtml,
        sender: reminder.createdBy,
      },
    }),
  );
}
