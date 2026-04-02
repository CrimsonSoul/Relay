import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { getPb, escapeFilter, requireOnline } from './pocketbase';

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
  'saved_locations',
  'standalone_notes',
] as const;

export type CollectionName = (typeof ALL_COLLECTIONS)[number];

export interface ImportResult {
  imported: number;
  updated: number;
  errors: string[];
}

// Metadata fields stripped before create/update.
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

// Unique-key field per collection (undefined = always create new)
const UNIQUE_KEYS: Partial<Record<CollectionName, string>> = {
  contacts: 'email',
  servers: 'name',
  bridge_groups: 'name',
  notes: 'entityKey',
  saved_locations: 'name',
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

/**
 * Protect a CSV field value against formula injection.
 * Fields starting with =, +, -, @, Tab (0x09), or CR (0x0D) are prefixed
 * with a single quote so spreadsheet apps treat them as plain text.
 */
function csvSafeValue(value: unknown): string {
  let str: string;
  if (value == null) str = '';
  else if (typeof value === 'object') str = JSON.stringify(value);
  else str = String(value as string | number | boolean);
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

/** Fetch all records from a collection as plain objects. */
async function fetchAll(collection: CollectionName): Promise<Record<string, unknown>[]> {
  const records = await getPb().collection(collection).getFullList({ batch: 500 });
  return records as unknown as Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Shared upsert
// ---------------------------------------------------------------------------

/**
 * Upsert a single record into a collection.
 * Returns 'created' | 'updated' or throws.
 */
async function upsertOne(
  collection: CollectionName,
  record: Record<string, unknown>,
): Promise<'created' | 'updated'> {
  const data = stripMetadata(record);
  const uniqueKey = UNIQUE_KEYS[collection];

  if (uniqueKey && data[uniqueKey] !== undefined && data[uniqueKey] !== '') {
    const rawValue = data[uniqueKey];
    const rawStr =
      typeof rawValue === 'object' && rawValue !== null
        ? JSON.stringify(rawValue)
        : String(rawValue as string | number | boolean);
    const filterValue = escapeFilter(rawStr);
    let existing: { id: string } | null = null;
    try {
      existing = await getPb()
        .collection(collection)
        .getFirstListItem(`${uniqueKey}="${filterValue}"`);
    } catch (err: unknown) {
      const e = err as { status?: number };
      if (e?.status !== 404) throw err;
    }

    if (existing) {
      await getPb().collection(collection).update(existing.id, data);
      return 'updated';
    }
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
): Promise<ImportResult> {
  let imported = 0;
  let updated = 0;
  const errors: string[] = [];

  for (let i = 0; i < records.length; i++) {
    try {
      const record = records[i];
      if (!record) continue;
      const result = await upsertOne(collection, record);
      if (result === 'updated') {
        updated++;
      } else {
        imported++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Row ${i + 1}: ${msg}`);
    }
  }

  return { imported, updated, errors };
}

// ---------------------------------------------------------------------------
// Export — JSON
// ---------------------------------------------------------------------------

/** Export a single collection or all collections to a JSON string. */
export async function exportToJson(collection: CollectionName | 'all'): Promise<string> {
  requireOnline();
  if (collection === 'all') {
    const result: Record<string, unknown[]> = {};
    for (const col of ALL_COLLECTIONS) {
      result[col] = await fetchAll(col);
    }
    return JSON.stringify(result, null, 2);
  }

  const records = await fetchAll(collection);
  return JSON.stringify(records, null, 2);
}

// ---------------------------------------------------------------------------
// Export — CSV
// ---------------------------------------------------------------------------

/** Export a single collection to a CSV string with formula-injection protection. */
export async function exportToCsv(collection: CollectionName): Promise<string> {
  requireOnline();
  const records = await fetchAll(collection);

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
export async function exportToExcel(collection: CollectionName | 'all'): Promise<ArrayBuffer> {
  requireOnline();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Relay';
  workbook.created = new Date();

  const collections: CollectionName[] = collection === 'all' ? [...ALL_COLLECTIONS] : [collection];

  for (const col of collections) {
    const records = await fetchAll(col);
    const worksheet = workbook.addWorksheet(col);

    if (records.length === 0) {
      continue;
    }

    const firstRecord = records[0];
    if (!firstRecord) continue;
    const headers = Object.keys(firstRecord);

    // Header row — bold + gray background
    worksheet.columns = headers.map((h) => ({
      header: h,
      key: h,
      width: 15, // initial; auto-sized below
    }));

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD9D9D9' },
    };
    headerRow.commit();

    // Data rows
    for (const record of records) {
      worksheet.addRow(headers.map((h) => record[h]));
    }

    // Auto-width columns (max 50 chars)
    worksheet.columns.forEach((col) => {
      let maxLen = col.header ? String(col.header).length : 10;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        let cellLen = 0;
        if (cell.value) {
          cellLen =
            typeof cell.value === 'object'
              ? JSON.stringify(cell.value).length
              : String(cell.value).length;
        }
        if (cellLen > maxLen) maxLen = cellLen;
      });
      col.width = Math.min(maxLen + 2, 50);
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  // ExcelJS returns a Buffer (Node-style) or ArrayBuffer depending on env;
  // ensure we always hand back an ArrayBuffer.
  if (buffer instanceof ArrayBuffer) {
    return buffer;
  }
  // Buffer is a Uint8Array subclass — copy into a plain ArrayBuffer
  const uint8 = new Uint8Array(buffer as unknown as ArrayBufferLike);
  const out = new ArrayBuffer(uint8.byteLength);
  new Uint8Array(out).set(uint8);
  return out;
}

// ---------------------------------------------------------------------------
// Import — JSON
// ---------------------------------------------------------------------------

/** Import records from a JSON string into a collection. */
export async function importFromJson(
  collection: CollectionName,
  jsonString: string,
): Promise<ImportResult> {
  requireOnline();
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    return { imported: 0, updated: 0, errors: [`Invalid JSON: ${(err as Error).message}`] };
  }

  let records: Record<string, unknown>[];

  if (Array.isArray(parsed)) {
    records = parsed as Record<string, unknown>[];
  } else if (
    typeof parsed === 'object' &&
    parsed !== null &&
    collection in (parsed as Record<string, unknown>)
  ) {
    // Support the multi-collection export format: { contacts: [...], ... }
    const nested = (parsed as Record<string, unknown>)[collection];
    if (!Array.isArray(nested)) {
      return {
        imported: 0,
        updated: 0,
        errors: [`Expected an array under key "${collection}"`],
      };
    }
    records = nested as Record<string, unknown>[];
  } else {
    return {
      imported: 0,
      updated: 0,
      errors: ['JSON must be an array of records or a multi-collection export object'],
    };
  }

  return bulkUpsert(collection, records);
}

// ---------------------------------------------------------------------------
// Import — CSV
// ---------------------------------------------------------------------------

/** Import records from a CSV string into a collection. */
export async function importFromCsv(
  collection: CollectionName,
  csvString: string,
): Promise<ImportResult> {
  requireOnline();
  const parseResult = Papa.parse<Record<string, string>>(csvString, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (value) => {
      // Strip the formula-injection prefix we add on export
      if (value.startsWith("'") && value.length > 1) {
        const rest = value.slice(1);
        if (/^[=+\-@\t\r]/.test(rest)) {
          return rest;
        }
      }
      return value;
    },
  });

  if (parseResult.errors.length > 0) {
    const errMsgs = parseResult.errors.map((e) => `CSV parse error (row ${e.row}): ${e.message}`);
    // Non-fatal parse errors: proceed with what we got, but surface warnings
    if (parseResult.data.length === 0) {
      return { imported: 0, updated: 0, errors: errMsgs };
    }
  }

  return bulkUpsert(collection, parseResult.data as unknown as Record<string, unknown>[]);
}

// ---------------------------------------------------------------------------
// Import — Excel
// ---------------------------------------------------------------------------

/** Import records from an Excel ArrayBuffer into a collection. */
export async function importFromExcel(
  collection: CollectionName,
  buffer: ArrayBuffer,
): Promise<ImportResult> {
  requireOnline();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  // Try to find a worksheet matching the collection name, fall back to first sheet
  let worksheet = workbook.getWorksheet(collection) ?? workbook.worksheets[0];

  if (!worksheet) {
    return { imported: 0, updated: 0, errors: ['No worksheets found in the Excel file'] };
  }

  const records: Record<string, unknown>[] = [];
  let headers: string[] = [];

  worksheet.eachRow((row, rowNumber) => {
    const values = (row.values as (ExcelJS.CellValue | undefined)[]).slice(1); // col index starts at 1
    if (rowNumber === 1) {
      headers = values.map((v) => {
        if (v == null) return '';
        if (typeof v === 'object') return JSON.stringify(v).trim();
        return String(v).trim();
      });
    } else {
      const record: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        if (h) {
          const cell = values[i];
          record[h] = cell ?? '';
        }
      });
      records.push(record);
    }
  });

  if (headers.length === 0) {
    return { imported: 0, updated: 0, errors: ['Excel sheet has no header row'] };
  }

  return bulkUpsert(collection, records);
}
