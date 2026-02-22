/**
 * DataImportOperations - Import data from JSON or CSV format
 */

import { dialog } from 'electron';
import fs from 'node:fs/promises';
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

export type ImportedContact = Omit<ContactRecord, 'id' | 'createdAt' | 'updatedAt'>;
export type ImportedServer = Omit<ServerRecord, 'id' | 'createdAt' | 'updatedAt'>;
export type ImportedOnCall = Omit<OnCallRecord, 'id' | 'createdAt' | 'updatedAt'>;
export type ImportedBridgeGroup = Omit<BridgeGroup, 'id' | 'createdAt' | 'updatedAt'>;

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

/** Safely coerce an unknown field to string, avoiding [object Object] stringification. */
function strVal(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return '';
}

/**
 * Parse contacts from JSON with validation
 */
/**
 * Validate and normalize an array of contact records
 */
function validateContactRecords(records: unknown[]): ImportedContact[] {
  if (records.length > MAX_IMPORT_RECORDS) {
    throw new Error(`Import limit exceeded: maximum ${MAX_IMPORT_RECORDS} records allowed`);
  }

  const validRecords: ImportedContact[] = [];
  const invalidEmails: string[] = [];
  const invalidPhones: string[] = [];

  for (const r of records as Record<string, unknown>[]) {
    const email = strVal(r.email).toLowerCase().trim();
    if (!email) continue; // Skip records without email

    if (!isValidEmail(email)) {
      invalidEmails.push(email);
      continue;
    }

    const rawPhone = strVal(r.phone);
    const phone = rawPhone && !isValidPhone(rawPhone) ? '' : rawPhone;
    if (rawPhone && !phone) {
      invalidPhones.push(rawPhone);
    }

    validRecords.push({
      name: strVal(r.name),
      email,
      phone,
      title: strVal(r.title),
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

function parseContactsJson(content: string): ImportedContact[] {
  const data = safeJsonParse(content, 'contacts');
  const records = Array.isArray(data) ? data : (data as Record<string, unknown>).contacts || [];

  if (!Array.isArray(records)) {
    throw new TypeError('Invalid contacts data: expected an array');
  }

  return validateContactRecords(records);
}

/**
 * Parse contacts from CSV
 */
async function parseContactsCsv(content: string): Promise<ImportedContact[]> {
  const data = await parseCsvAsync(content);
  if (data.length < 2) return [];

  const header = data[0]!.map((h: string) => desanitizeField(String(h).trim().toLowerCase()));
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
 * Validate and normalize an array of server records
 */
function validateServerRecords(records: unknown[]): ImportedServer[] {
  if (records.length > MAX_IMPORT_RECORDS) {
    throw new Error(`Import limit exceeded: maximum ${MAX_IMPORT_RECORDS} records allowed`);
  }

  return (records as Record<string, unknown>[])
    .map((r) => ({
      name: strVal(r.name).trim(),
      businessArea: strVal(r.businessArea || r['business area']),
      lob: strVal(r.lob),
      comment: strVal(r.comment),
      owner: strVal(r.owner),
      contact: strVal(r.contact),
      os: strVal(r.os),
    }))
    .filter((s) => s.name); // Must have name
}

function parseServersJson(content: string): ImportedServer[] {
  const data = safeJsonParse(content, 'servers');
  const records = Array.isArray(data) ? data : (data as Record<string, unknown>).servers || [];

  if (!Array.isArray(records)) {
    throw new TypeError('Invalid servers data: expected an array');
  }

  return validateServerRecords(records);
}

/**
 * Parse servers from CSV
 */
async function parseServersCsv(content: string): Promise<ImportedServer[]> {
  const data = await parseCsvAsync(content);
  if (data.length < 2) return [];

  const header = data[0]!.map((h: string) => desanitizeField(String(h).trim().toLowerCase()));
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
 * Validate and normalize an array of on-call records
 */
function validateOnCallRecords(records: unknown[]): ImportedOnCall[] {
  if (records.length > MAX_IMPORT_RECORDS) {
    throw new Error(`Import limit exceeded: maximum ${MAX_IMPORT_RECORDS} records allowed`);
  }

  return (records as Record<string, unknown>[])
    .map((r) => ({
      team: strVal(r.team).trim(),
      role: strVal(r.role),
      name: strVal(r.name),
      contact: strVal(r.contact),
      timeWindow:
        r.timeWindow !== undefined && r.timeWindow !== null
          ? strVal(r.timeWindow) || undefined
          : undefined,
    }))
    .filter((r) => r.team); // Must have team
}

function parseOnCallJson(content: string): ImportedOnCall[] {
  const data = safeJsonParse(content, 'on-call');
  const records = Array.isArray(data)
    ? data
    : (data as Record<string, unknown>).onCall || (data as Record<string, unknown>).oncall || [];

  if (!Array.isArray(records)) {
    throw new TypeError('Invalid on-call data: expected an array');
  }

  return validateOnCallRecords(records);
}

/**
 * Parse on-call from CSV
 */
async function parseOnCallCsv(content: string): Promise<ImportedOnCall[]> {
  const data = await parseCsvAsync(content);
  if (data.length < 2) return [];

  const header = data[0]!.map((h: string) => desanitizeField(String(h).trim().toLowerCase()));
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
function parseGroupsJson(content: string): ImportedBridgeGroup[] {
  const data = safeJsonParse(content, 'groups');
  const records = Array.isArray(data) ? data : (data as Record<string, unknown>).groups || [];

  if (!Array.isArray(records)) {
    throw new TypeError('Invalid groups data: expected an array');
  }
  if (records.length > MAX_IMPORT_RECORDS) {
    throw new TypeError(`Import limit exceeded: maximum ${MAX_IMPORT_RECORDS} records allowed`);
  }

  return (records as Record<string, unknown>[])
    .map((r) => ({
      name: strVal(r.name).trim(),
      contacts: Array.isArray(r.contacts)
        ? r.contacts.map((c) => strVal(c).toLowerCase().trim()).filter(Boolean)
        : [],
    }))
    .filter((g) => g.name); // Must have name
}

/**
 * Parse groups from CSV
 */
async function parseGroupsCsv(content: string): Promise<ImportedBridgeGroup[]> {
  const data = await parseCsvAsync(content);
  if (data.length < 2) return [];

  const header = data[0]!.map((h: string) => desanitizeField(String(h).trim().toLowerCase()));
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
      const name = nameIdx >= 0 ? desanitizeField(row[nameIdx] ?? '').trim() : '';
      const contactsStr =
        nameIdx >= 0 && contactsIdx >= 0 ? desanitizeField(row[contactsIdx] ?? '') : '';
      const contacts = contactsStr
        .split(/[;,]/)
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);
      return { name, contacts };
    })
    .filter((g) => g.name && g.contacts.length > 0);
}

/**
 * Merge a upsert result into the aggregated import result.
 */
function mergeUpsertResult(
  target: ImportResult,
  source: { imported: number; updated: number; errors: string[] },
  prefix: string,
) {
  target.imported += source.imported;
  target.updated += source.updated;
  target.errors.push(...source.errors.map((e) => `[${prefix}] ${e}`));
}

/**
 * Save groups, skipping ones that already exist by name.
 */
async function processGroups(
  rootDir: string,
  groups: ImportedBridgeGroup[],
  result: ImportResult,
): Promise<void> {
  const existing = await getGroups(rootDir);
  const existingNames = new Set(existing.map((g) => g.name.toLowerCase()));
  for (const record of groups) {
    if (existingNames.has(record.name.toLowerCase())) {
      result.skipped++;
    } else {
      const saved = await saveGroup(rootDir, record);
      if (saved) result.imported++;
      else result.errors.push(`Failed to save group: ${record.name}`);
    }
  }
}

/**
 * Handle 'all' category imports to reduce processImportContent complexity.
 */
async function processImportAll(
  rootDir: string,
  content: string,
  result: ImportResult,
): Promise<void> {
  const data = JSON.parse(content);

  if (data.contacts && Array.isArray(data.contacts)) {
    mergeUpsertResult(
      result,
      await bulkUpsertContacts(rootDir, validateContactRecords(data.contacts)),
      'contacts',
    );
  }
  if (data.servers && Array.isArray(data.servers)) {
    mergeUpsertResult(
      result,
      await bulkUpsertServers(rootDir, validateServerRecords(data.servers)),
      'servers',
    );
  }
  if (data.onCall && Array.isArray(data.onCall)) {
    mergeUpsertResult(
      result,
      await bulkUpsertOnCall(rootDir, validateOnCallRecords(data.onCall)),
      'oncall',
    );
  }
  if (data.groups && Array.isArray(data.groups)) {
    const validatedGroups = data.groups as ImportedBridgeGroup[];
    await processGroups(rootDir, validatedGroups, result);
  }
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
      await processGroups(rootDir, records, result);
      break;
    }
    case 'all': {
      if (format !== 'json') {
        result.errors.push('Import all requires a JSON file');
        return result;
      }
      await processImportAll(rootDir, content, result);
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
