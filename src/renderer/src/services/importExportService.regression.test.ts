import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Papa from 'papaparse';
import readExcelFile from 'read-excel-file/browser';
import writeExcelFile from 'write-excel-file/browser';
import { useDataManager } from '../hooks/useDataManager';
import {
  ALL_COLLECTIONS,
  exportToCsv,
  exportToExcel,
  exportToJson,
  importFromCsv,
  importFromExcel,
  importFromJson,
  type CollectionName,
} from './importExportService';

const { records, getFirstListItem, getList, create, update } = vi.hoisted(() => ({
  records: new Map<string, Record<string, unknown>[]>(),
  getFirstListItem: vi.fn(),
  getList: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock('./pocketbase', () => ({
  requireOnline: vi.fn(),
  escapeFilter: (value: string) => value.replaceAll('\\', '\\\\').replaceAll('"', '\\"'),
  getPb: () => ({
    collection: (collection: string) => ({
      getFullList: async () => records.get(collection) ?? [],
      getFirstListItem,
      getList,
      create,
      update,
    }),
  }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  records.clear();
  getFirstListItem.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));
  getList.mockResolvedValue({ items: [], totalItems: 0 });
});

async function importRows(
  collection: CollectionName,
  format: string,
  rows: Record<string, unknown>[],
) {
  if (format === 'json') return importFromJson(collection, JSON.stringify(rows));
  if (format === 'csv') return importFromCsv(collection, Papa.unparse(rows));
  const headers = Object.keys(rows[0]!);
  const blob = await writeExcelFile([
    {
      sheet: collection,
      data: [headers, ...rows.map((row) => headers.map((key) => String(row[key] ?? '')))],
    },
  ]).toBlob();
  return importFromExcel(collection, await blob.arrayBuffer());
}

describe.each(['json', 'csv', 'excel'])('%s compound import identities', (format) => {
  it('updates only the server note when a contact shares the same key', async () => {
    const contact = {
      id: 'contact-note',
      entityType: 'contact',
      entityKey: 'shared-key',
      note: 'Keep',
    };
    const server = {
      id: 'server-note',
      entityType: 'server',
      entityKey: 'shared-key',
      note: 'Before',
    };
    getFirstListItem.mockImplementation(async (filter: string) =>
      filter === 'entityType="server" && entityKey="shared-key"' ? server : contact,
    );
    update.mockImplementation(async (id: string, data: Record<string, unknown>) => {
      Object.assign(id === server.id ? server : contact, data);
    });

    const result = await importRows('notes', format, [
      { entityType: 'server', entityKey: 'shared-key', note: 'After' },
    ]);

    expect(result).toEqual({ imported: 0, updated: 1, errors: [] });
    expect(server).toMatchObject({ id: 'server-note', note: 'After' });
    expect(contact).toMatchObject({ entityType: 'contact', note: 'Keep' });
  });

  it('reimports a roster row in place and keeps omitted fields', async () => {
    const row = {
      id: 'roster-row',
      team: 'Ops',
      role: 'Primary',
      name: 'Alice',
      contact: 'old',
      timeWindow: 'overnight',
      teamId: 'ops',
    };
    const stored = [row];
    getList.mockResolvedValue({ items: [row], totalItems: 1 });
    create.mockImplementation(async (data: typeof row) => stored.push(data));
    update.mockImplementation(async (_id: string, data: Record<string, unknown>) =>
      Object.assign(row, data),
    );

    const result = await importRows('oncall', format, [
      { team: 'Ops', role: 'Primary', name: 'Alice', contact: 'new' },
    ]);

    expect(result).toEqual({ imported: 0, updated: 1, errors: [] });
    expect(stored).toEqual([
      {
        id: 'roster-row',
        team: 'Ops',
        role: 'Primary',
        name: 'Alice',
        contact: 'new',
        timeWindow: 'overnight',
        teamId: 'ops',
      },
    ]);
    expect(getList).toHaveBeenCalledWith(1, 2, {
      filter: 'team="Ops" && role="Primary" && name="Alice"',
    });
  });
});

describe('import identity validation', () => {
  it.each([
    { entityKey: 'shared-key' },
    { entityType: 'other', entityKey: 'shared-key' },
    { entityType: 'server', entityKey: '' },
    { entityType: 'server', entityKey: '   ' },
    { entityType: 'server', entityKey: null },
    { entityType: 'server', entityKey: {} },
  ])('rejects malformed note identity %j without writes', async (identity) => {
    const result = await importFromJson('notes', JSON.stringify([{ ...identity, note: 'Unsafe' }]));
    expect(result.imported).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('escapes note keys without changing case', async () => {
    await importFromJson(
      'notes',
      JSON.stringify([{ entityType: 'server', entityKey: 'Prod"\\Host', note: 'New' }]),
    );
    expect(getFirstListItem).toHaveBeenCalledWith(
      'entityType="server" && entityKey="Prod\\"\\\\Host"',
    );
    expect(create).toHaveBeenCalledWith({
      entityType: 'server',
      entityKey: 'Prod"\\Host',
      note: 'New',
    });
  });

  it.each([
    { team: 'Other', role: 'Primary', name: 'Alice' },
    { team: 'Ops', role: 'Secondary', name: 'Alice' },
    { team: 'Ops', role: 'Primary', name: 'Bob' },
  ])('creates a distinct roster identity %j', async (row) => {
    const result = await importFromJson('oncall', JSON.stringify([row]));
    expect(result).toEqual({ imported: 1, updated: 0, errors: [] });
    expect(create).toHaveBeenCalledWith(row);
    expect(getList).toHaveBeenCalledWith(1, 2, {
      filter: `team="${row.team}" && role="${row.role}" && name="${row.name}"`,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('matches normalized optional empty roster fields and escapes quotes', async () => {
    getList.mockResolvedValue({ items: [{ id: 'empty-role' }], totalItems: 1 });
    const result = await importFromJson(
      'oncall',
      JSON.stringify([{ team: 'Ops"\\', role: null, contact: 'new' }]),
    );
    expect(result).toEqual({ imported: 0, updated: 1, errors: [] });
    expect(getList).toHaveBeenCalledWith(1, 2, {
      filter: 'team="Ops\\"\\\\" && role="" && name=""',
    });
    expect(update).toHaveBeenCalledWith('empty-role', {
      team: 'Ops"\\',
      role: null,
      contact: 'new',
    });
  });

  it.each([
    {},
    { team: '' },
    { team: '  ' },
    { team: 42 },
    { team: 'Ops', role: [] },
    { team: 'Ops', name: {} },
  ])('rejects malformed roster identity %j', async (row) => {
    const result = await importFromJson('oncall', JSON.stringify([row]));
    expect(result).toMatchObject({ imported: 0, updated: 0 });
    expect(result.errors).toHaveLength(1);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('reports duplicate existing roster identities without choosing an arbitrary row', async () => {
    getList.mockResolvedValue({ items: [{ id: 'one' }, { id: 'two' }], totalItems: 2 });
    const result = await importFromJson(
      'oncall',
      JSON.stringify([{ team: 'Ops', role: '', name: '', contact: 'new' }]),
    );
    expect(result).toMatchObject({ imported: 0, updated: 0 });
    expect(result.errors[0]).toMatch(/multiple|ambiguous/i);
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('surfaces lookup failures without creating a duplicate roster row', async () => {
    getList.mockRejectedValue(new Error('Connection failed'));
    const result = await importFromJson('oncall', JSON.stringify([{ team: 'Ops' }]));
    expect(result.errors).toEqual(['Row 1: Connection failed']);
    expect(create).not.toHaveBeenCalled();
  });
});

const businessRecord = { email: 'alice@example.com', name: 'Alice', teamId: 'ops', pinned: true };
const recordWithMetadata = {
  id: 'record-id',
  created: '2026-09-01',
  updated: '2026-09-02',
  createdAt: 10,
  updatedAt: 20,
  collectionId: 'collection',
  collectionName: 'contacts',
  expand: {},
  ...businessRecord,
};

describe('export metadata content', () => {
  it.each([false, true])(
    'JSON honors includeMetadata=%s for single and all exports',
    async (includeMetadata) => {
      records.set('contacts', [recordWithMetadata]);
      const expected = includeMetadata ? recordWithMetadata : businessRecord;
      expect(JSON.parse(await exportToJson('contacts', { includeMetadata }))).toEqual([expected]);
      const all = JSON.parse(await exportToJson('all', { includeMetadata }));
      expect(all.contacts).toEqual([expected]);
      expect(all.notes).toEqual([]);
      expect(records.get('contacts')).toEqual([recordWithMetadata]);
    },
  );

  it.each([false, true])(
    'CSV honors includeMetadata=%s in its headers and values',
    async (includeMetadata) => {
      records.set('contacts', [recordWithMetadata]);
      const csv = Papa.parse(await exportToCsv('contacts', { includeMetadata }), { header: true });
      expect(csv.meta.fields).toEqual(
        Object.keys(includeMetadata ? recordWithMetadata : businessRecord),
      );
      expect(csv.data[0]).toMatchObject({
        email: 'alice@example.com',
        name: 'Alice',
        teamId: 'ops',
        pinned: 'true',
      });
      records.clear();
      expect(await exportToCsv('contacts', { includeMetadata })).toBe('');
    },
  );

  it.each([false, true])(
    'Excel honors includeMetadata=%s for single and all exports',
    async (includeMetadata) => {
      records.set('contacts', [recordWithMetadata]);
      for (const collection of ['contacts', 'all'] as const) {
        const sheets = await readExcelFile(await exportToExcel(collection, { includeMetadata }));
        expect(sheets[0]?.data[0]).toEqual(
          Object.keys(includeMetadata ? recordWithMetadata : businessRecord),
        );
        expect(sheets[0]?.data[1]?.slice(-4)).toEqual(['alice@example.com', 'Alice', 'ops', true]);
        if (collection === 'all') {
          expect(sheets).toHaveLength(ALL_COLLECTIONS.length);
          expect(sheets.at(-1)?.data).toEqual([]);
        }
      }
    },
  );

  it('keeps metadata by default for direct service callers', async () => {
    records.set('contacts', [recordWithMetadata]);
    expect(JSON.parse(await exportToJson('contacts'))).toEqual([recordWithMetadata]);
    expect(Papa.parse(await exportToCsv('contacts'), { header: true }).meta.fields).toContain('id');
    expect((await readExcelFile(await exportToExcel('contacts')))[0]?.data[0]).toContain('id');
  });
});

describe.each(['json', 'csv', 'excel'] as const)('data manager %s metadata choice', (format) => {
  it.each([false, true, undefined])(
    'downloads the selected content with includeMetadata=%s',
    async (includeMetadata) => {
      records.set('contacts', [recordWithMetadata]);
      const blobs: Blob[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      globalThis.URL.createObjectURL = vi.fn((blob: Blob) => {
        blobs.push(blob);
        return 'blob:export';
      });
      globalThis.URL.revokeObjectURL = vi.fn();
      const { result } = renderHook(() => useDataManager());
      for (const category of ['contacts', 'all'] as const) {
        blobs.length = 0;
        await act(async () => {
          expect(await result.current.exportData({ format, category, includeMetadata })).toBe(true);
        });
        const blob = blobs[0]!;
        let headers: unknown[];
        if (format === 'json') {
          const content = JSON.parse(await blob.text());
          headers = Object.keys(category === 'all' ? content.contacts[0] : content[0]);
        } else if (format === 'csv') {
          headers = Papa.parse(await blob.text(), { header: true }).meta.fields!;
        } else {
          headers = (await readExcelFile(await blob.arrayBuffer()))[0]!.data[0]!;
        }
        expect(headers).toEqual(Object.keys(includeMetadata ? recordWithMetadata : businessRecord));
      }
    },
  );
});
