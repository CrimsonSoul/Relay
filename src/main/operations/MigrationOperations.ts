/**
 * MigrationOperations - Migrate CSV files to JSON format
 *
 * This handles one-time migration from CSV storage to JSON storage,
 * preserving all data while adding IDs and timestamps.
 */

import { join, basename } from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import type { ContactRecord, ServerRecord, OnCallRecord, MigrationResult } from "@shared/ipc";
import { parseCsvAsync, desanitizeField } from "../csvUtils";
import { HeaderMatcher } from "../HeaderMatcher";
import { CONTACT_COLUMN_ALIASES, SERVER_COLUMN_ALIASES } from "@shared/csvTypes";
import { loggers } from "../logger";
import { performBackup } from "./BackupOperations";

// File names
const CONTACTS_CSV = "contacts.csv";
const SERVERS_CSV = "servers.csv";
const ONCALL_CSV = "oncall.csv";
const CONTACTS_JSON = "contacts.json";
const SERVERS_JSON = "servers.json";
const ONCALL_JSON = "oncall.json";

function generateContactId(): string {
  return `contact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateServerId(): string {
  return `server_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateOnCallId(): string {
  return `oncall_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Check if migration is needed (CSV files exist but JSON files don't or are empty)
 */
export async function needsMigration(rootDir: string): Promise<boolean> {
  const contactsCsvExists = existsSync(join(rootDir, CONTACTS_CSV));
  const serversCsvExists = existsSync(join(rootDir, SERVERS_CSV));
  const oncallCsvExists = existsSync(join(rootDir, ONCALL_CSV));

  const contactsJsonExists = existsSync(join(rootDir, CONTACTS_JSON));
  const serversJsonExists = existsSync(join(rootDir, SERVERS_JSON));
  const oncallJsonExists = existsSync(join(rootDir, ONCALL_JSON));

  // Need migration if any CSV exists without corresponding JSON
  if (contactsCsvExists && !contactsJsonExists) return true;
  if (serversCsvExists && !serversJsonExists) return true;
  if (oncallCsvExists && !oncallJsonExists) return true;

  // Also check if JSON files are empty but CSV has data
  if (contactsCsvExists && contactsJsonExists) {
    try {
      const json = await fs.readFile(join(rootDir, CONTACTS_JSON), "utf-8");
      const data = JSON.parse(json);
      if (Array.isArray(data) && data.length === 0) {
        const csv = await fs.readFile(join(rootDir, CONTACTS_CSV), "utf-8");
        if (csv.trim().split("\n").length > 1) return true;
      }
    } catch {
      // JSON parse error means we need migration
      return true;
    }
  }

  return false;
}

/**
 * Migrate contacts.csv to contacts.json
 */
export async function migrateContactsCsv(
  rootDir: string
): Promise<{ migrated: number; errors: string[] }> {
  const result = { migrated: 0, errors: [] as string[] };
  const csvPath = join(rootDir, CONTACTS_CSV);
  const jsonPath = join(rootDir, CONTACTS_JSON);

  if (!existsSync(csvPath)) {
    loggers.fileManager.info("[MigrationOperations] No contacts.csv to migrate");
    return result;
  }

  try {
    const contents = await fs.readFile(csvPath, "utf-8");
    const data = await parseCsvAsync(contents);

    if (data.length < 2) {
      loggers.fileManager.info("[MigrationOperations] contacts.csv is empty or has only headers");
      // Create empty JSON file
      await fs.writeFile(jsonPath, "[]", "utf-8");
      return result;
    }

    const header = data[0].map((h: unknown) => desanitizeField(String(h).trim().toLowerCase()));
    const rows = data.slice(1);
    const matcher = new HeaderMatcher(header);

    const nameIdx = matcher.findColumn(CONTACT_COLUMN_ALIASES.name);
    const emailIdx = matcher.findColumn(CONTACT_COLUMN_ALIASES.email);
    const phoneIdx = matcher.findColumn(CONTACT_COLUMN_ALIASES.phone);
    const titleIdx = matcher.findColumn(CONTACT_COLUMN_ALIASES.title);

    const now = Date.now();
    const contacts: ContactRecord[] = [];

    for (let i = 0; i < rows.length; i++) {
      try {
        const row = rows[i];
        const getVal = (idx: number) => (idx === -1 || idx >= row.length) ? "" : desanitizeField(row[idx]);

        const email = getVal(emailIdx);
        if (!email) continue; // Skip rows without email

        contacts.push({
          id: generateContactId(),
          name: getVal(nameIdx),
          email,
          phone: getVal(phoneIdx),
          title: getVal(titleIdx),
          createdAt: now,
          updatedAt: now,
        });
        result.migrated++;
      } catch (e) {
        result.errors.push(`Row ${i + 2}: ${e}`);
      }
    }

    // Write JSON file atomically
    const content = JSON.stringify(contacts, null, 2);
    await fs.writeFile(`${jsonPath}.tmp`, content, "utf-8");
    await fs.rename(`${jsonPath}.tmp`, jsonPath);

    loggers.fileManager.info(`[MigrationOperations] Migrated ${result.migrated} contacts to JSON`);
  } catch (e) {
    result.errors.push(`Failed to migrate contacts: ${e}`);
    loggers.fileManager.error("[MigrationOperations] migrateContactsCsv error:", { error: e });
  }

  return result;
}

/**
 * Migrate servers.csv to servers.json
 */
export async function migrateServersCsv(
  rootDir: string
): Promise<{ migrated: number; errors: string[] }> {
  const result = { migrated: 0, errors: [] as string[] };
  const csvPath = join(rootDir, SERVERS_CSV);
  const jsonPath = join(rootDir, SERVERS_JSON);

  if (!existsSync(csvPath)) {
    loggers.fileManager.info("[MigrationOperations] No servers.csv to migrate");
    return result;
  }

  try {
    const contents = await fs.readFile(csvPath, "utf-8");

    // Handle potential header offset like ServerParser does
    const lines = contents.split(/\r?\n/);
    let headerLineIndex = 0;
    const possibleHeaders = ["VM-M", "Server Name", "Name"];
    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      const line = lines[i].toLowerCase();
      if (possibleHeaders.some((h) => line.includes(h.toLowerCase()))) {
        headerLineIndex = i;
        break;
      }
    }

    const cleanContents = lines.slice(headerLineIndex).join("\n");
    const data = await parseCsvAsync(cleanContents);

    if (data.length < 2) {
      loggers.fileManager.info("[MigrationOperations] servers.csv is empty or has only headers");
      await fs.writeFile(jsonPath, "[]", "utf-8");
      return result;
    }

    const header = data[0].map((h: unknown) => desanitizeField(String(h).trim().toLowerCase()));
    const rows = data.slice(1);
    const matcher = new HeaderMatcher(header);

    const nameIdx = matcher.findColumn(SERVER_COLUMN_ALIASES.name);
    const baIdx = matcher.findColumn(SERVER_COLUMN_ALIASES.businessArea);
    const lobIdx = matcher.findColumn(SERVER_COLUMN_ALIASES.lob);
    const commentIdx = matcher.findColumn(SERVER_COLUMN_ALIASES.comment);
    const ownerIdx = matcher.findColumn(SERVER_COLUMN_ALIASES.owner);
    const contactIdx = matcher.findColumn(SERVER_COLUMN_ALIASES.contact);
    const osIdx = matcher.findColumn(SERVER_COLUMN_ALIASES.os);

    const now = Date.now();
    const servers: ServerRecord[] = [];

    for (let i = 0; i < rows.length; i++) {
      try {
        const row = rows[i];
        const getVal = (idx: number) => (idx === -1 || idx >= row.length) ? "" : desanitizeField(row[idx]);

        const name = getVal(nameIdx);
        if (!name) continue; // Skip rows without name

        servers.push({
          id: generateServerId(),
          name,
          businessArea: getVal(baIdx),
          lob: getVal(lobIdx),
          comment: getVal(commentIdx),
          owner: getVal(ownerIdx),
          contact: getVal(contactIdx),
          os: getVal(osIdx),
          createdAt: now,
          updatedAt: now,
        });
        result.migrated++;
      } catch (e) {
        result.errors.push(`Row ${i + 2}: ${e}`);
      }
    }

    // Write JSON file atomically
    const content = JSON.stringify(servers, null, 2);
    await fs.writeFile(`${jsonPath}.tmp`, content, "utf-8");
    await fs.rename(`${jsonPath}.tmp`, jsonPath);

    loggers.fileManager.info(`[MigrationOperations] Migrated ${result.migrated} servers to JSON`);
  } catch (e) {
    result.errors.push(`Failed to migrate servers: ${e}`);
    loggers.fileManager.error("[MigrationOperations] migrateServersCsv error:", { error: e });
  }

  return result;
}

/**
 * Migrate oncall.csv to oncall.json
 */
export async function migrateOnCallCsv(
  rootDir: string
): Promise<{ migrated: number; errors: string[] }> {
  const result = { migrated: 0, errors: [] as string[] };
  const csvPath = join(rootDir, ONCALL_CSV);
  const jsonPath = join(rootDir, ONCALL_JSON);

  if (!existsSync(csvPath)) {
    loggers.fileManager.info("[MigrationOperations] No oncall.csv to migrate");
    return result;
  }

  try {
    const contents = await fs.readFile(csvPath, "utf-8");
    const data = await parseCsvAsync(contents);

    if (data.length < 2) {
      loggers.fileManager.info("[MigrationOperations] oncall.csv is empty or has only headers");
      await fs.writeFile(jsonPath, "[]", "utf-8");
      return result;
    }

    const header = data[0].map((h: unknown) => desanitizeField(String(h).trim().toLowerCase()));
    const rows = data.slice(1);

    const now = Date.now();
    const records: OnCallRecord[] = [];

    // Check for legacy format (Primary/Backup columns)
    if (header.includes("primary") && header.includes("backup")) {
      const teamIdx = header.indexOf("team");
      const primaryIdx = header.indexOf("primary");
      const backupIdx = header.indexOf("backup");
      const labelIdx = header.indexOf("label");

      for (let i = 0; i < rows.length; i++) {
        try {
          const row = rows[i];
          const team = desanitizeField(row[teamIdx] || "");
          const primary = primaryIdx !== -1 ? desanitizeField(row[primaryIdx] || "") : "";
          const backup = backupIdx !== -1 ? desanitizeField(row[backupIdx] || "") : "";
          const label = labelIdx !== -1 ? desanitizeField(row[labelIdx] || "") : "Backup";

          if (!team) continue;

          if (primary) {
            records.push({
              id: generateOnCallId(),
              team,
              role: "Primary",
              name: "",
              contact: primary,
              createdAt: now,
              updatedAt: now,
            });
            result.migrated++;
          }

          if (backup) {
            records.push({
              id: generateOnCallId(),
              team,
              role: label || "Backup",
              name: "",
              contact: backup,
              createdAt: now,
              updatedAt: now,
            });
            result.migrated++;
          }
        } catch (e) {
          result.errors.push(`Row ${i + 2}: ${e}`);
        }
      }
    } else {
      // Modern format
      const teamIdx = header.indexOf("team");
      const roleIdx = header.indexOf("role");
      const nameIdx = header.indexOf("name");
      const contactIdx = header.findIndex((h) => h === "contact" || h === "email" || h === "phone");
      const timeWindowIdx = header.findIndex(
        (h) => h === "time window" || h === "timewindow" || h === "shift" || h === "hours"
      );

      for (let i = 0; i < rows.length; i++) {
        try {
          const row = rows[i];
          const getVal = (idx: number) => (idx === -1 || idx >= row.length) ? "" : desanitizeField(row[idx]);

          const team = getVal(teamIdx);
          if (!team) continue;

          records.push({
            id: generateOnCallId(),
            team,
            role: getVal(roleIdx),
            name: getVal(nameIdx),
            contact: getVal(contactIdx),
            timeWindow: getVal(timeWindowIdx) || undefined,
            createdAt: now,
            updatedAt: now,
          });
          result.migrated++;
        } catch (e) {
          result.errors.push(`Row ${i + 2}: ${e}`);
        }
      }
    }

    // Write JSON file atomically
    const content = JSON.stringify(records, null, 2);
    await fs.writeFile(`${jsonPath}.tmp`, content, "utf-8");
    await fs.rename(`${jsonPath}.tmp`, jsonPath);

    loggers.fileManager.info(`[MigrationOperations] Migrated ${result.migrated} on-call records to JSON`);
  } catch (e) {
    result.errors.push(`Failed to migrate on-call: ${e}`);
    loggers.fileManager.error("[MigrationOperations] migrateOnCallCsv error:", { error: e });
  }

  return result;
}

/**
 * Archive CSV files after migration by renaming them
 */
async function archiveCsvFiles(rootDir: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filesToArchive = [CONTACTS_CSV, SERVERS_CSV, ONCALL_CSV];

  for (const file of filesToArchive) {
    const csvPath = join(rootDir, file);
    if (existsSync(csvPath)) {
      const archiveName = `${basename(file, ".csv")}_${timestamp}.csv.migrated`;
      const archivePath = join(rootDir, archiveName);
      try {
        await fs.rename(csvPath, archivePath);
        loggers.fileManager.info(`[MigrationOperations] Archived ${file} -> ${archiveName}`);
      } catch (e) {
        loggers.fileManager.warn(`[MigrationOperations] Failed to archive ${file}:`, { error: e });
      }
    }
  }
}

/**
 * Migrate all CSV files to JSON format
 */
export async function migrateAllCsvToJson(rootDir: string): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: false,
    contacts: { migrated: 0, errors: [] },
    servers: { migrated: 0, errors: [] },
    oncall: { migrated: 0, errors: [] },
  };

  try {
    // Create backup before migration - REQUIRED for safety
    loggers.fileManager.info("[MigrationOperations] Creating backup before migration...");
    const backupPath = await performBackup(rootDir, "pre-json-migration");

    if (!backupPath) {
      const errorMsg = "Failed to create backup - migration aborted for safety";
      loggers.fileManager.error(`[MigrationOperations] ${errorMsg}`);
      result.contacts.errors.push(errorMsg);
      return result;
    }

    result.backupPath = backupPath;
    loggers.fileManager.info(`[MigrationOperations] Backup created at: ${backupPath}`);

    // Migrate each type
    loggers.fileManager.info("[MigrationOperations] Starting migration...");

    result.contacts = await migrateContactsCsv(rootDir);
    result.servers = await migrateServersCsv(rootDir);
    result.oncall = await migrateOnCallCsv(rootDir);

    // Archive CSV files
    await archiveCsvFiles(rootDir);

    const totalMigrated =
      result.contacts.migrated + result.servers.migrated + result.oncall.migrated;
    const totalErrors =
      result.contacts.errors.length + result.servers.errors.length + result.oncall.errors.length;

    result.success = totalErrors === 0;

    loggers.fileManager.info(
      `[MigrationOperations] Migration complete: ${totalMigrated} records migrated, ${totalErrors} errors`
    );
  } catch (e) {
    loggers.fileManager.error("[MigrationOperations] migrateAllCsvToJson error:", { error: e });
    result.contacts.errors.push(`Migration failed: ${e}`);
  }

  return result;
}

/**
 * Check if CSV files exist (for UI to show migration option)
 */
export async function hasCsvFiles(rootDir: string): Promise<boolean> {
  return (
    existsSync(join(rootDir, CONTACTS_CSV)) ||
    existsSync(join(rootDir, SERVERS_CSV)) ||
    existsSync(join(rootDir, ONCALL_CSV))
  );
}
