import { createCrudService } from './crudServiceFactory';

export interface BridgeGroupRecord {
  id: string;
  name: string;
  contacts: string[];
  created: string;
  updated: string;
}

export type BridgeGroupInput = Omit<BridgeGroupRecord, 'id' | 'created' | 'updated'>;

const crud = createCrudService<BridgeGroupRecord>('bridge_groups');

export const addGroup = (data: BridgeGroupInput): Promise<BridgeGroupRecord> => crud.create(data);

export const updateGroup = (
  id: string,
  data: Partial<BridgeGroupInput>,
): Promise<BridgeGroupRecord> => crud.update(id, data);

export const deleteGroup = (id: string): Promise<void> => crud.remove(id);
