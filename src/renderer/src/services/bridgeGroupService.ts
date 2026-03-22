import { getPb, handleApiError } from './pocketbase';

export interface BridgeGroupRecord {
  id: string;
  name: string;
  contacts: string[];
  created: string;
  updated: string;
}

export type BridgeGroupInput = Omit<BridgeGroupRecord, 'id' | 'created' | 'updated'>;

export async function addGroup(data: BridgeGroupInput): Promise<BridgeGroupRecord> {
  try {
    return await getPb().collection('bridge_groups').create<BridgeGroupRecord>(data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function updateGroup(
  id: string,
  data: Partial<BridgeGroupInput>,
): Promise<BridgeGroupRecord> {
  try {
    return await getPb().collection('bridge_groups').update<BridgeGroupRecord>(id, data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function deleteGroup(id: string): Promise<void> {
  try {
    await getPb().collection('bridge_groups').delete(id);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}
