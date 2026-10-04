import type { RecordModel } from 'pocketbase';
import { mutateCollection } from './mutationGateway';

export interface OncallDismissalRecord extends RecordModel {
  alertType: string;
  dateKey: string;
}

export async function dismissAlert(
  alertType: string,
  dateKey: string,
): Promise<OncallDismissalRecord> {
  return (await mutateCollection<OncallDismissalRecord>('oncall_dismissals', 'create', undefined, {
    alertType,
    dateKey,
  })) as OncallDismissalRecord;
}
