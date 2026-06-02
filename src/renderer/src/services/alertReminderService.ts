import { getPb, handleApiError, requireOnline, escapeFilter } from './pocketbase';
import type { Severity } from '../tabs/alertUtils';

export type AlertReminderStatus = 'pending' | 'done' | 'dismissed';

export interface AlertReminderRecord {
  id: string;
  title: string;
  note: string;
  dueAt: string;
  status: AlertReminderStatus;
  snoozeUntil: string;
  severity: Severity | '';
  alertSubject: string;
  alertBodyHtml: string;
  createdBy: string;
  completedAt: string;
  dismissedAt: string;
  created: string;
  updated: string;
}

export interface AlertReminderInput {
  title: string;
  note?: string;
  dueAt: string;
  severity?: Severity | '';
  alertSubject?: string;
  alertBodyHtml?: string;
  createdBy?: string;
}

export interface AlertReminderUpdateInput {
  title: string;
  note?: string;
  dueAt: string;
}

type AlertReminderCreatePayload = Omit<
  AlertReminderRecord,
  'id' | 'created' | 'updated' | 'status' | 'snoozeUntil' | 'completedAt' | 'dismissedAt'
> & {
  status: 'pending';
};

const COLLECTION = 'alert_reminders';

function normalizeCreatePayload(input: AlertReminderInput): AlertReminderCreatePayload {
  return {
    title: input.title.trim() || 'Send alert',
    note: input.note?.trim() || '',
    dueAt: input.dueAt,
    status: 'pending',
    severity: input.severity || '',
    alertSubject: input.alertSubject?.trim() || '',
    alertBodyHtml: input.alertBodyHtml || '',
    createdBy: input.createdBy?.trim() || '',
  };
}

export async function addAlertReminder(input: AlertReminderInput): Promise<AlertReminderRecord> {
  requireOnline();
  try {
    return await getPb()
      .collection(COLLECTION)
      .create<AlertReminderRecord>(normalizeCreatePayload(input));
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function listDueAlertReminders(now = new Date()): Promise<AlertReminderRecord[]> {
  const nowIso = escapeFilter(now.toISOString());
  try {
    return await getPb()
      .collection(COLLECTION)
      .getFullList<AlertReminderRecord>({
        sort: 'snoozeUntil,dueAt,created',
        filter:
          `status = "pending" && ` +
          `((snoozeUntil != "" && snoozeUntil <= "${nowIso}") || ` +
          `(snoozeUntil = "" && dueAt <= "${nowIso}"))`,
        requestKey: null,
      });
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function snoozeAlertReminder(
  id: string,
  snoozeUntil: string,
): Promise<AlertReminderRecord> {
  requireOnline();
  try {
    return await getPb().collection(COLLECTION).update<AlertReminderRecord>(id, {
      status: 'pending',
      snoozeUntil,
    });
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function updateAlertReminder(
  id: string,
  input: AlertReminderUpdateInput,
): Promise<AlertReminderRecord> {
  requireOnline();
  try {
    return await getPb()
      .collection(COLLECTION)
      .update<AlertReminderRecord>(id, {
        title: input.title.trim() || 'Send alert',
        note: input.note?.trim() || '',
        dueAt: input.dueAt,
        status: 'pending',
        snoozeUntil: '',
      });
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function markAlertReminderDone(
  id: string,
  now = new Date(),
): Promise<AlertReminderRecord> {
  requireOnline();
  try {
    return await getPb().collection(COLLECTION).update<AlertReminderRecord>(id, {
      status: 'done',
      completedAt: now.toISOString(),
    });
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function dismissAlertReminder(
  id: string,
  now = new Date(),
): Promise<AlertReminderRecord> {
  requireOnline();
  try {
    return await getPb().collection(COLLECTION).update<AlertReminderRecord>(id, {
      status: 'dismissed',
      dismissedAt: now.toISOString(),
    });
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}
