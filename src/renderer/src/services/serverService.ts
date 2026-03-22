import { getPb, handleApiError, escapeFilter, requireOnline } from './pocketbase';

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

export async function addServer(data: ServerInput): Promise<ServerRecord> {
  requireOnline();
  try {
    return await getPb().collection('servers').create<ServerRecord>(data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function updateServer(id: string, data: Partial<ServerInput>): Promise<ServerRecord> {
  requireOnline();
  try {
    return await getPb().collection('servers').update<ServerRecord>(id, data);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function deleteServer(id: string): Promise<void> {
  requireOnline();
  try {
    await getPb().collection('servers').delete(id);
  } catch (err) {
    handleApiError(err);
    throw err;
  }
}

export async function findServerByName(name: string): Promise<ServerRecord | null> {
  try {
    const result = await getPb()
      .collection('servers')
      .getFirstListItem<ServerRecord>(`name="${escapeFilter(name)}"`);
    return result;
  } catch (err: unknown) {
    if (err instanceof Error && 'status' in err && (err as { status: number }).status === 404) {
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
