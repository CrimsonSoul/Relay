import { afterEach, describe, expect, it, vi } from 'vitest';
import writeExcelFile, { type Sheet } from 'write-excel-file/browser';
import {
  MAX_IMPORT_RECORDS,
  parseCsvRecords,
  parseExcelRecords,
  parseJsonRecords,
} from './importFileParser';

const { getPb, requireOnline } = vi.hoisted(() => ({
  getPb: vi.fn(() => {
    throw new Error('Parsing must not access PocketBase');
  }),
  requireOnline: vi.fn(() => {
    throw new Error('Parsing must work offline');
  }),
}));

vi.mock('./pocketbase', () => ({ getPb, requireOnline }));

afterEach(() => {
  expect(getPb).not.toHaveBeenCalled();
  expect(requireOnline).not.toHaveBeenCalled();
});

async function workbook(sheets: Sheet<Blob>[]): Promise<ArrayBuffer> {
  return (await writeExcelFile(sheets).toBlob()).arrayBuffer();
}

describe('read-only JSON import parsing', () => {
  it.each(['[{"name":"srv-a"}]', '{"contacts":[{"name":"ignore"}],"servers":[{"name":"srv-a"}]}'])(
    'selects the requested records without a database connection: %s',
    (text) => {
      expect(parseJsonRecords('servers', text)).toEqual({
        records: [{ name: 'srv-a' }],
        errors: [],
      });
    },
  );

  it('leaves malformed record shapes for the ordinary per-row validation', () => {
    expect(parseJsonRecords('servers', '[null,42,[],{"name":"srv-a"}]')).toEqual({
      records: [null, 42, [], { name: 'srv-a' }],
      errors: [],
    });
  });

  it.each(['null', '42', '"servers"', '{"contacts":[]}'])(
    'rejects missing record arrays: %s',
    (text) => {
      expect(parseJsonRecords('servers', text)).toEqual({
        records: [],
        errors: ['JSON must be an array of records or a multi-collection export object'],
      });
    },
  );

  it('reports invalid JSON separately from an invalid collection value', () => {
    expect(parseJsonRecords('servers', '{').errors[0]).toMatch(/^Invalid JSON:/);
    expect(parseJsonRecords('servers', '{"servers":{}}')).toEqual({
      records: [],
      errors: ['Expected an array under key "servers"'],
    });
  });

  it('accepts the record limit and rejects one additional record', () => {
    const rows = Array.from({ length: MAX_IMPORT_RECORDS }, () => ({ name: 'srv-a' }));
    expect(parseJsonRecords('servers', JSON.stringify(rows)).records).toHaveLength(10000);
    expect(parseJsonRecords('servers', JSON.stringify([...rows, { name: 'srv-b' }]))).toEqual({
      records: [],
      errors: ['Import contains 10001 records. The maximum is 10000 records per import.'],
    });
  });
});

describe('read-only CSV import parsing', () => {
  it('trims headers and reverses only the exported formula guard', () => {
    expect(parseCsvRecords(" name ,phone,note\nsrv-a,'+15555551234,'hello\n")).toEqual({
      headers: ['name', 'phone', 'note'],
      records: [{ name: 'srv-a', phone: '+15555551234', note: "'hello" }],
      errors: [],
    });
  });

  it('keeps parsed rows alongside nonfatal field-count errors', () => {
    const result = parseCsvRecords('name,owner\nsrv-a,Ops\nsrv-b');
    expect(result.records).toEqual([{ name: 'srv-a', owner: 'Ops' }, { name: 'srv-b' }]);
    expect(result.headers).toEqual(['name', 'owner']);
    expect(result.errors).toEqual([
      "CSV parse error (row undefined): Unable to auto-detect delimiting character; defaulted to ','",
      'CSV parse error (row 1): Too few fields: expected 2 fields but parsed 1',
    ]);
  });

  it('keeps the existing duplicate-header renaming behavior', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(parseCsvRecords('name,name\nfirst,last')).toMatchObject({
        headers: ['name', 'name_1'],
        records: [{ name: 'first', name_1: 'last' }],
      });
    } finally {
      warning.mockRestore();
    }
  });

  it('stops oversized parsing at the first row beyond the limit and preserves warnings', () => {
    const result = parseCsvRecords(`name,owner\nbroken\n${'srv-a,Ops\n'.repeat(10002)}`);
    expect(result.records).toEqual([]);
    expect(result.errors).toEqual([
      "CSV parse error (row undefined): Unable to auto-detect delimiting character; defaulted to ','",
      'CSV parse error (row 0): Too few fields: expected 2 fields but parsed 1',
      'Import contains 10001 records. The maximum is 10000 records per import.',
    ]);
  });
});

describe('read-only Excel import parsing', () => {
  it('chooses the matching sheet and exposes trimmed duplicate headers without rejecting them', async () => {
    const buffer = await workbook([
      { sheet: 'contacts', data: [['name'], ['wrong']] },
      {
        sheet: 'servers',
        data: [
          [' name ', 'name', 'phone', 'note'],
          ['first', 'last', "'+15555551234", "'hello"],
        ],
      },
    ]);
    expect(await parseExcelRecords('servers', buffer)).toEqual({
      headers: ['name', 'name', 'phone', 'note'],
      records: [{ name: 'last', phone: '+15555551234', note: "'hello" }],
      errors: [],
    });
  });

  it('uses an arbitrarily named single sheet and preserves typed cells and missing values', async () => {
    const buffer = await workbook([
      {
        sheet: 'Sheet 1',
        data: [
          ['name', 'count', 'active', 'owner'],
          ['srv-a', 2, true],
        ],
      },
    ]);
    expect(await parseExcelRecords('servers', buffer)).toEqual({
      headers: ['name', 'count', 'active', 'owner'],
      records: [{ name: 'srv-a', count: 2, active: true, owner: '' }],
      errors: [],
    });
  });

  it('rejects a missing collection in a multi-sheet workbook', async () => {
    const buffer = await workbook([
      { sheet: 'contacts', data: [['name'], ['Alice']] },
      { sheet: 'notes', data: [['note'], ['Keep']] },
    ]);
    expect(await parseExcelRecords('servers', buffer)).toEqual({
      records: [],
      errors: ['Excel workbook does not contain a "servers" worksheet'],
    });
  });

  it('rejects a sheet without headers', async () => {
    const buffer = await workbook([{ sheet: 'servers', data: [] }]);
    expect(await parseExcelRecords('servers', buffer)).toMatchObject({
      records: [],
      errors: ['Excel sheet has no header row'],
    });
  });

  it('rejects oversized worksheets before making their rows available for import', async () => {
    const buffer = await workbook([
      { sheet: 'servers', data: [['name'], ...Array.from({ length: 10001 }, () => ['srv-a'])] },
    ]);
    expect(await parseExcelRecords('servers', buffer)).toEqual({
      headers: ['name'],
      records: [],
      errors: ['Import contains 10001 records. The maximum is 10000 records per import.'],
    });
  });
});
