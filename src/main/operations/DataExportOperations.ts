/**
 * DataExportOperations - Export data to JSON or CSV format
 */

import fs from 'node:fs/promises';
import { dialog } from 'electron';
import type {
  ContactRecord,
  ServerRecord,
  OnCallRecord,
  BridgeGroup,
  ExportOptions,
  DataCategory,
} from '@shared/ipc';
import { getContacts } from './ContactJsonOperations';
import { getServers } from './ServerJsonOperations';
import { getOnCall } from './OnCallJsonOperations';
import { getGroups } from './PresetOperations';
import { loggers } from '../logger';

function removeMetadata<T>(
  record: T & { id?: unknown; createdAt?: unknown; updatedAt?: unknown },
): Omit<T, 'id' | 'createdAt' | 'updatedAt'> {
  const r = { ...record };
  delete r.id;
  delete r.createdAt;
  delete r.updatedAt;
  return r;
}

/**
 * Convert contacts to CSV format
 */
function contactsToCsv(contacts: ContactRecord[], includeMetadata: boolean): string {
  const headers = includeMetadata
    ? ['ID', 'Name', 'Email', 'Phone', 'Title', 'Created At', 'Updated At']
    : ['Name', 'Email', 'Phone', 'Title'];

  const rows = contacts.map((c) =>
    includeMetadata
      ? [
          c.id,
          c.name,
          c.email,
          c.phone,
          c.title,
          new Date(c.createdAt).toISOString(),
          new Date(c.updatedAt).toISOString(),
        ]
      : [c.name, c.email, c.phone, c.title],
  );

  return [headers, ...rows].map((row) => row.map(escapeCSV).join(',')).join('\n');
}

/**
 * Convert servers to CSV format
 */
function serversToCsv(servers: ServerRecord[], includeMetadata: boolean): string {
  const headers = includeMetadata
    ? [
        'ID',
        'Name',
        'Business Area',
        'LOB',
        'Comment',
        'Owner',
        'Contact',
        'OS',
        'Created At',
        'Updated At',
      ]
    : ['Name', 'Business Area', 'LOB', 'Comment', 'Owner', 'Contact', 'OS'];

  const rows = servers.map((s) =>
    includeMetadata
      ? [
          s.id,
          s.name,
          s.businessArea,
          s.lob,
          s.comment,
          s.owner,
          s.contact,
          s.os,
          new Date(s.createdAt).toISOString(),
          new Date(s.updatedAt).toISOString(),
        ]
      : [s.name, s.businessArea, s.lob, s.comment, s.owner, s.contact, s.os],
  );

  return [headers, ...rows].map((row) => row.map(escapeCSV).join(',')).join('\n');
}

/**
 * Convert on-call to CSV format
 */
function onCallToCsv(records: OnCallRecord[], includeMetadata: boolean): string {
  const headers = includeMetadata
    ? ['ID', 'Team', 'Role', 'Name', 'Contact', 'Time Window', 'Created At', 'Updated At']
    : ['Team', 'Role', 'Name', 'Contact', 'Time Window'];

  const rows = records.map((r) =>
    includeMetadata
      ? [
          r.id,
          r.team,
          r.role,
          r.name,
          r.contact,
          r.timeWindow || '',
          new Date(r.createdAt).toISOString(),
          new Date(r.updatedAt).toISOString(),
        ]
      : [r.team, r.role, r.name, r.contact, r.timeWindow || ''],
  );

  return [headers, ...rows].map((row) => row.map(escapeCSV).join(',')).join('\n');
}

/**
 * Convert groups to CSV format
 */
function groupsToCsv(groups: BridgeGroup[], includeMetadata: boolean): string {
  const headers = includeMetadata
    ? ['ID', 'Name', 'Contacts', 'Created At', 'Updated At']
    : ['Name', 'Contacts'];

  const rows = groups.map((g) =>
    includeMetadata
      ? [
          g.id,
          g.name,
          g.contacts.join(';'),
          new Date(g.createdAt).toISOString(),
          new Date(g.updatedAt).toISOString(),
        ]
      : [g.name, g.contacts.join(';')],
  );

  return [headers, ...rows].map((row) => row.map(escapeCSV).join(',')).join('\n');
}

/**
 * Escape a CSV field and prevent formula injection.
 * Spreadsheet applications interpret cells starting with =, +, -, @ as formulas.
 * We prefix such values with a single quote to prevent execution.
 */
function escapeCSV(field: string | number | undefined): string {
  const str = String(field ?? '');
  // Prevent formula injection - prefix with single quote inside quotes
  // Guards against =, +, -, @, Tab (0x09), and Carriage Return (0x0D)
  if (/^[=+\-@\t\r]/.test(str)) {
    return `"'${str.replaceAll('"', '""')}"`;
  }
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

/**
 * Get file filters for save dialog
 */
function getFileFilters(format: 'json' | 'csv') {
  return format === 'json'
    ? [{ name: 'JSON Files', extensions: ['json'] }]
    : [{ name: 'CSV Files', extensions: ['csv'] }];
}

/**
 * Get default filename for export
 */
function getDefaultFilename(category: DataCategory, format: 'json' | 'csv'): string {
  const timestamp = new Date().toISOString().slice(0, 10);
  return `relay-${category}-${timestamp}.${format}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExportHandler<T = any> = {
  get: (rootDir: string) => Promise<T[]>;
  toCsv: (data: T[], includeMeta: boolean) => string;
};

const EXPORT_HANDLERS: Record<string, ExportHandler> = {
  contacts: { get: getContacts, toCsv: contactsToCsv },
  servers: { get: getServers, toCsv: serversToCsv },
  oncall: { get: getOnCall, toCsv: onCallToCsv },
  groups: { get: getGroups, toCsv: groupsToCsv },
};

async function generateAllExportContent(
  rootDir: string,
  format: 'json' | 'csv',
  includeMetadata: boolean,
): Promise<string> {
  const [contacts, servers, onCall, groups] = await Promise.all([
    getContacts(rootDir),
    getServers(rootDir),
    getOnCall(rootDir),
    getGroups(rootDir),
  ]);

  if (format === 'json') {
    const allData = includeMetadata
      ? { contacts, servers, onCall, groups, exportedAt: new Date().toISOString() }
      : {
          contacts: contacts.map(removeMetadata),
          servers: servers.map(removeMetadata),
          onCall: onCall.map(removeMetadata),
          groups: groups.map(removeMetadata),
          exportedAt: new Date().toISOString(),
        };

    return JSON.stringify(allData, null, 2);
  }

  return [
    '# CONTACTS',
    contactsToCsv(contacts, includeMetadata),
    '',
    '# SERVERS',
    serversToCsv(servers, includeMetadata),
    '',
    '# ONCALL',
    onCallToCsv(onCall, includeMetadata),
    '',
    '# GROUPS',
    groupsToCsv(groups, includeMetadata),
  ].join('\n');
}

/**
 * Generate export content for a given category and format.
 * Shared logic used by both exportData and exportToPath.
 */
async function generateExportContent(
  rootDir: string,
  options: ExportOptions,
): Promise<{ content: string; defaultName: string }> {
  const { format, category, includeMetadata = false } = options;

  let content: string;

  if (category === 'all') {
    content = await generateAllExportContent(rootDir, format, includeMetadata);
  } else {
    // Export single category
    const handler = EXPORT_HANDLERS[category as string];
    if (!handler) throw new Error(`Unknown category: ${category}`);

    const records = await handler.get(rootDir);
    if (format === 'json') {
      const processed = includeMetadata ? records : records.map(removeMetadata);
      content = JSON.stringify(processed, null, 2);
    } else {
      content = handler.toCsv(records, includeMetadata);
    }
  }

  // Add BOM for CSV files for Excel compatibility
  if (format === 'csv') {
    content = '\uFEFF' + content;
  }

  return { content, defaultName: getDefaultFilename(category, format) };
}

/**
 * Export data to a file
 */
export async function exportData(rootDir: string, options: ExportOptions): Promise<boolean> {
  try {
    const { content, defaultName } = await generateExportContent(rootDir, options);

    // Show save dialog
    const result = await dialog.showSaveDialog({
      title: `Export ${options.category} as ${options.format.toUpperCase()}`,
      defaultPath: defaultName,
      filters: getFileFilters(options.format),
    });

    if (result.canceled || !result.filePath) {
      return false;
    }

    await fs.writeFile(result.filePath, content, 'utf-8');
    loggers.fileManager.info(
      `[DataExportOperations] Exported ${options.category} to ${result.filePath}`,
    );
    return true;
  } catch (e) {
    loggers.fileManager.error('[DataExportOperations] exportData error:', { error: e });
    return false;
  }
}
