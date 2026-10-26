import { AlertHistoryEntrySchema } from '@shared/ipcValidation';
import { getConnectionState, getPb, handleApiError, requireOnline } from './pocketbase';
import { mutateCollection, mutateCollectionWithOutcome } from './mutationGateway';
import { extractAlertHistoryImages, stripAlertHistoryImages } from './alertHistoryImages';

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
  /** Stored file names for the body's `data-relay-image` references, in index order. */
  images?: string[];
}

export type AlertHistoryInput = Omit<AlertHistoryRecord, 'id' | 'created' | 'updated' | 'images'>;

export type AlertHistorySaveWarning = 'offline-images-dropped' | 'server-images-dropped';
export type AlertHistorySaveOutcome = {
  record: AlertHistoryRecord;
  warning: AlertHistorySaveWarning | null;
};

/**
 * Saves an entry with its body images as protected files. Offline, the queue carries JSON only,
 * so the text is saved without images; a server without the `images` field drops them too.
 * Both outcomes come back as a warning for the caller to show.
 */
export async function addAlertHistory(data: AlertHistoryInput): Promise<AlertHistorySaveOutcome> {
  let fields: Record<string, unknown>;
  let files: File[] = [];
  let warning: AlertHistorySaveWarning | null = null;
  if (getConnectionState() === 'offline') {
    const bodyHtml = stripAlertHistoryImages(data.bodyHtml);
    if (bodyHtml !== data.bodyHtml) warning = 'offline-images-dropped';
    fields = { ...data, bodyHtml };
  } else {
    const extracted = extractAlertHistoryImages(data.bodyHtml);
    files = extracted.files;
    fields = { ...data, bodyHtml: extracted.bodyHtml };
  }

  const parsed = AlertHistoryEntrySchema.safeParse(fields);
  if (!parsed.success) {
    throw new Error('Alert history entry exceeds size limits');
  }
  const { record } = await mutateCollectionWithOutcome<AlertHistoryRecord>(
    'alert_history',
    'create',
    undefined,
    files.length > 0 ? { ...fields, images: files } : fields,
  );
  const saved = record as AlertHistoryRecord;
  if (files.length > 0 && (saved.images?.length ?? 0) !== files.length) {
    warning = 'server-images-dropped';
  }
  return { record: saved, warning };
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
