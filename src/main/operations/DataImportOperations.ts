/**
 * DataImportOperations - Import data from JSON or CSV format
 */

import { dialog } from "electron";
import fs from "fs/promises";
import type {
  ContactRecord,
  ServerRecord,
  OnCallRecord,
  BridgeGroup,
  ImportResult,
  DataCategory,
} from "@shared/ipc";
import { bulkUpsertContacts } from "./ContactJsonOperations";
import { bulkUpsertServers } from "./ServerJsonOperations";
import { bulkUpsertOnCall } from "./OnCallJsonOperations";
import { getGroups, saveGroup } from "./PresetOperations";
import { parseCsvAsync, desanitizeField } from "../csvUtils";
import { HeaderMatcher } from "../HeaderMatcher";
import { CONTACT_COLUMN_ALIASES, SERVER_COLUMN_ALIASES } from "@shared/csvTypes";
import { loggers } from "../logger";

// Maximum number of records allowed in a single import
const MAX_IMPORT_RECORDS = 100000;

// Basic email validation regex - allows most valid emails without being overly strict
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate email format
 */
function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

/**
 * Safely parse JSON with error handling
 */
function safeJsonParse(content: string, context: string): unknown {
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error(`Invalid JSON format in ${context}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Detect file format from content
 */
function detectFormat(content: string): "json" | "csv" {
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "json";
  }
  return "csv";
}

/**
 * Parse contacts from JSON with validation
 */
function parseContactsJson(content: string): Omit<ContactRecord, "id" | "createdAt" | "updatedAt">[] {
  const data = safeJsonParse(content, "contacts");
  const records = Array.isArray(data) ? data : (data as Record<string, unknown>).contacts || [];

  if (!Array.isArray(records)) {
    throw new Error("Invalid contacts data: expected an array");
  }
  if (records.length > MAX_IMPORT_RECORDS) {
    throw new Error(`Import limit exceeded: maximum ${MAX_IMPORT_RECORDS} records allowed`);
  }

  const validRecords: Omit<ContactRecord, "id" | "createdAt" | "updatedAt">[] = [];
  const invalidEmails: string[] = [];

  for (const r of records as Record<string, unknown>[]) {
    const email = String(r.email || "").toLowerCase().trim();
    if (!email) continue; // Skip records without email

    if (!isValidEmail(email)) {
      invalidEmails.push(email);
      continue;
    }

    validRecords.push({
      name: String(r.name || ""),
      email,
      phone: String(r.phone || ""),
      title: String(r.title || ""),
    });
  }

  if (invalidEmails.length > 0) {
    loggers.fileManager.warn(`[DataImportOperations] Skipped ${invalidEmails.length} contacts with invalid emails`);
  }

  return validRecords;
}

/**
 * Parse contacts from CSV
 */
async function parseContactsCsv(content: string): Promise<Omit<ContactRecord, "id" | "createdAt" | "updatedAt">[]> {
  const data = await parseCsvAsync(content);
  if (data.length < 2) return [];

  const header = data[0].map((h: string) => desanitizeField(String(h).trim().toLowerCase()));
  const rows = data.slice(1);
  const matcher = new HeaderMatcher(header);

  const nameIdx = matcher.findColumn(CONTACT_COLUMN_ALIASES.name);
  const emailIdx = matcher.findColumn(CONTACT_COLUMN_ALIASES.email);
  const phoneIdx = matcher.findColumn(CONTACT_COLUMN_ALIASES.phone);
  const titleIdx = matcher.findColumn(CONTACT_COLUMN_ALIASES.title);

  return rows
    .map((row: string[]) => {
      const getVal = (idx: number) => (idx === -1 || idx >= row.length) ? "" : desanitizeField(row[idx]);
      return {
        name: getVal(nameIdx),
        email: getVal(emailIdx),
        phone: getVal(phoneIdx),
        title: getVal(titleIdx),
      };
    })
    .filter((c) => c.email); // Must have email
}

/**
 * Parse servers from JSON with validation
 */
function parseServersJson(content: string): Omit<ServerRecord, "id" | "createdAt" | "updatedAt">[] {
  const data = safeJsonParse(content, "servers");
  const records = Array.isArray(data) ? data : (data as Record<string, unknown>).servers || [];

  if (!Array.isArray(records)) {
    throw new Error("Invalid servers data: expected an array");
  }
  if (records.length > MAX_IMPORT_RECORDS) {
    throw new Error(`Import limit exceeded: maximum ${MAX_IMPORT_RECORDS} records allowed`);
  }

  return (records as Record<string, unknown>[])
    .map((r) => ({
      name: String(r.name || "").trim(),
      businessArea: String(r.businessArea || r["business area"] || ""),
      lob: String(r.lob || ""),
      comment: String(r.comment || ""),
      owner: String(r.owner || ""),
      contact: String(r.contact || ""),
      os: String(r.os || ""),
    }))
    .filter((s) => s.name); // Must have name
}

/**
 * Parse servers from CSV
 */
async function parseServersCsv(content: string): Promise<Omit<ServerRecord, "id" | "createdAt" | "updatedAt">[]> {
  const data = await parseCsvAsync(content);
  if (data.length < 2) return [];

  const header = data[0].map((h: string) => desanitizeField(String(h).trim().toLowerCase()));
  const rows = data.slice(1);
  const matcher = new HeaderMatcher(header);

  const nameIdx = matcher.findColumn(SERVER_COLUMN_ALIASES.name);
  const baIdx = matcher.findColumn(SERVER_COLUMN_ALIASES.businessArea);
  const lobIdx = matcher.findColumn(SERVER_COLUMN_ALIASES.lob);
  const commentIdx = matcher.findColumn(SERVER_COLUMN_ALIASES.comment);
  const ownerIdx = matcher.findColumn(SERVER_COLUMN_ALIASES.owner);
  const contactIdx = matcher.findColumn(SERVER_COLUMN_ALIASES.contact);
  const osIdx = matcher.findColumn(SERVER_COLUMN_ALIASES.os);

  return rows
    .map((row: string[]) => {
      const getVal = (idx: number) => (idx === -1 || idx >= row.length) ? "" : desanitizeField(row[idx]);
      return {
        name: getVal(nameIdx),
        businessArea: getVal(baIdx),
        lob: getVal(lobIdx),
        comment: getVal(commentIdx),
        owner: getVal(ownerIdx),
        contact: getVal(contactIdx),
        os: getVal(osIdx),
      };
    })
    .filter((s) => s.name); // Must have name
}

/**
 * Parse on-call from JSON with validation
 */
function parseOnCallJson(content: string): Omit<OnCallRecord, "id" | "createdAt" | "updatedAt">[] {
  const data = safeJsonParse(content, "on-call");
  const records = Array.isArray(data) ? data : (data as Record<string, unknown>).onCall || (data as Record<string, unknown>).oncall || [];

  if (!Array.isArray(records)) {
    throw new Error("Invalid on-call data: expected an array");
  }
  if (records.length > MAX_IMPORT_RECORDS) {
    throw new Error(`Import limit exceeded: maximum ${MAX_IMPORT_RECORDS} records allowed`);
  }

  return (records as Record<string, unknown>[])
    .map((r) => ({
      team: String(r.team || "").trim(),
      role: String(r.role || ""),
      name: String(r.name || ""),
      contact: String(r.contact || ""),
      timeWindow: r.timeWindow ? String(r.timeWindow) : undefined,
    }))
    .filter((r) => r.team); // Must have team
}

/**
 * Parse on-call from CSV
 */
async function parseOnCallCsv(content: string): Promise<Omit<OnCallRecord, "id" | "createdAt" | "updatedAt">[]> {
  const data = await parseCsvAsync(content);
  if (data.length < 2) return [];

  const header = data[0].map((h: string) => desanitizeField(String(h).trim().toLowerCase()));
  const rows = data.slice(1);

  const teamIdx = header.indexOf("team");
  const roleIdx = header.indexOf("role");
  const nameIdx = header.indexOf("name");
  const contactIdx = header.findIndex((h) => h === "contact" || h === "email" || h === "phone");
  const timeWindowIdx = header.findIndex(
    (h) => h === "time window" || h === "timewindow" || h === "shift" || h === "hours"
  );

  return rows
    .map((row: string[]) => {
      const getVal = (idx: number) => (idx === -1 || idx >= row.length) ? "" : desanitizeField(row[idx]);
      return {
        team: getVal(teamIdx),
        role: getVal(roleIdx),
        name: getVal(nameIdx),
        contact: getVal(contactIdx),
        timeWindow: getVal(timeWindowIdx) || undefined,
      };
    })
    .filter((r) => r.team); // Must have team
}

/**
 * Parse groups from JSON with validation
 */
function parseGroupsJson(content: string): Omit<BridgeGroup, "id" | "createdAt" | "updatedAt">[] {
  const data = safeJsonParse(content, "groups");
  const records = Array.isArray(data) ? data : (data as Record<string, unknown>).groups || [];

  if (!Array.isArray(records)) {
    throw new Error("Invalid groups data: expected an array");
  }
  if (records.length > MAX_IMPORT_RECORDS) {
    throw new Error(`Import limit exceeded: maximum ${MAX_IMPORT_RECORDS} records allowed`);
  }

  return (records as Record<string, unknown>[])
    .map((r) => ({
      name: String(r.name || "").trim(),
      contacts: Array.isArray(r.contacts)
        ? r.contacts.map((c) => String(c).toLowerCase().trim()).filter(Boolean)
        : [],
    }))
    .filter((g) => g.name); // Must have name
}

/**
 * Parse groups from CSV
 */
async function parseGroupsCsv(content: string): Promise<Omit<BridgeGroup, "id" | "createdAt" | "updatedAt">[]> {
  const data = await parseCsvAsync(content);
  if (data.length < 2) return [];

  const header = data[0].map((h: string) => desanitizeField(String(h).trim().toLowerCase()));
  const rows = data.slice(1);

  const nameIdx = header.findIndex((h) => h === "name" || h === "group" || h === "group_name");
  const contactsIdx = header.findIndex((h) => h === "contacts" || h === "members" || h === "emails");

  // Check if this is a flat format (group_name, email per row)
  const emailIdx = header.findIndex((h) => h === "email" || h === "member" || h === "contact");

  if (emailIdx !== -1 && nameIdx !== -1 && contactsIdx === -1) {
    // Flat format: group emails by group name
    const groupMap = new Map<string, string[]>();
    for (const row of rows) {
      const name = desanitizeField(row[nameIdx] || "").trim();
      const email = desanitizeField(row[emailIdx] || "").trim().toLowerCase();
      if (!name || !email) continue;

      if (!groupMap.has(name)) {
        groupMap.set(name, []);
      }
      const emails = groupMap.get(name)!;
      if (!emails.includes(email)) {
        emails.push(email);
      }
    }

    return Array.from(groupMap.entries()).map(([name, contacts]) => ({
      name,
      contacts,
    }));
  }

  // Standard format: name, contacts (semicolon-separated)
  return rows
    .map((row: string[]) => {
      const name = nameIdx !== -1 ? desanitizeField(row[nameIdx] || "").trim() : "";
      const contactsStr = contactsIdx !== -1 ? desanitizeField(row[contactsIdx] || "") : "";
      const contacts = contactsStr
        .split(/[;,]/)
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);
      return { name, contacts };
    })
    .filter((g) => g.name && g.contacts.length > 0);
}

/**
 * Import data from a file (with dialog)
 */
export async function importData(
  rootDir: string,
  category: DataCategory
): Promise<ImportResult> {
  const result: ImportResult = {
    success: false,
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  try {
    // Show open dialog
    const dialogResult = await dialog.showOpenDialog({
      title: `Import ${category}`,
      filters: [
        { name: "All Supported", extensions: ["json", "csv"] },
        { name: "JSON Files", extensions: ["json"] },
        { name: "CSV Files", extensions: ["csv"] },
      ],
      properties: ["openFile"],
    });

    if (dialogResult.canceled || !dialogResult.filePaths[0]) {
      return result;
    }

    const filePath = dialogResult.filePaths[0];
    const content = await fs.readFile(filePath, "utf-8");
    // Remove BOM if present
    const cleanContent = content.replace(/^\uFEFF/, "");
    const format = detectFormat(cleanContent);

    switch (category) {
      case "contacts": {
        const records = format === "json"
          ? parseContactsJson(cleanContent)
          : await parseContactsCsv(cleanContent);

        const upsertResult = await bulkUpsertContacts(rootDir, records);
        result.imported = upsertResult.imported;
        result.updated = upsertResult.updated;
        result.errors = upsertResult.errors;
        break;
      }
      case "servers": {
        const records = format === "json"
          ? parseServersJson(cleanContent)
          : await parseServersCsv(cleanContent);

        const upsertResult = await bulkUpsertServers(rootDir, records);
        result.imported = upsertResult.imported;
        result.updated = upsertResult.updated;
        result.errors = upsertResult.errors;
        break;
      }
      case "oncall": {
        const records = format === "json"
          ? parseOnCallJson(cleanContent)
          : await parseOnCallCsv(cleanContent);

        const upsertResult = await bulkUpsertOnCall(rootDir, records);
        result.imported = upsertResult.imported;
        result.updated = upsertResult.updated;
        result.errors = upsertResult.errors;
        break;
      }
      case "groups": {
        const records = format === "json"
          ? parseGroupsJson(cleanContent)
          : await parseGroupsCsv(cleanContent);

        const existingGroups = await getGroups(rootDir);
        const existingNames = new Set(existingGroups.map((g) => g.name.toLowerCase()));

        for (const record of records) {
          if (existingNames.has(record.name.toLowerCase())) {
            result.skipped++;
          } else {
            const saved = await saveGroup(rootDir, record);
            if (saved) {
              result.imported++;
            } else {
              result.errors.push(`Failed to save group: ${record.name}`);
            }
          }
        }
        break;
      }
      case "all": {
        // For "all", we expect a JSON file with all categories
        if (format !== "json") {
          result.errors.push("Import all requires a JSON file");
          return result;
        }

        const data = JSON.parse(cleanContent);

        if (data.contacts && Array.isArray(data.contacts)) {
          const contactResult = await bulkUpsertContacts(rootDir, data.contacts);
          result.imported += contactResult.imported;
          result.updated += contactResult.updated;
          result.errors.push(...contactResult.errors.map((e) => `[contacts] ${e}`));
        }

        if (data.servers && Array.isArray(data.servers)) {
          const serverResult = await bulkUpsertServers(rootDir, data.servers);
          result.imported += serverResult.imported;
          result.updated += serverResult.updated;
          result.errors.push(...serverResult.errors.map((e) => `[servers] ${e}`));
        }

        if (data.onCall && Array.isArray(data.onCall)) {
          const onCallResult = await bulkUpsertOnCall(rootDir, data.onCall);
          result.imported += onCallResult.imported;
          result.updated += onCallResult.updated;
          result.errors.push(...onCallResult.errors.map((e) => `[oncall] ${e}`));
        }

        if (data.groups && Array.isArray(data.groups)) {
          const existingGroups = await getGroups(rootDir);
          const existingNames = new Set(existingGroups.map((g) => g.name.toLowerCase()));

          for (const record of data.groups) {
            if (existingNames.has(record.name.toLowerCase())) {
              result.skipped++;
            } else {
              const saved = await saveGroup(rootDir, record);
              if (saved) {
                result.imported++;
              } else {
                result.errors.push(`[groups] Failed to save group: ${record.name}`);
              }
            }
          }
        }
        break;
      }
    }

    result.success = result.errors.length === 0;
    loggers.fileManager.info(
      `[DataImportOperations] Import ${category}: ${result.imported} imported, ${result.updated} updated, ${result.skipped} skipped, ${result.errors.length} errors`
    );
  } catch (e) {
    result.errors.push(`Import failed: ${e}`);
    loggers.fileManager.error("[DataImportOperations] importData error:", { error: e });
  }

  return result;
}

/**
 * Import from a specific path (for programmatic use)
 */
export async function importFromPath(
  rootDir: string,
  filePath: string,
  category: DataCategory
): Promise<ImportResult> {
  const result: ImportResult = {
    success: false,
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const cleanContent = content.replace(/^\uFEFF/, "");
    const format = detectFormat(cleanContent);

    switch (category) {
      case "contacts": {
        const records = format === "json"
          ? parseContactsJson(cleanContent)
          : await parseContactsCsv(cleanContent);
        const upsertResult = await bulkUpsertContacts(rootDir, records);
        result.imported = upsertResult.imported;
        result.updated = upsertResult.updated;
        result.errors = upsertResult.errors;
        break;
      }
      case "servers": {
        const records = format === "json"
          ? parseServersJson(cleanContent)
          : await parseServersCsv(cleanContent);
        const upsertResult = await bulkUpsertServers(rootDir, records);
        result.imported = upsertResult.imported;
        result.updated = upsertResult.updated;
        result.errors = upsertResult.errors;
        break;
      }
      case "oncall": {
        const records = format === "json"
          ? parseOnCallJson(cleanContent)
          : await parseOnCallCsv(cleanContent);
        const upsertResult = await bulkUpsertOnCall(rootDir, records);
        result.imported = upsertResult.imported;
        result.updated = upsertResult.updated;
        result.errors = upsertResult.errors;
        break;
      }
      case "groups": {
        const records = format === "json"
          ? parseGroupsJson(cleanContent)
          : await parseGroupsCsv(cleanContent);
        const existingGroups = await getGroups(rootDir);
        const existingNames = new Set(existingGroups.map((g) => g.name.toLowerCase()));
        for (const record of records) {
          if (existingNames.has(record.name.toLowerCase())) {
            result.skipped++;
          } else {
            const saved = await saveGroup(rootDir, record);
            if (saved) result.imported++;
            else result.errors.push(`Failed to save group: ${record.name}`);
          }
        }
        break;
      }
      default:
        result.errors.push(`Unknown category: ${category}`);
    }

    result.success = result.errors.length === 0;
  } catch (e) {
    result.errors.push(`Import failed: ${e}`);
    loggers.fileManager.error("[DataImportOperations] importFromPath error:", { error: e });
  }

  return result;
}
