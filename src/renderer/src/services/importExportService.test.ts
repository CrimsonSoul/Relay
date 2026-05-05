import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks (vi.mock factories are hoisted to top-level, so all
// referenced variables must also be hoisted with vi.hoisted)
// ---------------------------------------------------------------------------

const {
  mockCreate,
  mockUpdate,
  mockGetFullList,
  mockGetFirstListItem,
  mockPapaUnparse,
  mockPapaParse,
  mockWriteExcelFile,
  mockToBlob,
  mockReadExcelFile,
} = vi.hoisted(() => {
  const mockCreate = vi.fn();
  const mockUpdate = vi.fn();
  const mockGetFullList = vi.fn();
  const mockGetFirstListItem = vi.fn();
  const mockPapaUnparse = vi.fn();
  const mockPapaParse = vi.fn();
  const mockWriteExcelFile = vi.fn();
  const mockToBlob = vi.fn();
  const mockReadExcelFile = vi.fn();

  return {
    mockCreate,
    mockUpdate,
    mockGetFullList,
    mockGetFirstListItem,
    mockPapaUnparse,
    mockPapaParse,
    mockWriteExcelFile,
    mockToBlob,
    mockReadExcelFile,
  };
});

vi.mock('./pocketbase', () => ({
  getPb: () => ({
    collection: () => ({
      create: mockCreate,
      update: mockUpdate,
      getFullList: mockGetFullList,
      getFirstListItem: mockGetFirstListItem,
    }),
  }),
  handleApiError: vi.fn(),
  escapeFilter: (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"'),
  requireOnline: vi.fn(),
}));

vi.mock('papaparse', () => ({
  default: {
    unparse: mockPapaUnparse,
    parse: mockPapaParse,
  },
}));

vi.mock('write-excel-file/browser', () => ({
  default: mockWriteExcelFile,
}));

vi.mock('read-excel-file/browser', () => ({
  default: mockReadExcelFile,
}));

import {
  exportToJson,
  exportToCsv,
  exportToExcel,
  importFromJson,
  importFromCsv,
  importFromExcel,
  ALL_COLLECTIONS,
} from './importExportService';
import { requireOnline } from './pocketbase';

const mockRequireOnline = vi.mocked(requireOnline);

const sampleRecord = { id: 'r1', email: 'alice@example.com', name: 'Alice' };

beforeEach(() => {
  vi.clearAllMocks();
  mockWriteExcelFile.mockReturnValue({ toBlob: mockToBlob });
  mockToBlob.mockResolvedValue(new Blob([new Uint8Array([1, 2, 3, 4])]));
});

// ---------------------------------------------------------------------------
// exportToJson
// ---------------------------------------------------------------------------
describe('exportToJson', () => {
  it('exports a single collection as a JSON array string', async () => {
    mockGetFullList.mockResolvedValueOnce([sampleRecord]);
    const result = await exportToJson('contacts');
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toMatchObject(sampleRecord);
  });

  it('exports all collections under their keys when "all" is passed', async () => {
    for (let i = 0; i < ALL_COLLECTIONS.length; i++) {
      mockGetFullList.mockResolvedValueOnce([]);
    }
    const result = await exportToJson('all');
    const parsed = JSON.parse(result);
    for (const col of ALL_COLLECTIONS) {
      expect(parsed).toHaveProperty(col);
    }
  });
});

// ---------------------------------------------------------------------------
// exportToCsv
// ---------------------------------------------------------------------------
describe('exportToCsv', () => {
  it('returns empty string when collection has no records', async () => {
    mockGetFullList.mockResolvedValueOnce([]);
    const result = await exportToCsv('contacts');
    expect(result).toBe('');
    expect(mockPapaUnparse).not.toHaveBeenCalled();
  });

  it('calls Papa.unparse with headers and safe row data', async () => {
    mockGetFullList.mockResolvedValueOnce([sampleRecord]);
    mockPapaUnparse.mockReturnValueOnce('id,email,name\nr1,alice@example.com,Alice');
    const result = await exportToCsv('contacts');
    expect(mockPapaUnparse).toHaveBeenCalledOnce();
    expect(result).toContain('r1');
  });

  it('prefixes formula-injection characters with a single quote', async () => {
    const dangerous = { id: 'r2', email: '=HYPERLINK("evil")', name: 'Bob' };
    mockGetFullList.mockResolvedValueOnce([dangerous]);
    mockPapaUnparse.mockImplementationOnce(({ data }: { data: string[][] }) => data[0]![1]!);
    await exportToCsv('contacts');
    const unparseCall = mockPapaUnparse.mock.calls[0][0] as { data: string[][] };
    expect(unparseCall.data[0]![1]).toBe('\'=HYPERLINK("evil")');
  });
});

// ---------------------------------------------------------------------------
// exportToExcel
// ---------------------------------------------------------------------------
describe('exportToExcel', () => {
  it('writes a spreadsheet and returns an ArrayBuffer', async () => {
    mockGetFullList.mockResolvedValueOnce([sampleRecord]);
    const result = await exportToExcel('contacts');
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(mockWriteExcelFile).toHaveBeenCalledOnce();
    const sheets = mockWriteExcelFile.mock.calls[0][0] as Array<{ data: unknown[][] }>;
    expect(sheets[0]?.data[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'id', fontWeight: 'bold' }),
        expect.objectContaining({ value: 'email', fontWeight: 'bold' }),
      ]),
    );
    expect(result.byteLength).toBe(4);
  });

  it('writes an empty sheet for empty collections', async () => {
    mockGetFullList.mockResolvedValueOnce([]);
    await exportToExcel('contacts');
    const sheets = mockWriteExcelFile.mock.calls[0][0] as Array<{ data: unknown[][] }>;
    expect(sheets[0]).toMatchObject({ sheet: 'contacts', data: [] });
  });
});

// ---------------------------------------------------------------------------
// importFromJson
// ---------------------------------------------------------------------------
describe('importFromJson', () => {
  it('imports records from a JSON array', async () => {
    const notFound = Object.assign(new Error('Not found'), { status: 404 });
    mockGetFirstListItem.mockRejectedValueOnce(notFound);
    mockCreate.mockResolvedValueOnce(sampleRecord);
    const result = await importFromJson('contacts', JSON.stringify([sampleRecord]));
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(result.imported).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('returns an error for invalid JSON', async () => {
    const result = await importFromJson('contacts', 'not-json{');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Invalid JSON/);
  });

  it('supports multi-collection export format', async () => {
    const payload = { contacts: [sampleRecord] };
    const notFound = Object.assign(new Error('Not found'), { status: 404 });
    mockGetFirstListItem.mockRejectedValueOnce(notFound);
    mockCreate.mockResolvedValueOnce(sampleRecord);
    const result = await importFromJson('contacts', JSON.stringify(payload));
    expect(result.imported).toBe(1);
  });

  it('returns an error when the nested array is missing', async () => {
    const payload = { contacts: 'not-an-array' };
    const result = await importFromJson('contacts', JSON.stringify(payload));
    expect(result.errors[0]).toMatch(/Expected an array/);
  });

  it('returns an error for a non-array, non-object JSON value', async () => {
    const result = await importFromJson('contacts', '"just a string"');
    expect(result.errors[0]).toMatch(/array of records/);
  });

  it('collects per-row errors without aborting the whole batch', async () => {
    const err = new Error('row error');
    mockGetFirstListItem.mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }));
    mockCreate.mockRejectedValueOnce(err);
    const record2 = { ...sampleRecord, id: 'r2', email: 'bob@example.com' };
    mockGetFirstListItem.mockRejectedValueOnce(Object.assign(new Error('nf'), { status: 404 }));
    mockCreate.mockResolvedValueOnce(record2);
    const result = await importFromJson('contacts', JSON.stringify([sampleRecord, record2]));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/Row 1/);
    expect(result.imported).toBe(1);
  });

  it('increments "updated" counter when a record is upserted via update', async () => {
    mockGetFirstListItem.mockResolvedValueOnce(sampleRecord);
    mockUpdate.mockResolvedValueOnce(sampleRecord);
    const result = await importFromJson('contacts', JSON.stringify([sampleRecord]));
    expect(result.updated).toBe(1);
    expect(result.imported).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// importFromCsv
// ---------------------------------------------------------------------------
describe('importFromCsv', () => {
  it('parses CSV and imports records', async () => {
    mockPapaParse.mockReturnValueOnce({
      data: [{ email: 'alice@example.com', name: 'Alice' }],
      errors: [],
    });
    const notFound = Object.assign(new Error('Not found'), { status: 404 });
    mockGetFirstListItem.mockRejectedValueOnce(notFound);
    mockCreate.mockResolvedValueOnce(sampleRecord);
    const result = await importFromCsv('contacts', 'email,name\nalice@example.com,Alice');
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(result.imported).toBe(1);
  });

  it('returns errors and empty data when CSV parse fails with no rows', async () => {
    mockPapaParse.mockReturnValueOnce({
      data: [],
      errors: [{ row: 1, message: 'bad csv' }],
    });
    const result = await importFromCsv('contacts', 'bad\x00csv');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/CSV parse error/);
  });

  it('strips formula-injection prefix on import via transform function', async () => {
    mockPapaParse.mockReturnValueOnce({ data: [], errors: [] });
    await importFromCsv('contacts', 'email\n=test');
    const parseOptions = mockPapaParse.mock.calls[0][1] as { transform: (v: string) => string };
    // Strips leading ' before injection characters
    expect(parseOptions.transform('\'=HYPERLINK("evil")')).toBe('=HYPERLINK("evil")');
    // Normal values unchanged
    expect(parseOptions.transform('normal')).toBe('normal');
    // Single quote not followed by injection char unchanged
    expect(parseOptions.transform("'hello")).toBe("'hello");
  });
});

// ---------------------------------------------------------------------------
// importFromExcel
// ---------------------------------------------------------------------------
describe('importFromExcel', () => {
  it('reads rows from the matching worksheet and imports records', async () => {
    mockReadExcelFile.mockResolvedValueOnce([
      {
        sheet: 'contacts',
        data: [
          ['email', 'name'],
          ['alice@example.com', 'Alice'],
        ],
      },
    ]);
    const notFound = Object.assign(new Error('Not found'), { status: 404 });
    mockGetFirstListItem.mockRejectedValueOnce(notFound);
    mockCreate.mockResolvedValueOnce(sampleRecord);
    const result = await importFromExcel('contacts', new ArrayBuffer(8));
    expect(mockRequireOnline).toHaveBeenCalledOnce();
    expect(result.imported).toBe(1);
  });

  it('falls back to the first worksheet when named worksheet is not found', async () => {
    mockReadExcelFile.mockResolvedValueOnce([
      {
        sheet: 'Sheet 1',
        data: [['email'], ['bob@example.com']],
      },
    ]);
    const notFound = Object.assign(new Error('Not found'), { status: 404 });
    mockGetFirstListItem.mockRejectedValueOnce(notFound);
    mockCreate.mockResolvedValueOnce(sampleRecord);
    const result = await importFromExcel('contacts', new ArrayBuffer(8));
    expect(result.imported).toBe(1);
  });

  it('returns an error when no worksheets exist', async () => {
    mockReadExcelFile.mockResolvedValueOnce([]);
    const result = await importFromExcel('contacts', new ArrayBuffer(8));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/No worksheets/);
  });

  it('returns an error when sheet has no header row', async () => {
    mockReadExcelFile.mockResolvedValueOnce([{ sheet: 'contacts', data: [] }]);
    const result = await importFromExcel('contacts', new ArrayBuffer(8));
    expect(result.errors[0]).toMatch(/no header row/);
  });
});
