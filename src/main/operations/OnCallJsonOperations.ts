/**
 * OnCallJsonOperations - OnCall CRUD operations using JSON storage
 * Follows the pattern established in PresetOperations.ts
 */

import { join } from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import type { OnCallRecord } from "@shared/ipc";
import { loggers } from "../logger";

const ONCALL_FILE = "oncall.json";

function generateId(): string {
  return `oncall_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Read all on-call records from oncall.json
 */
export async function getOnCall(rootDir: string): Promise<OnCallRecord[]> {
  const path = join(rootDir, ONCALL_FILE);
  try {
    if (!existsSync(path)) return [];
    const contents = await fs.readFile(path, "utf-8");
    const data = JSON.parse(contents);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    loggers.fileManager.error("[OnCallJsonOperations] getOnCall error:", { error: e });
    return [];
  }
}

/**
 * Write on-call records to oncall.json using atomic write
 */
async function writeOnCall(rootDir: string, records: OnCallRecord[]): Promise<void> {
  const path = join(rootDir, ONCALL_FILE);
  const content = JSON.stringify(records, null, 2);
  await fs.writeFile(`${path}.tmp`, content, "utf-8");
  await fs.rename(`${path}.tmp`, path);
}

/**
 * Add a new on-call record
 */
export async function addOnCallRecord(
  rootDir: string,
  record: Omit<OnCallRecord, "id" | "createdAt" | "updatedAt">
): Promise<OnCallRecord | null> {
  try {
    const records = await getOnCall(rootDir);

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
    await writeOnCall(rootDir, records);
    loggers.fileManager.info(`[OnCallJsonOperations] Added on-call record: ${newRecord.team}/${newRecord.role}`);
    return newRecord;
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
    const records = await getOnCall(rootDir);
    const index = records.findIndex((r) => r.id === id);
    if (index === -1) return false;

    records[index] = {
      ...records[index],
      ...updates,
      updatedAt: Date.now(),
    };
    await writeOnCall(rootDir, records);
    loggers.fileManager.info(`[OnCallJsonOperations] Updated on-call record: ${id}`);
    return true;
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
    const records = await getOnCall(rootDir);
    const filtered = records.filter((r) => r.id !== id);
    if (filtered.length === records.length) return false;
    await writeOnCall(rootDir, filtered);
    loggers.fileManager.info(`[OnCallJsonOperations] Deleted on-call record: ${id}`);
    return true;
  } catch (e) {
    loggers.fileManager.error("[OnCallJsonOperations] deleteOnCallRecord error:", { error: e });
    return false;
  }
}

/**
 * Get all on-call records for a specific team
 */
export async function getOnCallByTeam(rootDir: string, team: string): Promise<OnCallRecord[]> {
  try {
    const records = await getOnCall(rootDir);
    return records.filter((r) => r.team === team);
  } catch (e) {
    loggers.fileManager.error("[OnCallJsonOperations] getOnCallByTeam error:", { error: e });
    return [];
  }
}

/**
 * Delete all on-call records for a specific team
 */
export async function deleteOnCallByTeam(rootDir: string, team: string): Promise<boolean> {
  try {
    const records = await getOnCall(rootDir);
    const filtered = records.filter((r) => r.team !== team);
    if (filtered.length === records.length) return false;
    await writeOnCall(rootDir, filtered);
    loggers.fileManager.info(`[OnCallJsonOperations] Deleted on-call records for team: ${team}`);
    return true;
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
  newRecords: Omit<OnCallRecord, "id" | "createdAt" | "updatedAt">[]
): Promise<boolean> {
  try {
    const records = await getOnCall(rootDir);
    const now = Date.now();

    // Remove existing records for this team
    const filtered = records.filter((r) => r.team !== team);

    // Add new records for this team
    const recordsWithIds: OnCallRecord[] = newRecords.map((r) => ({
      id: generateId(),
      team: r.team,
      role: r.role,
      name: r.name,
      contact: r.contact,
      timeWindow: r.timeWindow,
      createdAt: now,
      updatedAt: now,
    }));

    await writeOnCall(rootDir, [...filtered, ...recordsWithIds]);
    loggers.fileManager.info(`[OnCallJsonOperations] Updated team ${team}: ${recordsWithIds.length} records`);
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
    const records = await getOnCall(rootDir);
    const now = Date.now();
    let renamed = false;

    const updated = records.map((r) => {
      if (r.team === oldName) {
        renamed = true;
        return { ...r, team: newName, updatedAt: now };
      }
      return r;
    });

    if (!renamed) return false;

    await writeOnCall(rootDir, updated);
    loggers.fileManager.info(`[OnCallJsonOperations] Renamed team: ${oldName} -> ${newName}`);
    return true;
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
    const records = await getOnCall(rootDir);

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

    await writeOnCall(rootDir, orderedRecords);
    loggers.fileManager.info(`[OnCallJsonOperations] Reordered teams: ${teamOrder.join(", ")}`);
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
  records: Omit<OnCallRecord, "id" | "createdAt" | "updatedAt">[]
): Promise<boolean> {
  try {
    const now = Date.now();
    const recordsWithIds: OnCallRecord[] = records.map((r) => ({
      id: generateId(),
      team: r.team,
      role: r.role,
      name: r.name,
      contact: r.contact,
      timeWindow: r.timeWindow,
      createdAt: now,
      updatedAt: now,
    }));

    await writeOnCall(rootDir, recordsWithIds);
    loggers.fileManager.info(`[OnCallJsonOperations] Saved all on-call: ${recordsWithIds.length} records`);
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

  try {
    const records = await getOnCall(rootDir);
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

    await writeOnCall(rootDir, Array.from(recordMap.values()));
    loggers.fileManager.info(
      `[OnCallJsonOperations] Bulk upsert: ${result.imported} imported, ${result.updated} updated`
    );
  } catch (e) {
    result.errors.push(`Bulk upsert failed: ${e}`);
    loggers.fileManager.error("[OnCallJsonOperations] bulkUpsertOnCall error:", { error: e });
  }

  return result;
}
