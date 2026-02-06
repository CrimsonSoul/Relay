/**
 * DataImportOperations - Import data from JSON or CSV format
 */

import { dialog } from 'electron';
import fs from 'fs/promises';
import type {
  ContactRecord,
  ServerRecord,
  OnCallRecord,
  BridgeGroup,
  ImportResult,
  DataCategory,
} from '@shared/ipc';
import { isValidEmail, isValidPhone } from '../csvValidation';
import { getErrorMessage } from '@shared/types';
import { bulkUpsertContacts } from './ContactJsonOperations';
import { bulkUpsertServers } from './ServerJsonOperations';
import { bulkUpsertOnCall } from './OnCallJsonOperations';
import { getGroups, saveGroup } from './PresetOperations';
import { parseCsvAsync, desanitizeField } from '../csvUtils';
import { HeaderMatcher } from '../HeaderMatcher';
import { CONTACT_COLUMN_ALIASES, SERVER_COLUMN_ALIASES } from '@shared/csvTypes';
import { loggers } from '../logger';

// Maximum number of records allowed in a single import
const MAX_IMPORT_RECORDS = 100000;

/**
 * Safely parse JSON with error handling
 */
function safeJsonParse(content: string, context: string): unknown {
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error(`Invalid JSON format in ${context}: ${getErrorMessage(e)}`);
  }
}

/**
 * Detect file format from content
 */
function detectFormat(content: string): 'json' | 'csv' {
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return 'json';
  }
  return 'csv';
}

/**
 * Parse contacts from JSON with validation
 */
function parseContactsJson(
  content: string,
): Omit<ContactRecord, 'id' | 'createdAt' | 'updatedAt'>[] {
  const data = safeJsonParse(content, 'contacts');
  const records = Array.isArray(data) ? data : (data as Record<string, unknown>).contacts || [];

  if (!Array.isArray(records)) {
    throw new Error('Invalid contacts data: expected an array');
  }
  if (records.length > MAX_IMPORT_RECORDS) {
    throw new Error(`Import limit exceeded: maximum ${MAX_IMPORT_RECORDS} records allowed`);
  }

  const validRecords: Omit<ContactRecord, 'id' | 'createdAt' | 'updatedAt'>[] = [];
  const invalidEmails: string[] = [];
  const invalidPhones: string[] = [];

  for (const r of records as Record<string, unknown>[]) {
    const email = String(r.email || '')
      .toLowerCase()
      .trim();
    if (!email) continue; // Skip records without email

    if (!isValidEmail(email)) {
      invalidEmails.push(email);
      continue;
    }

    const rawPhone = String(r.phone || '');
    const phone = rawPhone && !isValidPhone(rawPhone) ? '' : rawPhone;
    if (rawPhone && !phone) {
      invalidPhones.push(rawPhone);
    }

    validRecords.push({
      name: String(r.name || ''),
      email,
      phone,
      title: String(r.title || ''),
    });
  }

  if (invalidEmails.length > 0) {
    loggers.fileManager.warn(
      `[DataImportOperations] Skipped ${invalidEmails.length} contacts with invalid emails`,
    );
  }
  if (invalidPhones.length > 0) {
    loggers.fileManager.warn(
      `[DataImportOperations] Cleared ${invalidPhones.length} contacts with invalid phone numbers`,
    );
  }

  return validRecords;
}

/**
 * Parse contacts from CSV
 */
async function parseContactsCsv(
  content: string,
): Promise<Omit<ContactRecord, 'id' | 'createdAt' | 'updatedAt'>[]> {
  const data = await parseCsvAsync(content);
  if (data.length < 2) return [];

  const header = data[0].map((h: string) => desanitizeField(String(h).trim().toLowerCase()));
  const rows = data.slice(1);
  const matcher = new HeaderMatcher(header);

  const nameIdx = matcher.findColumn(CONTACT_COLUMN_ALIASES.name);
  const emailIdx = matcher.findColumn(CONTACT_COLUMN_ALIASES.email);
  const phoneIdx = matcher.findColumn(CONTACT_COLUMN_ALIASES.phone);
  const titleIdx = matcher.findColumn(CONTACT_COLUMN_ALIASES.title);

  const invalidPhones: string[] = [];

  const records = rows
    .map((row: string[]) => {
      const getVal = (idx: number) =>
        idx === -1 || idx >= row.length ? '' : desanitizeField(row[idx]);
      return {
        name: getVal(nameIdx),
        email: getVal(emailIdx),
        phone: getVal(phoneIdx),
        title: getVal(titleIdx),
      };
    })
    .filter((c) => c.email) // Must have email
    .map((c) => {
      if (c.phone && !isValidPhone(c.phone)) {
        invalidPhones.push(c.phone);
        return { ...c, phone: '' };
      }
      return c;
    });

  if (invalidPhones.length > 0) {
    loggers.fileManager.warn(
      `[DataImportOperations] Cleared ${invalidPhones.length} contacts with invalid phone numbers during CSV import`,
    );
  }

  return records;
}

/**
 * Parse servers from JSON with validation
 */
function parseServersJson(content: string): Omit<ServerRecord, 'id' | 'createdAt' | 'updatedAt'>[] {
  const data = safeJsonParse(content, 'servers');
  const records = Array.isArray(data) ? data : (data as Record<string, unknown>).servers || [];

  if (!Array.isArray(records)) {
    throw new Error('Invalid servers data: expected an array');
  }
  if (records.length > MAX_IMPORT_RECORDS) {
    throw new Error(`Import limit exceeded: maximum ${MAX_IMPORT_RECORDS} records allowed`);
  }

  return (records as Record<string, unknown>[])
    .map((r) => ({
      name: String(r.name || '').trim(),
      businessArea: String(r.businessArea || r['business area'] || ''),
      lob: String(r.lob || ''),
      comment: String(r.comment || ''),
      owner: String(r.owner || ''),
      contact: String(r.contact || ''),
      os: String(r.os || ''),
    }))
    .filter((s) => s.name); // Must have name
}

/**
 * Parse servers from CSV
 */
async function parseServersCsv(
  content: string,
): Promise<Omit<ServerRecord, 'id' | 'createdAt' | 'updatedAt'>[]> {
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
      const getVal = (idx: number) =>
        idx === -1 || idx >= row.length ? '' : desanitizeField(row[idx]);
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
function parseOnCallJson(content: string): Omit<OnCallRecord, 'id' | 'createdAt' | 'updatedAt'>[] {
  const data = safeJsonParse(content, 'on-call');
  const records = Array.isArray(data)
    ? data
    : (data as Record<string, unknown>).onCall || (data as Record<string, unknown>).oncall || [];

  if (!Array.isArray(records)) {
    throw new Error('Invalid on-call data: expected an array');
  }
  if (records.length > MAX_IMPORT_RECORDS) {
    throw new Error(`Import limit exceeded: maximum ${MAX_IMPORT_RECORDS} records allowed`);
  }

  return (records as Record<string, unknown>[])
    .map((r) => ({
      team: String(r.team || '').trim(),
      role: String(r.role || ''),
      name: String(r.name || ''),
      contact: String(r.contact || ''),
      timeWindow: r.timeWindow ? String(r.timeWindow) : undefined,
    }))
    .filter((r) => r.team); // Must have team
}

/**
 * Parse on-call from CSV
 */
async function parseOnCallCsv(
  content: string,
): Promise<Omit<OnCallRecord, 'id' | 'createdAt' | 'updatedAt'>[]> {
  const data = await parseCsvAsync(content);
  if (data.length < 2) return [];

  const header = data[0].map((h: string) => desanitizeField(String(h).trim().toLowerCase()));
  const rows = data.slice(1);

  const teamIdx = header.indexOf('team');
  const roleIdx = header.indexOf('role');
  const nameIdx = header.indexOf('name');
  const contactIdx = header.findIndex((h) => h === 'contact' || h === 'email' || h === 'phone');
  const timeWindowIdx = header.findIndex(
    (h) => h === 'time window' || h === 'timewindow' || h === 'shift' || h === 'hours',
  );

  return rows
    .map((row: string[]) => {
      const getVal = (idx: number) =>
        idx === -1 || idx >= row.length ? '' : desanitizeField(row[idx]);
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
function parseGroupsJson(content: string): Omit<BridgeGroup, 'id' | 'createdAt' | 'updatedAt'>[] {
  const data = safeJsonParse(content, 'groups');
  const records = Array.isArray(data) ? data : (data as Record<string, unknown>).groups || [];

  if (!Array.isArray(records)) {
    throw new Error('Invalid groups data: expected an array');
  }
  if (records.length > MAX_IMPORT_RECORDS) {
    throw new Error(`Import limit exceeded: maximum ${MAX_IMPORT_RECORDS} records allowed`);
  }

  return (records as Record<string, unknown>[])
    .map((r) => ({
      name: String(r.name || '').trim(),
      contacts: Array.isArray(r.contacts)
        ? r.contacts.map((c) => String(c).toLowerCase().trim()).filter(Boolean)
        : [],
    }))
    .filter((g) => g.name); // Must have name
}

/**
 * Parse groups from CSV
 */
async function parseGroupsCsv(
  content: string,
): Promise<Omit<BridgeGroup, 'id' | 'createdAt' | 'updatedAt'>[]> {
  const data = await parseCsvAsync(content);
  if (data.length < 2) return [];

  const header = data[0].map((h: string) => desanitizeField(String(h).trim().toLowerCase()));
  const rows = data.slice(1);

  const nameIdx = header.findIndex((h) => h === 'name' || h === 'group' || h === 'group_name');
  const contactsIdx = header.findIndex(
    (h) => h === 'contacts' || h === 'members' || h === 'emails',
  );

  // Check if this is a flat format (group_name, email per row)
  const emailIdx = header.findIndex((h) => h === 'email' || h === 'member' || h === 'contact');

  if (emailIdx !== -1 && nameIdx !== -1 && contactsIdx === -1) {
    // Flat format: group emails by group name
    const groupMap = new Map<string, string[]>();
    for (const row of rows) {
      const name = desanitizeField(row[nameIdx] || '').trim();
      const email = desanitizeField(row[emailIdx] || '')
        .trim()
        .toLowerCase();
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
      const name = nameIdx !== -1 ? desanitizeField(row[nameIdx] || '').trim() : '';
      const contactsStr = contactsIdx !== -1 ? desanitizeField(row[contactsIdx] || '') : '';
      const contacts = contactsStr
        .split(/[;,]/)
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);
      return { name, contacts };
    })
    .filter((g) => g.name && g.contacts.length > 0);
}

/**
 * Process import content for a given category.
 * Shared logic used by both importData and importFromPath.
 */
async function processImportContent(
  rootDir: string,
  content: string,
  category: DataCategory,
): Promise<ImportResult> {
  const result: ImportResult = {
    success: false,
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  const format = detectFormat(content);

  switch (category) {
    case 'contacts': {
      const records =
        format === 'json' ? parseContactsJson(content) : await parseContactsCsv(content);

      const upsertResult = await bulkUpsertContacts(rootDir, records);
      result.imported = upsertResult.imported;
      result.updated = upsertResult.updated;
      result.errors = upsertResult.errors;
      break;
    }
    case 'servers': {
      const records =
        format === 'json' ? parseServersJson(content) : await parseServersCsv(content);

      const upsertResult = await bulkUpsertServers(rootDir, records);
      result.imported = upsertResult.imported;
      result.updated = upsertResult.updated;
      result.errors = upsertResult.errors;
      break;
    }
    case 'oncall': {
      const records = format === 'json' ? parseOnCallJson(content) : await parseOnCallCsv(content);

      const upsertResult = await bulkUpsertOnCall(rootDir, records);
      result.imported = upsertResult.imported;
      result.updated = upsertResult.updated;
      result.errors = upsertResult.errors;
      break;
    }
    case 'groups': {
      const records = format === 'json' ? parseGroupsJson(content) : await parseGroupsCsv(content);

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
    case 'all': {
      // For "all", we expect a JSON file with all categories
      if (format !== 'json') {
        result.errors.push('Import all requires a JSON file');
        return result;
      }

      const data = JSON.parse(content);

      if (data.contacts && Array.isArray(data.contacts)) {
        const contactResult = await bulkUpsertContacts(rootDir, data.contacts);
        result.imported += contactResult.imported;
        result.updated += contactResult.updated;
        result.errors.push(...contactResult.errors.map((e: string) => `[contacts] ${e}`));
      }

      if (data.servers && Array.isArray(data.servers)) {
        const serverResult = await bulkUpsertServers(rootDir, data.servers);
        result.imported += serverResult.imported;
        result.updated += serverResult.updated;
        result.errors.push(...serverResult.errors.map((e: string) => `[servers] ${e}`));
      }

      if (data.onCall && Array.isArray(data.onCall)) {
        const onCallResult = await bulkUpsertOnCall(rootDir, data.onCall);
        result.imported += onCallResult.imported;
        result.updated += onCallResult.updated;
        result.errors.push(...onCallResult.errors.map((e: string) => `[oncall] ${e}`));
      }

      if (data.groups && Array.isArray(data.groups)) {
        const existingGroups = await getGroups(rootDir);
        const existingNames = new Set(existingGroups.map((g: BridgeGroup) => g.name.toLowerCase()));

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
    default:
      result.errors.push(`Unknown category: ${category}`);
  }

  result.success = result.errors.length === 0;
  return result;
}

/**
 * Import data from a file (with dialog)
 */
export async function importData(rootDir: string, category: DataCategory): Promise<ImportResult> {
  try {
    // Show open dialog
    const dialogResult = await dialog.showOpenDialog({
      title: `Import ${category}`,
      filters: [
        { name: 'All Supported', extensions: ['json', 'csv'] },
        { name: 'JSON Files', extensions: ['json'] },
        { name: 'CSV Files', extensions: ['csv'] },
      ],
      properties: ['openFile'],
    });

    if (dialogResult.canceled || !dialogResult.filePaths[0]) {
      return {
        success: false,
        imported: 0,
        updated: 0,
        skipped: 0,
        errors: [],
      };
    }

    const filePath = dialogResult.filePaths[0];
    const stats = await fs.stat(filePath);
    const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
    if (stats.size > MAX_FILE_SIZE) {
      return {
        success: false,
        imported: 0,
        updated: 0,
        skipped: 0,
        errors: [`File too large: ${Math.round(stats.size / 1024 / 1024)}MB (max 50MB)`],
      };
    }

    const content = await fs.readFile(filePath, 'utf-8');
    // Remove BOM if present
    const cleanContent = content.replace(/^\uFEFF/, '');

    const result = await processImportContent(rootDir, cleanContent, category);
    loggers.fileManager.info(
      `[DataImportOperations] Import ${category}: ${result.imported} imported, ${result.updated} updated, ${result.skipped} skipped, ${result.errors.length} errors`,
    );
    return result;
  } catch (e) {
    loggers.fileManager.error('[DataImportOperations] importData error:', { error: e });
    return {
      success: false,
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [`Import failed: ${e}`],
    };
  }
}
