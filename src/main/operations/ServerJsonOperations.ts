/**
 * ServerJsonOperations - Server CRUD operations using JSON storage
 * Follows the pattern established in PresetOperations.ts
 * Uses cross-process file locking for multi-instance synchronization.
 */

import type { ServerRecord } from '@shared/ipc';
import { ServerRecordSchema } from '@shared/ipcValidation';
import { loggers } from '../logger';
import { generateId } from './idUtils';
import {
  readAll,
  modifyItems,
  deleteById,
  updateById,
  bulkUpsert,
  type JsonCrudConfig,
} from './jsonCrudHelper';

const config: JsonCrudConfig = {
  fileName: 'servers.json',
  logPrefix: '[ServerJsonOperations]',
  recordSchema: ServerRecordSchema,
};

/**
 * Read all servers from servers.json
 */
export async function getServers(rootDir: string): Promise<ServerRecord[]> {
  return readAll<ServerRecord>(rootDir, config);
}

/**
 * Add a new server
 */
export async function addServerRecord(
  rootDir: string,
  server: Omit<ServerRecord, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<ServerRecord | null> {
  let result: ServerRecord | null = null;

  return modifyItems<ServerRecord, ServerRecord | null>(
    rootDir,
    config,
    (servers) => {
      // Check for duplicate name
      const existingIndex = servers.findIndex(
        (s) => s.name.toLowerCase() === server.name.toLowerCase(),
      );

      if (existingIndex === -1) {
        const now = Date.now();
        const newServer: ServerRecord = {
          id: generateId('server'),
          name: server.name,
          businessArea: server.businessArea,
          lob: server.lob,
          comment: server.comment,
          owner: server.owner,
          contact: server.contact,
          os: server.os,
          createdAt: now,
          updatedAt: now,
        };
        servers.push(newServer);
        result = newServer;
        loggers.fileManager.info(`[ServerJsonOperations] Added server: ${newServer.name}`);
        return servers;
      }

      // Update existing server instead of adding duplicate
      const now = Date.now();
      servers[existingIndex] = {
        ...servers[existingIndex],
        ...server,
        updatedAt: now,
      };
      result = servers[existingIndex];
      loggers.fileManager.info(`[ServerJsonOperations] Updated existing server: ${server.name}`);
      return servers;
    },
    () => result,
    null,
    'addServer',
  );
}

/**
 * Update an existing server by ID
 */
export async function updateServerRecord(
  rootDir: string,
  id: string,
  updates: Partial<Omit<ServerRecord, 'id' | 'createdAt'>>,
): Promise<boolean> {
  return updateById<ServerRecord>(
    rootDir,
    config,
    id,
    updates as Partial<ServerRecord>,
    (s) => s.name,
    'server',
  );
}

/**
 * Delete a server by ID
 */
export async function deleteServerRecord(rootDir: string, id: string): Promise<boolean> {
  return deleteById<ServerRecord>(rootDir, config, id, 'server');
}

/**
 * Find a server by name
 */
export async function findServerByName(
  rootDir: string,
  name: string,
): Promise<ServerRecord | null> {
  try {
    const servers = await getServers(rootDir);
    return servers.find((s) => s.name.toLowerCase() === name.toLowerCase()) || null;
  } catch (e) {
    loggers.fileManager.error('[ServerJsonOperations] findServerByName error:', { error: e });
    return null;
  }
}

/**
 * Bulk add/update servers (for import operations)
 */
export async function bulkUpsertServers(
  rootDir: string,
  newServers: Omit<ServerRecord, 'id' | 'createdAt' | 'updatedAt'>[],
): Promise<{ imported: number; updated: number; errors: string[] }> {
  return bulkUpsert<ServerRecord>(
    rootDir,
    config,
    newServers,
    'server',
    (s) => s.name.toLowerCase(),
    (s) => s.name.toLowerCase(),
    (s) => `server ${s.name}`,
  );
}
