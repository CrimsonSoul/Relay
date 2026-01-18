/**
 * ServerJsonOperations - Server CRUD operations using JSON storage
 * Follows the pattern established in PresetOperations.ts
 * Uses cross-process file locking for multi-instance synchronization.
 */

import { join } from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import type { ServerRecord } from "@shared/ipc";
import { loggers } from "../logger";
import { modifyJsonWithLock, readWithLock } from "../fileLock";

const SERVERS_FILE = "servers.json";
const SERVERS_FILE_PATH = (rootDir: string) => join(rootDir, SERVERS_FILE);

function generateId(): string {
  return `server_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Read all servers from servers.json
 */

// ...

export async function getServers(rootDir: string): Promise<ServerRecord[]> {
  const path = SERVERS_FILE_PATH(rootDir);
  try {
    const contents = await readWithLock(path);
    if (!contents) return [];
    
    const data = JSON.parse(contents);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if ((e as any)?.code === "ENOENT") return [];
    loggers.fileManager.error("[ServerJsonOperations] getServers error:", { error: e });
    throw e;
  }
}

/**
 * Add a new server
 */
export async function addServerRecord(
  rootDir: string,
  server: Omit<ServerRecord, "id" | "createdAt" | "updatedAt">
): Promise<ServerRecord | null> {
  try {
    let result: ServerRecord | null = null;
    const path = SERVERS_FILE_PATH(rootDir);

    await modifyJsonWithLock<ServerRecord[]>(path, (servers) => {
      // Check for duplicate name
      const existingIndex = servers.findIndex(
        (s) => s.name.toLowerCase() === server.name.toLowerCase()
      );

      if (existingIndex !== -1) {
        // Update existing server instead of adding duplicate
        const now = Date.now();
        servers[existingIndex] = {
          ...servers[existingIndex],
          ...server,
          updatedAt: now,
        };
        result = servers[existingIndex];
        loggers.fileManager.info(`[ServerJsonOperations] Updated existing server: ${server.name}`);
      } else {
        const now = Date.now();
        const newServer: ServerRecord = {
          id: generateId(),
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
      }
      return servers;
    }, []);

    return result;
  } catch (e) {
    loggers.fileManager.error("[ServerJsonOperations] addServer error:", { error: e });
    return null;
  }
}

/**
 * Update an existing server by ID
 */
export async function updateServerRecord(
  rootDir: string,
  id: string,
  updates: Partial<Omit<ServerRecord, "id" | "createdAt">>
): Promise<boolean> {
  try {
    let found = false;
    const path = SERVERS_FILE_PATH(rootDir);

    await modifyJsonWithLock<ServerRecord[]>(path, (servers) => {
      const index = servers.findIndex((s) => s.id === id);
      if (index === -1) return servers;

      servers[index] = {
        ...servers[index],
        ...updates,
        updatedAt: Date.now(),
      };
      found = true;
      loggers.fileManager.info(`[ServerJsonOperations] Updated server: ${servers[index].name}`);
      return servers;
    }, []);

    return found;
  } catch (e) {
    loggers.fileManager.error("[ServerJsonOperations] updateServer error:", { error: e });
    return false;
  }
}

/**
 * Delete a server by ID
 */
export async function deleteServerRecord(rootDir: string, id: string): Promise<boolean> {
  try {
    let deleted = false;
    const path = SERVERS_FILE_PATH(rootDir);

    await modifyJsonWithLock<ServerRecord[]>(path, (servers) => {
      const initialLength = servers.length;
      const filtered = servers.filter((s) => s.id !== id);
      if (filtered.length === initialLength) return servers;

      deleted = true;
      loggers.fileManager.info(`[ServerJsonOperations] Deleted server: ${id}`);
      return filtered;
    }, []);

    return deleted;
  } catch (e) {
    loggers.fileManager.error("[ServerJsonOperations] deleteServer error:", { error: e });
    return false;
  }
}


/**
 * Find a server by name
 */
export async function findServerByName(
  rootDir: string,
  name: string
): Promise<ServerRecord | null> {
  try {
    const servers = await getServers(rootDir);
    return servers.find((s) => s.name.toLowerCase() === name.toLowerCase()) || null;
  } catch (e) {
    loggers.fileManager.error("[ServerJsonOperations] findServerByName error:", { error: e });
    return null;
  }
}

/**
 * Bulk add/update servers (for import operations)
 */
export async function bulkUpsertServers(
  rootDir: string,
  newServers: Omit<ServerRecord, "id" | "createdAt" | "updatedAt">[]
): Promise<{ imported: number; updated: number; errors: string[] }> {
  const result = { imported: 0, updated: 0, errors: [] as string[] };
  const path = SERVERS_FILE_PATH(rootDir);

  try {
    await modifyJsonWithLock<ServerRecord[]>(path, (servers) => {
      const nameMap = new Map(servers.map((s) => [s.name.toLowerCase(), s]));
      const now = Date.now();

      for (const newServer of newServers) {
        try {
          const nameKey = newServer.name.toLowerCase();
          const existing = nameMap.get(nameKey);

          if (existing) {
            // Update existing
            const updated: ServerRecord = {
              ...existing,
              ...newServer,
              updatedAt: now,
            };
            nameMap.set(nameKey, updated);
            result.updated++;
          } else {
            // Add new
            const record: ServerRecord = {
              id: generateId(),
              ...newServer,
              createdAt: now,
              updatedAt: now,
            };
            nameMap.set(nameKey, record);
            result.imported++;
          }
        } catch (e) {
          result.errors.push(`Failed to process server ${newServer.name}: ${e}`);
        }
      }

      loggers.fileManager.info(
        `[ServerJsonOperations] Bulk upsert: ${result.imported} imported, ${result.updated} updated`
      );
      return Array.from(nameMap.values());
    }, []);
  } catch (e) {
    result.errors.push(`Bulk upsert failed: ${e}`);
    loggers.fileManager.error("[ServerJsonOperations] bulkUpsertServers error:", { error: e });
  }

  return result;
}

