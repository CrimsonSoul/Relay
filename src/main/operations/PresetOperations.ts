/**
 * GroupOperations - Bridge group CRUD operations
 * Groups are stored as JSON for flexibility with nested data
 */

import { join } from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { dialog } from "electron";
import type { BridgeGroup } from "@shared/ipc";
import { loggers } from "../logger";
import { parseCsvAsync } from "../csvUtils";

const GROUPS_FILE = "bridgeGroups.json";

function generateId(): string {
  return `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export async function getGroups(rootDir: string): Promise<BridgeGroup[]> {
  const path = join(rootDir, GROUPS_FILE);
  try {
    if (!existsSync(path)) return [];
    const contents = await fs.readFile(path, "utf-8");
    const data = JSON.parse(contents);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    loggers.fileManager.error("[GroupOperations] getGroups error:", { error: e });
    return [];
  }
}

async function writeGroups(rootDir: string, groups: BridgeGroup[]): Promise<void> {
  const path = join(rootDir, GROUPS_FILE);
  const content = JSON.stringify(groups, null, 2);
  await fs.writeFile(`${path}.tmp`, content, "utf-8");
  await fs.rename(`${path}.tmp`, path);
}

export async function saveGroup(
  rootDir: string,
  group: Omit<BridgeGroup, "id" | "createdAt" | "updatedAt">
): Promise<BridgeGroup | null> {
  try {
    const groups = await getGroups(rootDir);
    const now = Date.now();
    const newGroup: BridgeGroup = {
      id: generateId(),
      name: group.name,
      contacts: group.contacts,
      createdAt: now,
      updatedAt: now,
    };
    groups.push(newGroup);
    await writeGroups(rootDir, groups);
    loggers.fileManager.info(`[GroupOperations] Saved group: ${newGroup.name}`);
    return newGroup;
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
    const groups = await getGroups(rootDir);
    const index = groups.findIndex((g) => g.id === id);
    if (index === -1) return false;

    groups[index] = {
      ...groups[index],
      ...updates,
      updatedAt: Date.now(),
    };
    await writeGroups(rootDir, groups);
    loggers.fileManager.info(`[GroupOperations] Updated group: ${groups[index].name}`);
    return true;
  } catch (e) {
    loggers.fileManager.error("[GroupOperations] updateGroup error:", { error: e });
    return false;
  }
}

export async function deleteGroup(rootDir: string, id: string): Promise<boolean> {
  try {
    const groups = await getGroups(rootDir);
    const filtered = groups.filter((g) => g.id !== id);
    if (filtered.length === groups.length) return false;
    await writeGroups(rootDir, filtered);
    loggers.fileManager.info(`[GroupOperations] Deleted group: ${id}`);
    return true;
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

    // Load existing groups
    const existingGroups = await getGroups(rootDir);
    const existingNames = new Set(existingGroups.map((g) => g.name.toLowerCase()));

    // Create new groups for each entry
    const now = Date.now();
    const newGroups: BridgeGroup[] = [];
    let importedCount = 0;
    let skippedCount = 0;

    for (const [name, contacts] of groupMap) {
      if (existingNames.has(name.toLowerCase())) {
        // Skip existing groups with same name
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

    // Append new groups
    const allGroups = [...existingGroups, ...newGroups];
    await writeGroups(rootDir, allGroups);

    loggers.fileManager.info(
      `[GroupOperations] Imported ${importedCount} groups from CSV (${skippedCount} skipped as duplicates)`
    );
    return true;
  } catch (e) {
    loggers.fileManager.error("[GroupOperations] importGroupsFromCsv error:", { error: e });
    return false;
  }
}
