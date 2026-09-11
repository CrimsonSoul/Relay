import Papa from 'papaparse';

export const MAX_IMPORT_RECORDS = 10000;

export interface ParsedImportRecords {
  records: Record<string, unknown>[];
  errors: string[];
  headers?: string[];
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Inverse of spreadsheetFormulaSafeValue. Without it an export → import round
 * trip permanently prefixes every value the export guarded — a phone number
 * saved as `+15555551234` comes back as `'+15555551234` and is stored that way.
 */
function stripFormulaGuard(value: string): string {
  if (value.startsWith("'") && value.length > 1) {
    const rest = value.slice(1);
    if (FORMULA_PREFIX.test(rest)) {
      return rest;
    }
  }
  return value;
}

function limitRecords(parsed: ParsedImportRecords): ParsedImportRecords {
  if (parsed.records.length <= MAX_IMPORT_RECORDS) return parsed;
  return {
    ...parsed,
    records: [],
    errors: [
      ...parsed.errors,
      `Import contains ${parsed.records.length} records. The maximum is ${MAX_IMPORT_RECORDS} records per import.`,
    ],
  };
}

/** Parse a JSON export without accessing or modifying application data. */
export function parseJsonRecords(collection: string, text: string): ParsedImportRecords {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { records: [], errors: [`Invalid JSON: ${(err as Error).message}`] };
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
        records: [],
        errors: [`Expected an array under key "${collection}"`],
      };
    }
    records = nested as Record<string, unknown>[];
  } else {
    return {
      records: [],
      errors: ['JSON must be an array of records or a multi-collection export object'],
    };
  }

  return limitRecords({ records, errors: [] });
}

/** Parse CSV while retaining nonfatal warnings and the parsed header fields. */
export function parseCsvRecords(text: string): ParsedImportRecords {
  const parseResult = Papa.parse<Record<string, string>>(text, {
    header: true,
    preview: MAX_IMPORT_RECORDS + 1,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    // Strip the formula-injection prefix we add on export
    transform: stripFormulaGuard,
  });

  const parseErrors = parseResult.errors.map((e) => `CSV parse error (row ${e.row}): ${e.message}`);
  return limitRecords({
    records: parseResult.data,
    errors: parseErrors,
    headers: parseResult.meta?.fields,
  });
}

/** Parse the requested worksheet, exposing raw trimmed headers for preview validation. */
export async function parseExcelRecords(
  collection: string,
  buffer: ArrayBuffer,
): Promise<ParsedImportRecords> {
  const { default: readExcelFile } = await import('read-excel-file/browser');
  const sheets = await readExcelFile(buffer);
  const matchingWorksheet = sheets.find((sheet) => sheet.sheet === collection);
  const worksheet = matchingWorksheet ?? (sheets.length === 1 ? sheets[0] : undefined);

  if (!worksheet) {
    if (sheets.length > 1) {
      return {
        records: [],
        errors: [`Excel workbook does not contain a "${collection}" worksheet`],
      };
    }
    return { records: [], errors: ['No worksheets found in the Excel file'] };
  }

  const records: Record<string, unknown>[] = [];
  let headers: string[] = [];

  worksheet.data.forEach((values, index) => {
    if (index === 0) {
      headers = values.map((v) => {
        if (v == null) return '';
        if (typeof v === 'object') return JSON.stringify(v).trim();
        return String(v).trim();
      });
    } else {
      const record: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        if (h) {
          const cell = values[i] ?? '';
          record[h] = typeof cell === 'string' ? stripFormulaGuard(cell) : cell;
        }
      });
      records.push(record);
    }
  });

  if (headers.length === 0) {
    return { records: [], errors: ['Excel sheet has no header row'] };
  }

  return limitRecords({ records, errors: [], headers });
}
