import { AlertHistoryEntrySchema } from '@shared/ipcValidation';
import { getPb, handleApiError, requireOnline } from './pocketbase';
import { mutateCollection } from './mutationGateway';

export interface AlertHistoryRecord {
  id: string;
  severity: 'ISSUE' | 'MAINTENANCE' | 'INFO' | 'RESOLVED';
  subject: string;
  bodyHtml: string;
  sender: string;
  recipient: string;
  pinned: boolean;
  label: string;
  created: string;
  updated: string;
}

export type AlertHistoryInput = Omit<AlertHistoryRecord, 'id' | 'created' | 'updated'>;

export async function addAlertHistory(data: AlertHistoryInput): Promise<AlertHistoryRecord> {
  const parsed = AlertHistoryEntrySchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('Alert history entry exceeds size limits');
  }
  return (await mutateCollection<AlertHistoryRecord>(
    'alert_history',
    'create',
    undefined,
    data,
  )) as AlertHistoryRecord;
}

export async function deleteAlertHistory(id: string): Promise<void> {
  await mutateCollection('alert_history', 'delete', id);
}

export async function clearAlertHistory(): Promise<void> {
  requireOnline();
  try {
    const records = await getPb().collection('alert_history').getFullList<AlertHistoryRecord>();
    for (const record of records) {
      await getPb().collection('alert_history').delete(record.id);
    }
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function pinAlertHistory(id: string, pinned: boolean): Promise<AlertHistoryRecord> {
  return (await mutateCollection<AlertHistoryRecord>('alert_history', 'update', id, {
    pinned,
  })) as AlertHistoryRecord;
}

export async function updateAlertLabel(id: string, label: string): Promise<AlertHistoryRecord> {
  return (await mutateCollection<AlertHistoryRecord>('alert_history', 'update', id, {
    label,
  })) as AlertHistoryRecord;
}
