import { createCrudService } from './crudServiceFactory';

export interface ServerRecord {
  id: string;
  name: string;
  businessArea: string;
  lob: string;
  comment: string;
  owner: string;
  contact: string;
  os: string;
  created: string;
  updated: string;
}

export type ServerInput = Omit<ServerRecord, 'id' | 'created' | 'updated'>;

const crud = createCrudService<ServerRecord>('servers');

export const addServer = (data: ServerInput): Promise<ServerRecord> => crud.create(data);

export const updateServer = (id: string, data: Partial<ServerInput>): Promise<ServerRecord> =>
  crud.update(id, data);

export const deleteServer = (id: string): Promise<void> => crud.remove(id);
