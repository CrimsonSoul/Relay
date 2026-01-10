
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify/sync';
import type { CsvRow, CsvData } from '@shared/csvTypes';
import { loggers } from './logger';

/**
 * Control characters that could be used for CSV injection or data corruption
 */
const CONTROL_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Characters that trigger formula injection in spreadsheet applications
 */
const FORMULA_CHARS = ['=', '+', '-', '@', '\t', '\r', '|', '\\'];

/**
 * Characters that could be used for command injection via DDE
 */
const DDE_PATTERNS = [
  /^DDE\s*\(/i,
  /^@SUM\s*\(/i,
  /^cmd\s*\|/i
];

/**
 * Sanitizes a field for CSV export to prevent Formula Injection (CSV Injection).
 * Comprehensive protection against:
 * - Formula injection (=, +, -, @)
 * - DDE attacks
 * - Control character injection
 * - Newline injection
 */
export function sanitizeField(value: string | null | undefined): string {
    if (!value) return '';
    let str = String(value);

    // Remove null bytes and other dangerous control characters
    str = str.replace(CONTROL_CHARS_REGEX, '');

    // Normalize line endings to prevent newline injection
    str = str.replace(/\r\n/g, ' ').replace(/[\r\n]/g, ' ');

    // Check for formula injection characters at the start
    const firstChar = str.charAt(0);
    if (FORMULA_CHARS.includes(firstChar)) {
        return "'" + str;
    }

    // Check for DDE patterns
    for (const pattern of DDE_PATTERNS) {
        if (pattern.test(str)) {
            return "'" + str;
        }
    }

    return str;
}

/**
 * Desanitizes a field read from CSV.
 * If the field starts with a single quote followed by a hazardous character, remove the quote.
 */
export function desanitizeField(value: string | null | undefined): string {
    if (!value) return '';
    const str = String(value);
    if (str.startsWith("'") && FORMULA_CHARS.includes(str.charAt(1))) {
        return str.slice(1);
    }
    return str;
}

/**
 * Validates that content appears to be valid UTF-8 encoded CSV
 * Returns true if valid, false if suspicious encoding detected
 */
export function validateEncoding(content: string): boolean {
    // Check for null bytes (indicates binary or corrupted file)
    if (content.includes('\x00')) {
        loggers.fileManager.warn('[CSV] Null bytes detected - possible binary or corrupted file');
        return false;
    }

    // Check for replacement character (indicates encoding issues)
    if (content.includes('\uFFFD')) {
        loggers.fileManager.warn('[CSV] Replacement character detected - possible encoding issue');
        return false;
    }

    // Check for private use area characters (suspicious)
    if (/[\uE000-\uF8FF]/.test(content)) {
        loggers.fileManager.warn('[CSV] Private use area characters detected');
        return false;
    }

    return true;
}

/**
 * Sanitize entire CSV content before parsing
 */
export function sanitizeCsvContent(content: string): string {
    // Strip BOM if present
    let cleaned = content.replace(/^\uFEFF/, '');

    // Normalize line endings
    cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Remove null bytes
    cleaned = cleaned.replace(/\x00/g, '');

    return cleaned;
}

/**
 * Parse CSV with enhanced options for better compatibility
 * Includes encoding validation and content sanitization
 */
export function parseCsvAsync(contents: string): Promise<CsvRow[]> {
    // Validate encoding first
    if (!validateEncoding(contents)) {
        loggers.fileManager.warn('[CSV] Encoding validation failed, proceeding with sanitization');
    }

    // Sanitize content before parsing
    const cleanContents = sanitizeCsvContent(contents);

    return new Promise((resolve, reject) => {
      parse(cleanContents, {
        trim: true,
        skip_empty_lines: true,
        relax_quotes: true,        // More tolerant of malformed quotes
        relax_column_count: true,  // Allow variable column counts
        quote: '"',
        escape: '"'
      }, (err, records) => {
          if (err) reject(err);
          else resolve(records as CsvRow[]);
      });
    });
}

/**
 * Parse CSV and separate headers from rows
 */
export async function parseCsvWithHeaders(contents: string): Promise<CsvData> {
    const allRows = await parseCsvAsync(contents);

    if (allRows.length === 0) {
        return { headers: [], rows: [] };
    }

    return {
        headers: allRows[0],
        rows: allRows.slice(1)
    };
}

/**
 * Stringify CSV data with proper sanitization
 */
export function stringifyCsv(data: CsvRow[]): string {
    const sanitizedData = data.map(row => row.map(cell => sanitizeField(cell)));
    return stringify(sanitizedData);
}
