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
  globalThis.dispatchEvent(
    new CustomEvent<ReminderAlertLoadDetail>(REMINDER_ALERT_LOAD_EVENT, {
      detail: {
        reminderId: reminder.id,
        title: reminder.title,
        severity: reminder.severity,
        subject: reminder.alertSubject,
        bodyHtml: reminder.alertBodyHtml,
        // `createdBy` is optional, so a reminder with no operator, no sender and
        // no creator used to publish `sender: undefined` — and the Alerts
        // composer calls `.trim()` on it as soon as the alert is loaded.
        sender: reminder.operatorId
          ? (reminder.alertSender ?? '')
          : reminder.alertSender || reminder.createdBy || '',
      },
    }),
  );
}
