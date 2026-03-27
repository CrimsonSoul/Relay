import { getPb, handleApiError, escapeFilter, requireOnline } from './pocketbase';
import { isPbNotFoundError } from './pbErrors';
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

export async function findServerByName(name: string): Promise<ServerRecord | null> {
  try {
    const result = await getPb()
      .collection('servers')
      .getFirstListItem<ServerRecord>(`name="${escapeFilter(name)}"`);
    return result;
  } catch (err: unknown) {
    if (isPbNotFoundError(err)) {
      return null;
    }
    handleApiError(err);
    throw err;
  }
}

export async function bulkUpsertServers(servers: ServerInput[]): Promise<ServerRecord[]> {
  requireOnline();
  const results: ServerRecord[] = [];
  for (const server of servers) {
    try {
      const existing = await findServerByName(server.name);
      if (existing) {
        const updated = await updateServer(existing.id, server);
        results.push(updated);
      } else {
        const created = await addServer(server);
        results.push(created);
      }
    } catch (err) {
      handleApiError(err);
      throw err;
    }
  }
  return results;
}
