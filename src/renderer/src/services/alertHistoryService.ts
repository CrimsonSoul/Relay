import { getPb, handleApiError } from './pocketbase';

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
  try {
    return await getPb().collection('alert_history').create<AlertHistoryRecord>(data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function deleteAlertHistory(id: string): Promise<void> {
  try {
    await getPb().collection('alert_history').delete(id);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function clearAlertHistory(): Promise<void> {
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
  try {
    return await getPb().collection('alert_history').update<AlertHistoryRecord>(id, { pinned });
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function updateAlertLabel(id: string, label: string): Promise<AlertHistoryRecord> {
  try {
    return await getPb().collection('alert_history').update<AlertHistoryRecord>(id, { label });
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}
