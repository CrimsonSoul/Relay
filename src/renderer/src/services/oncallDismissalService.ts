import type { RecordModel } from 'pocketbase';
import { getPb, handleApiError, escapeFilter } from './pocketbase';

export interface OncallDismissalRecord extends RecordModel {
  alertType: string;
  dateKey: string;
}

export async function getDismissalsForDate(dateKey: string): Promise<OncallDismissalRecord[]> {
  try {
    return await getPb()
      .collection('oncall_dismissals')
      .getFullList<OncallDismissalRecord>({
        filter: `dateKey="${escapeFilter(dateKey)}"`,
      });
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function dismissAlert(
  alertType: string,
  dateKey: string,
): Promise<OncallDismissalRecord> {
  try {
    return await getPb().collection('oncall_dismissals').create<OncallDismissalRecord>({
      alertType,
      dateKey,
    });
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}
