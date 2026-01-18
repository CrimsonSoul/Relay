/**
 * OnCallJsonOperations - OnCall CRUD operations using JSON storage
 * Follows the pattern established in PresetOperations.ts
 * Uses cross-process file locking for multi-instance synchronization.
 */

import { join } from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import type { OnCallRecord } from "@shared/ipc";
import { loggers } from "../logger";
import { modifyJsonWithLock, readWithLock } from "../fileLock";

const ONCALL_FILE = "oncall.json";
const ONCALL_FILE_PATH = (rootDir: string) => join(rootDir, ONCALL_FILE);

function generateId(): string {
  return `oncall_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Read all on-call records from oncall.json
 */
import { readWithLock } from "../fileLock";

// ...

export async function getOnCall(rootDir: string): Promise<OnCallRecord[]> {
  const path = ONCALL_FILE_PATH(rootDir);
  try {
    const contents = await readWithLock(path);
    if (!contents) return [];
    
    const data = JSON.parse(contents);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if ((e as any)?.code === "ENOENT") return [];
    loggers.fileManager.error("[OnCallJsonOperations] getOnCall error:", { error: e });
    throw e;
  }
}

/**
 * Add a new on-call record
 */
export async function addOnCallRecord(
  rootDir: string,
  record: Omit<OnCallRecord, "id" | "createdAt" | "updatedAt">
): Promise<OnCallRecord | null> {
  try {
    let result: OnCallRecord | null = null;
    const path = ONCALL_FILE_PATH(rootDir);

    await modifyJsonWithLock<OnCallRecord[]>(path, (records) => {
      const now = Date.now();
      const newRecord: OnCallRecord = {
        id: generateId(),
        team: record.team,
        role: record.role,
        name: record.name,
        contact: record.contact,
        timeWindow: record.timeWindow,
        createdAt: now,
        updatedAt: now,
      };
      records.push(newRecord);
      result = newRecord;
      loggers.fileManager.info(`[OnCallJsonOperations] Added on-call record: ${newRecord.team}/${newRecord.role}`);
      return records;
    }, []);

    return result;
  } catch (e) {
    loggers.fileManager.error("[OnCallJsonOperations] addOnCallRecord error:", { error: e });
    return null;
  }
}

/**
 * Update an existing on-call record by ID
 */
export async function updateOnCallRecord(
  rootDir: string,
  id: string,
  updates: Partial<Omit<OnCallRecord, "id" | "createdAt">>
): Promise<boolean> {
  try {
    let found = false;
    const path = ONCALL_FILE_PATH(rootDir);

    await modifyJsonWithLock<OnCallRecord[]>(path, (records) => {
      const index = records.findIndex((r) => r.id === id);
      if (index === -1) return records;

      records[index] = {
        ...records[index],
        ...updates,
        updatedAt: Date.now(),
      };
      found = true;
      loggers.fileManager.info(`[OnCallJsonOperations] Updated on-call record: ${id}`);
      return records;
    }, []);

    return found;
  } catch (e) {
    loggers.fileManager.error("[OnCallJsonOperations] updateOnCallRecord error:", { error: e });
    return false;
  }
}

/**
 * Delete an on-call record by ID
 */
export async function deleteOnCallRecord(rootDir: string, id: string): Promise<boolean> {
  try {
    let deleted = false;
    const path = ONCALL_FILE_PATH(rootDir);

    await modifyJsonWithLock<OnCallRecord[]>(path, (records) => {
      const initialLength = records.length;
      const filtered = records.filter((r) => r.id !== id);
      if (filtered.length === initialLength) return records;

      deleted = true;
      loggers.fileManager.info(`[OnCallJsonOperations] Deleted on-call record: ${id}`);
      return filtered;
    }, []);

    return deleted;
  } catch (e) {
    loggers.fileManager.error("[OnCallJsonOperations] deleteOnCallRecord error:", { error: e });
    return false;
  }
}

/**
 * Delete all on-call records for a specific team
 */
export async function deleteOnCallByTeam(rootDir: string, team: string): Promise<boolean> {
  try {
    let deleted = false;
    const path = ONCALL_FILE_PATH(rootDir);

    await modifyJsonWithLock<OnCallRecord[]>(path, (records) => {
      const initialLength = records.length;
      const filtered = records.filter((r) => r.team !== team);
      if (filtered.length === initialLength) return records;

      deleted = true;
      loggers.fileManager.info(`[OnCallJsonOperations] Deleted on-call records for team: ${team}`);
      return filtered;
    }, []);

    return deleted;
  } catch (e) {
    loggers.fileManager.error("[OnCallJsonOperations] deleteOnCallByTeam error:", { error: e });
    return false;
  }
}

/**
 * Update all on-call records for a specific team (replace entire team)
 */
export async function updateOnCallTeamJson(
  rootDir: string,
  team: string,
  newRecords: Partial<OnCallRecord>[]
): Promise<boolean> {
  try {
    const path = ONCALL_FILE_PATH(rootDir);
    const normalizedTeam = team.trim().toLowerCase();

    await modifyJsonWithLock<OnCallRecord[]>(path, (records) => {
      const now = Date.now();

      // Remove existing records for this team (case-insensitive check for robustness)
      const filtered = records.filter((r) => r.team.trim().toLowerCase() !== normalizedTeam);

      // Add new records for this team
      const recordsWithIds: OnCallRecord[] = newRecords.map((r) => ({
        id: r.id || generateId(), // Preserve ID if provided, else generate
        team: r.team || team, // Use provided team or fallback to argument
        role: r.role || "Member",
        name: r.name || "",
        contact: r.contact || "",
        timeWindow: r.timeWindow || "",
        createdAt: r.createdAt || now,
        updatedAt: now,
      }));

      loggers.fileManager.info(`[OnCallJsonOperations] Updated team ${team}: ${recordsWithIds.length} records (IDs preserved)`);
      return [...filtered, ...recordsWithIds];
    }, []);

    return true;
  } catch (e) {
    loggers.fileManager.error("[OnCallJsonOperations] updateOnCallTeam error:", { error: e });
    return false;
  }
}

/**
 * Rename a team (update team field for all records)
 */
export async function renameOnCallTeamJson(
  rootDir: string,
  oldName: string,
  newName: string
): Promise<boolean> {
  try {
    let renamed = false;
    const path = ONCALL_FILE_PATH(rootDir);

    await modifyJsonWithLock<OnCallRecord[]>(path, (records) => {
      const now = Date.now();
      const updated = records.map((r) => {
        if (r.team === oldName) {
          renamed = true;
          return { ...r, team: newName, updatedAt: now };
        }
        return r;
      });

      if (renamed) {
        loggers.fileManager.info(`[OnCallJsonOperations] Renamed team: ${oldName} -> ${newName}`);
      }
      return updated;
    }, []);

    return renamed;
  } catch (e) {
    loggers.fileManager.error("[OnCallJsonOperations] renameOnCallTeam error:", { error: e });
    return false;
  }
}

/**
 * Reorder on-call teams
 */
export async function reorderOnCallTeamsJson(
  rootDir: string,
  teamOrder: string[]
): Promise<boolean> {
  try {
    const path = ONCALL_FILE_PATH(rootDir);

    await modifyJsonWithLock<OnCallRecord[]>(path, (records) => {
      // Group records by team
      const teamMap = new Map<string, OnCallRecord[]>();
      records.forEach(r => {
        const list = teamMap.get(r.team) || [];
        list.push(r);
        teamMap.set(r.team, list);
      });

      // Reconstruct list based on order
      const orderedRecords: OnCallRecord[] = [];
      const processedTeams = new Set<string>();

      for (const team of teamOrder) {
        if (teamMap.has(team)) {
          orderedRecords.push(...teamMap.get(team)!);
          processedTeams.add(team);
        }
      }

      // Append any teams not in the order (safety)
      for (const [team, teamRecords] of teamMap.entries()) {
        if (!processedTeams.has(team)) {
          orderedRecords.push(...teamRecords);
        }
      }

      loggers.fileManager.info(`[OnCallJsonOperations] Reordered teams: ${teamOrder.join(", ")}`);
      return orderedRecords;
    }, []);

    return true;
  } catch (e) {
    loggers.fileManager.error("[OnCallJsonOperations] reorderOnCallTeamsJson error:", { error: e });
    return false;
  }
}

/**
 * Save all on-call records (replace entire dataset)
 */
export async function saveAllOnCallJson(
  rootDir: string,
  records: Partial<OnCallRecord>[]
): Promise<boolean> {
  try {
    const path = ONCALL_FILE_PATH(rootDir);

    await modifyJsonWithLock<OnCallRecord[]>(path, () => {
      const now = Date.now();
      const recordsWithIds: OnCallRecord[] = records.map((r) => ({
        id: r.id || generateId(),
        team: r.team || "Unknown",
        role: r.role || "Member",
        name: r.name || "",
        contact: r.contact || "",
        timeWindow: r.timeWindow || "",
        createdAt: r.createdAt || now,
        updatedAt: now,
      }));

      loggers.fileManager.info(`[OnCallJsonOperations] Saved all on-call: ${recordsWithIds.length} records (IDs preserved)`);
      return recordsWithIds;
    }, []);

    return true;
  } catch (e) {
    loggers.fileManager.error("[OnCallJsonOperations] saveAllOnCall error:", { error: e });
    return false;
  }
}

/**
 * Bulk add/update on-call records (for import operations)
 */
export async function bulkUpsertOnCall(
  rootDir: string,
  newRecords: Omit<OnCallRecord, "id" | "createdAt" | "updatedAt">[]
): Promise<{ imported: number; updated: number; errors: string[] }> {
  const result = { imported: 0, updated: 0, errors: [] as string[] };
  const path = ONCALL_FILE_PATH(rootDir);

  try {
    await modifyJsonWithLock<OnCallRecord[]>(path, (records) => {
      const now = Date.now();

      // Create a key based on team+role+name for matching
      const keyFor = (r: { team: string; role: string; name: string }) =>
        `${r.team}|${r.role}|${r.name}`.toLowerCase();

      const recordMap = new Map(records.map((r) => [keyFor(r), r]));

      for (const newRecord of newRecords) {
        try {
          const key = keyFor(newRecord);
          const existing = recordMap.get(key);

          if (existing) {
            // Update existing
            const updated: OnCallRecord = {
              ...existing,
              ...newRecord,
              updatedAt: now,
            };
            recordMap.set(key, updated);
            result.updated++;
          } else {
            // Add new
            const record: OnCallRecord = {
              id: generateId(),
              team: newRecord.team,
              role: newRecord.role,
              name: newRecord.name,
              contact: newRecord.contact,
              timeWindow: newRecord.timeWindow,
              createdAt: now,
              updatedAt: now,
            };
            recordMap.set(key, record);
            result.imported++;
          }
        } catch (e) {
          result.errors.push(`Failed to process on-call ${newRecord.team}/${newRecord.role}: ${e}`);
        }
      }

      loggers.fileManager.info(
        `[OnCallJsonOperations] Bulk upsert: ${result.imported} imported, ${result.updated} updated`
      );
      return Array.from(recordMap.values());
    }, []);
  } catch (e) {
    result.errors.push(`Bulk upsert failed: ${e}`);
    loggers.fileManager.error("[OnCallJsonOperations] bulkUpsertOnCall error:", { error: e });
  }

  return result;
}

