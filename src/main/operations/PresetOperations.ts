/**
 * GroupOperations - Bridge group CRUD operations
 * Groups are stored as JSON for flexibility with nested data
 * Uses cross-process file locking for multi-instance synchronization.
 */

import { join } from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { dialog } from "electron";
import type { BridgeGroup } from "@shared/ipc";
import { loggers } from "../logger";
import { parseCsvAsync } from "../csvUtils";
import { modifyJsonWithLock } from "../fileLock";

const GROUPS_FILE = "bridgeGroups.json";
const GROUPS_FILE_PATH = (rootDir: string) => join(rootDir, GROUPS_FILE);

function generateId(): string {
  return `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export async function getGroups(rootDir: string): Promise<BridgeGroup[]> {
  const path = GROUPS_FILE_PATH(rootDir);
  try {
    if (!existsSync(path)) return [];
    const contents = await fs.readFile(path, "utf-8");
    const data = JSON.parse(contents);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    if ((e as any)?.code === "ENOENT") return [];
    loggers.fileManager.error("[GroupOperations] getGroups error:", { error: e });
    throw e;
  }
}

export async function saveGroup(
  rootDir: string,
  group: Omit<BridgeGroup, "id" | "createdAt" | "updatedAt">
): Promise<BridgeGroup | null> {
  try {
    let result: BridgeGroup | null = null;
    const path = GROUPS_FILE_PATH(rootDir);

    await modifyJsonWithLock<BridgeGroup[]>(path, (groups) => {
      const now = Date.now();
      const newGroup: BridgeGroup = {
        id: generateId(),
        name: group.name,
        contacts: group.contacts,
        createdAt: now,
        updatedAt: now,
      };
      groups.push(newGroup);
      result = newGroup;
      loggers.fileManager.info(`[GroupOperations] Saved group: ${newGroup.name}`);
      return groups;
    }, []);

    return result;
  } catch (e) {
    loggers.fileManager.error("[GroupOperations] saveGroup error:", { error: e });
    return null;
  }
}

export async function updateGroup(
  rootDir: string,
  id: string,
  updates: Partial<Omit<BridgeGroup, "id" | "createdAt">>
): Promise<boolean> {
  try {
    let found = false;
    const path = GROUPS_FILE_PATH(rootDir);

    await modifyJsonWithLock<BridgeGroup[]>(path, (groups) => {
      const index = groups.findIndex((g) => g.id === id);
      if (index === -1) return groups;

      groups[index] = {
        ...groups[index],
        ...updates,
        updatedAt: Date.now(),
      };
      found = true;
      loggers.fileManager.info(`[GroupOperations] Updated group: ${groups[index].name}`);
      return groups;
    }, []);

    return found;
  } catch (e) {
    loggers.fileManager.error("[GroupOperations] updateGroup error:", { error: e });
    return false;
  }
}

export async function deleteGroup(rootDir: string, id: string): Promise<boolean> {
  try {
    let deleted = false;
    const path = GROUPS_FILE_PATH(rootDir);

    await modifyJsonWithLock<BridgeGroup[]>(path, (groups) => {
      const initialLength = groups.length;
      const filtered = groups.filter((g) => g.id !== id);
      if (filtered.length === initialLength) return groups;

      deleted = true;
      loggers.fileManager.info(`[GroupOperations] Deleted group: ${id}`);
      return filtered;
    }, []);

    return deleted;
  } catch (e) {
    loggers.fileManager.error("[GroupOperations] deleteGroup error:", { error: e });
    return false;
  }
}

/**
 * Import groups from a CSV file
 * Expected format: group_name,email (one email per row, groups share name)
 * This converts the old groups.csv format into BridgeGroups
 */
export async function importGroupsFromCsv(rootDir: string): Promise<boolean> {
  try {
    const result = await dialog.showOpenDialog({
      title: "Import Groups from CSV",
      filters: [{ name: "CSV Files", extensions: ["csv"] }],
      properties: ["openFile"],
    });

    if (result.canceled || !result.filePaths[0]) return false;

    const filePath = result.filePaths[0];
    const content = await fs.readFile(filePath, "utf-8");
    const rows = await parseCsvAsync(content);

    if (rows.length === 0) {
      loggers.fileManager.warn("[GroupOperations] CSV file is empty");
      return false;
    }

    // Find column indices - support both "group_name,email" and "name,email" formats
    const headers = rows[0];
    const groupColIndex = headers.findIndex(
      (h) => String(h).toLowerCase() === "group_name" || String(h).toLowerCase() === "group" || String(h).toLowerCase() === "name"
    );
    const emailColIndex = headers.findIndex(
      (h) => String(h).toLowerCase() === "email" || String(h).toLowerCase() === "member" || String(h).toLowerCase() === "contact"
    );

    if (groupColIndex === -1 || emailColIndex === -1) {
      loggers.fileManager.error("[GroupOperations] CSV missing required columns (group_name/name, email)");
      return false;
    }

    // Group emails by group name
    const groupMap = new Map<string, string[]>();
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const groupName = String(row[groupColIndex] ?? "").trim();
      const email = String(row[emailColIndex] ?? "").trim().toLowerCase();

      if (!groupName || !email) continue;

      if (!groupMap.has(groupName)) {
        groupMap.set(groupName, []);
      }
      const emails = groupMap.get(groupName)!;
      if (!emails.includes(email)) {
        emails.push(email);
      }
    }

    const jsonPath = GROUPS_FILE_PATH(rootDir);
    let importedCount = 0;
    let skippedCount = 0;

    await modifyJsonWithLock<BridgeGroup[]>(jsonPath, (existingGroups) => {
      const existingNames = new Set(existingGroups.map((g) => g.name.toLowerCase()));
      const now = Date.now();
      const newGroups: BridgeGroup[] = [];

      for (const [name, contacts] of groupMap) {
        if (existingNames.has(name.toLowerCase())) {
          skippedCount++;
          continue;
        }
        newGroups.push({
          id: generateId(),
          name,
          contacts,
          createdAt: now,
          updatedAt: now,
        });
        importedCount++;
      }

      return [...existingGroups, ...newGroups];
    }, []);

    loggers.fileManager.info(
      `[GroupOperations] Imported ${importedCount} groups from CSV (${skippedCount} skipped as duplicates)`
    );
    return true;
  } catch (e) {
    loggers.fileManager.error("[GroupOperations] importGroupsFromCsv error:", { error: e });
    return false;
  }
}

