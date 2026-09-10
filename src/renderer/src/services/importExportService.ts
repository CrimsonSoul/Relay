import Papa from 'papaparse';
import type { Cell, Row, Sheet } from 'write-excel-file/browser';
import type { ImportProgress } from '@shared/ipc';
import { getPb, escapeFilter, requireOnline } from './pocketbase';
import { parseJsonRecords, parseCsvRecords, parseExcelRecords } from './importFileParser';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const ALL_COLLECTIONS = [
  'contacts',
  'servers',
  'oncall',
  'bridge_groups',
  'bridge_history',
  'alert_history',
  'notes',
] as const;

export type CollectionName = (typeof ALL_COLLECTIONS)[number];

export interface ImportResult {
  imported: number;
  updated: number;
  errors: string[];
}

export type ImportProgressCallback = (progress: ImportProgress) => void;

export interface ExportOptions {
  includeMetadata?: boolean;
}

// Metadata fields stripped before create/update and from exports when requested.
// Includes both PocketBase format (created, updated) and legacy Relay format (createdAt, updatedAt).
const METADATA_FIELDS = new Set([
  'id',
  'created',
  'updated',
  'createdAt',
  'updatedAt',
  'collectionId',
  'collectionName',
  'expand',
]);

// Single-field identities; notes and on-call rows use compound identities below.
const UNIQUE_KEYS: Partial<Record<CollectionName, string>> = {
  contacts: 'email',
  servers: 'name',
  bridge_groups: 'name',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip metadata fields from a record object before writing to PocketBase. */
function stripMetadata(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (!METADATA_FIELDS.has(k)) {
      out[k] = v;
    }
  }
  return out;
}

function isImportRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Protect a CSV field value against formula injection.
 * Fields starting with =, +, -, @, Tab (0x09), or CR (0x0D) are prefixed
 * with a single quote so spreadsheet apps treat them as plain text.
 */
function valueToExportString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }
  return '';
}

function csvSafeValue(value: unknown): string {
  return spreadsheetFormulaSafeValue(valueToExportString(value));
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

function spreadsheetFormulaSafeValue(str: string): string {
  if (FORMULA_PREFIX.test(str)) {
    return `'${str}`;
  }
  return str;
}

/** Fetch all records from a collection as plain objects. */
async function fetchAll(
  collection: CollectionName,
  { includeMetadata = true }: ExportOptions,
): Promise<Record<string, unknown>[]> {
  const records = await getPb()
    .collection(collection)
    .getFullList<Record<string, unknown>>({ batch: 500 });
  return includeMetadata ? records : records.map(stripMetadata);
}

function toSpreadsheetCell(value: unknown): Cell {
  if (value == null) return null;
  if (typeof value === 'string') {
    return spreadsheetFormulaSafeValue(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value instanceof Date) {
    return value;
  }
  return JSON.stringify(value);
}

function getColumnWidths(headers: string[], rows: Record<string, unknown>[]) {
  return headers.map((header) => {
    let maxLen = header.length;
    for (const row of rows) {
      const length = valueToExportString(row[header]).length;
      maxLen = Math.max(maxLen, length);
    }
    return { width: Math.min(maxLen + 2, 50) };
  });
}

function buildSpreadsheetSheet(
  sheet: CollectionName,
  records: Record<string, unknown>[],
): Sheet<Blob> {
  if (records.length === 0) {
    return { sheet, data: [] };
  }

  const firstRecord = records[0];
  if (!firstRecord) {
    return { sheet, data: [] };
  }

  const headers = Object.keys(firstRecord);
  const headerRow: Row = headers.map((header) => ({
    value: header,
    fontWeight: 'bold',
    backgroundColor: '#D9D9D9',
  }));
  const dataRows: Row[] = records.map((record) => headers.map((h) => toSpreadsheetCell(record[h])));

  return {
    sheet,
    data: [headerRow, ...dataRows],
    columns: getColumnWidths(headers, records),
    stickyRowsCount: 1,
  };
}

async function writeWorkbook(sheets: Sheet<Blob>[]): Promise<ArrayBuffer> {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const blob = await writeExcelFile(sheets).toBlob();
  return blob.arrayBuffer();
}

// ---------------------------------------------------------------------------
// Shared upsert
// ---------------------------------------------------------------------------

function getImportIdentityFilter(
  collection: CollectionName,
  data: Record<string, unknown>,
): string | null {
  if (collection === 'notes') {
    if (
      (data.entityType !== 'contact' && data.entityType !== 'server') ||
      typeof data.entityKey !== 'string' ||
      !data.entityKey.trim()
    ) {
      throw new Error('Notes require a contact or server entityType and a non-empty entityKey.');
    }
    return `entityType="${escapeFilter(data.entityType)}" && entityKey="${escapeFilter(data.entityKey)}"`;
  }

  if (collection === 'oncall') {
    if (typeof data.team !== 'string' || !data.team.trim()) {
      throw new Error('On-call rows require a non-empty team.');
    }
    const role = data.role ?? '';
    const name = data.name ?? '';
    if (typeof role !== 'string' || typeof name !== 'string') {
      throw new Error('On-call role and name must be text when provided.');
    }
    return `team="${escapeFilter(data.team)}" && role="${escapeFilter(role)}" && name="${escapeFilter(name)}"`;
  }

  const uniqueKey = UNIQUE_KEYS[collection];
  if (!uniqueKey || data[uniqueKey] === undefined || data[uniqueKey] === '') return null;
  return `${uniqueKey}="${escapeFilter(valueToExportString(data[uniqueKey]))}"`;
}

/**
 * Upsert a single record into a collection.
 * Returns 'created' | 'updated' or throws.
 */
async function upsertOne(
  collection: CollectionName,
  record: Record<string, unknown>,
): Promise<'created' | 'updated'> {
  const data = stripMetadata(record);
  const filter = getImportIdentityFilter(collection, data);
  let existing: { id: string } | null = null;

  if (filter && collection === 'oncall') {
    // Historical imports may already contain duplicates. Never choose one arbitrarily.
    const matches = await getPb().collection(collection).getList(1, 2, { filter });
    if (matches.items.length > 1) {
      throw new Error(
        'Multiple on-call rows match team, role, and name. Resolve duplicates before importing.',
      );
    }
    existing = matches.items[0] ?? null;
  } else if (filter) {
    try {
      existing = await getPb().collection(collection).getFirstListItem(filter);
    } catch (err: unknown) {
      const e = err as { status?: number };
      if (e?.status !== 404) throw err;
    }
  }

  if (existing) {
    await getPb().collection(collection).update(existing.id, data);
    return 'updated';
  }

  await getPb().collection(collection).create(data);
  return 'created';
}

/**
 * Bulk upsert an array of records into a collection.
 * Collects errors per-row rather than aborting on first failure.
 */
async function bulkUpsert(
  collection: CollectionName,
  records: Record<string, unknown>[],
  onProgress?: ImportProgressCallback,
  initialErrorCount = 0,
): Promise<ImportResult> {
  let imported = 0;
  let updated = 0;
  let processed = 0;
  const errors: string[] = [];
  const emitProgress = (): void => {
    onProgress?.({
      processed,
      total: records.length,
      imported,
      updated,
      errors: initialErrorCount + errors.length,
    });
  };

  emitProgress();

  for (let i = 0; i < records.length; i++) {
    try {
      const record = records[i];
      if (!isImportRecord(record)) {
        errors.push(`Row ${i + 1}: expected an object record`);
        continue;
      }
      const result = await upsertOne(collection, record);
      if (result === 'updated') {
        updated++;
      } else {
        imported++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Row ${i + 1}: ${msg}`);
    } finally {
      processed++;
      emitProgress();
    }
  }

  return { imported, updated, errors };
}

// ---------------------------------------------------------------------------
// Export — JSON
// ---------------------------------------------------------------------------

/** Export a single collection or all collections to a JSON string. */
export async function exportToJson(
  collection: CollectionName | 'all',
  options: ExportOptions = {},
): Promise<string> {
  requireOnline();
  if (collection === 'all') {
    const result: Record<string, unknown[]> = {};
    for (const col of ALL_COLLECTIONS) {
      result[col] = await fetchAll(col, options);
    }
    return JSON.stringify(result, null, 2);
  }

  const records = await fetchAll(collection, options);
  return JSON.stringify(records, null, 2);
}

// ---------------------------------------------------------------------------
// Export — CSV
// ---------------------------------------------------------------------------

/** Export a single collection to a CSV string with formula-injection protection. */
export async function exportToCsv(
  collection: CollectionName,
  options: ExportOptions = {},
): Promise<string> {
  requireOnline();
  const records = await fetchAll(collection, options);

  if (records.length === 0) {
    return '';
  }

  // Collect all field names from the first record (preserves insertion order)
  const firstRecord = records[0];
  if (!firstRecord) return '';
  const headers = Object.keys(firstRecord);

  const rows = records.map((record) => headers.map((h) => csvSafeValue(record[h])));

  return Papa.unparse({
    fields: headers,
    data: rows,
  });
}

// ---------------------------------------------------------------------------
// Export — Excel
// ---------------------------------------------------------------------------

/** Export a single collection or all collections to an Excel ArrayBuffer. */
export async function exportToExcel(
  collection: CollectionName | 'all',
  options: ExportOptions = {},
): Promise<ArrayBuffer> {
  requireOnline();
  const collections: CollectionName[] = collection === 'all' ? [...ALL_COLLECTIONS] : [collection];
  const sheets: Sheet<Blob>[] = [];

  for (const col of collections) {
    const records = await fetchAll(col, options);
    sheets.push(buildSpreadsheetSheet(col, records));
  }

  return writeWorkbook(sheets);
}

// ---------------------------------------------------------------------------
// Import — JSON
// ---------------------------------------------------------------------------

/** Import records from a JSON string into a collection. */
export async function importFromJson(
  collection: CollectionName,
  jsonString: string,
  onProgress?: ImportProgressCallback,
): Promise<ImportResult> {
  requireOnline();
  const parsed = parseJsonRecords(collection, jsonString);
  if (parsed.errors.length > 0) {
    return { imported: 0, updated: 0, errors: parsed.errors };
  }
  return bulkUpsert(collection, parsed.records, onProgress);
}

// ---------------------------------------------------------------------------
// Import — CSV
// ---------------------------------------------------------------------------

/** Import records from a CSV string into a collection. */
export async function importFromCsv(
  collection: CollectionName,
  csvString: string,
  onProgress?: ImportProgressCallback,
): Promise<ImportResult> {
  requireOnline();
  const parsed = parseCsvRecords(csvString);
  if (parsed.errors.length > 0 && parsed.records.length === 0) {
    return { imported: 0, updated: 0, errors: parsed.errors };
  }

  const result = await bulkUpsert(collection, parsed.records, onProgress, parsed.errors.length);
  return { ...result, errors: [...parsed.errors, ...result.errors] };
}

// ---------------------------------------------------------------------------
// Import — Excel
// ---------------------------------------------------------------------------

/** Import records from an Excel ArrayBuffer into a collection. */
export async function importFromExcel(
  collection: CollectionName,
  buffer: ArrayBuffer,
  onProgress?: ImportProgressCallback,
): Promise<ImportResult> {
  requireOnline();
  const parsed = await parseExcelRecords(collection, buffer);
  if (parsed.errors.length > 0) {
    return { imported: 0, updated: 0, errors: parsed.errors };
  }
  return bulkUpsert(collection, parsed.records, onProgress);
}
