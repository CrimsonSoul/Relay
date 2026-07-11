import { getPb, handleApiError, requireOnline } from './pocketbase';
import { mutateCollection } from './mutationGateway';

export interface BridgeHistoryRecord {
  id: string;
  note: string;
  groups: string[];
  contacts: string[];
  recipientCount: number;
  created: string;
  updated: string;
}

export type BridgeHistoryInput = Omit<BridgeHistoryRecord, 'id' | 'created' | 'updated'>;

export async function addBridgeHistory(data: BridgeHistoryInput): Promise<BridgeHistoryRecord> {
  return (await mutateCollection<BridgeHistoryRecord>(
    'bridge_history',
    'create',
    undefined,
    data,
  )) as BridgeHistoryRecord;
}

export async function deleteBridgeHistory(id: string): Promise<void> {
  await mutateCollection('bridge_history', 'delete', id);
}

export async function clearBridgeHistory(): Promise<void> {
  requireOnline();
  try {
    const records = await getPb().collection('bridge_history').getFullList<BridgeHistoryRecord>();
    for (const record of records) {
      await getPb().collection('bridge_history').delete(record.id);
    }
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}
