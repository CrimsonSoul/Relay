import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dialog } from 'electron';
import fs from 'node:fs/promises';
import { importData } from '../DataImportOperations';
import { bulkUpsertContacts } from '../ContactJsonOperations';
import { bulkUpsertServers } from '../ServerJsonOperations';
import { bulkUpsertOnCall } from '../OnCallJsonOperations';
import { getGroups, saveGroup } from '../PresetOperations';
import { parseCsvAsync } from '../../csvUtils';

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
  },
}));

vi.mock('node:fs/promises', () => ({
  default: {
    stat: vi.fn(),
    readFile: vi.fn(),
  },
}));

vi.mock('../ContactJsonOperations', () => ({
  bulkUpsertContacts: vi.fn(),
}));

vi.mock('../ServerJsonOperations', () => ({
  bulkUpsertServers: vi.fn(),
}));

vi.mock('../OnCallJsonOperations', () => ({
  bulkUpsertOnCall: vi.fn(),
}));

vi.mock('../PresetOperations', () => ({
  getGroups: vi.fn(),
  saveGroup: vi.fn(),
}));

vi.mock('../../csvUtils', () => ({
  parseCsvAsync: vi.fn(),
  desanitizeField: (value: string) => value,
}));

vi.mock('../../logger', () => ({
  loggers: {
    fileManager: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

describe('DataImportOperations', () => {
  // eslint-disable-next-line sonarjs/publicly-writable-directories
  const rootDir = '/tmp/data';

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line sonarjs/publicly-writable-directories
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: ['/tmp/in.json'],
    });
    vi.mocked(fs.stat).mockResolvedValue({ size: 100 } as never);
    vi.mocked(fs.readFile).mockResolvedValue('[]');
    vi.mocked(parseCsvAsync).mockResolvedValue([]);
    vi.mocked(bulkUpsertContacts).mockResolvedValue({ imported: 0, updated: 0, errors: [] });
    vi.mocked(bulkUpsertServers).mockResolvedValue({ imported: 0, updated: 0, errors: [] });
    vi.mocked(bulkUpsertOnCall).mockResolvedValue({ imported: 0, updated: 0, errors: [] });
    vi.mocked(getGroups).mockResolvedValue([]);
    vi.mocked(saveGroup).mockResolvedValue({ id: 'g1', name: 'NOC', contacts: [] } as never);
  });

  it('returns empty result when user cancels picker', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] });

    const result = await importData(rootDir, 'contacts');

    expect(result).toEqual({ success: false, imported: 0, updated: 0, skipped: 0, errors: [] });
  });

  it('rejects oversized files', async () => {
    vi.mocked(fs.stat).mockResolvedValue({ size: 60 * 1024 * 1024 } as never);

    const result = await importData(rootDir, 'contacts');

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('File too large');
    expect(fs.readFile).not.toHaveBeenCalled();
  });

  it('imports contacts JSON with normalization and validation', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify([
        { name: 'Alice', email: '  ALICE@EXAMPLE.COM ', phone: '555-0100', title: 'Eng' },
        { name: 'Bad Email', email: 'bad-email', phone: '555-0101', title: 'Bad' },
        { name: 'Bad Phone', email: 'phone@example.com', phone: 'abc', title: 'Ops' },
      ]),
    );
    vi.mocked(bulkUpsertContacts).mockResolvedValue({ imported: 2, updated: 1, errors: [] });

    const result = await importData(rootDir, 'contacts');

    expect(result.success).toBe(true);
    expect(result.imported).toBe(2);
    expect(result.updated).toBe(1);
    expect(bulkUpsertContacts).toHaveBeenCalledWith(rootDir, [
      { name: 'Alice', email: 'alice@example.com', phone: '555-0100', title: 'Eng' },
      { name: 'Bad Phone', email: 'phone@example.com', phone: '', title: 'Ops' },
    ]);
  });

  it('imports contacts CSV using matched headers', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('csv-content');
    vi.mocked(parseCsvAsync).mockResolvedValue([
      ['name', 'email', 'phone', 'title'],
      ['Charlie', 'charlie@example.com', '555-1111', 'SRE'],
      ['NoEmail', '', '555-2222', 'Skip'],
      ['BadPhone', 'badphone@example.com', 'xxx', 'Ops'],
    ]);
    vi.mocked(bulkUpsertContacts).mockResolvedValue({ imported: 2, updated: 0, errors: [] });

    const result = await importData(rootDir, 'contacts');

    expect(result.success).toBe(true);
    expect(bulkUpsertContacts).toHaveBeenCalledWith(rootDir, [
      { name: 'Charlie', email: 'charlie@example.com', phone: '555-1111', title: 'SRE' },
      { name: 'BadPhone', email: 'badphone@example.com', phone: '', title: 'Ops' },
    ]);
  });

  it('imports servers from CSV', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('csv-content');
    vi.mocked(parseCsvAsync).mockResolvedValue([
      ['name', 'business area', 'lob', 'comment', 'owner', 'contact', 'os'],
      ['web-01', 'Ecomm', 'Store', 'Primary', 'owner@example.com', 'tech@example.com', 'Linux'],
      ['', 'Nope', 'Nope', '', '', '', ''],
    ]);
    vi.mocked(bulkUpsertServers).mockResolvedValue({ imported: 1, updated: 0, errors: [] });

    const result = await importData(rootDir, 'servers');

    expect(result.success).toBe(true);
    expect(bulkUpsertServers).toHaveBeenCalledWith(rootDir, [
      {
        name: 'web-01',
        businessArea: 'Ecomm',
        lob: 'Store',
        comment: 'Primary',
        owner: 'owner@example.com',
        contact: 'tech@example.com',
        os: 'Linux',
      },
    ]);
  });

  it('imports on-call from JSON object payload', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        onCall: [
          {
            team: 'SRE',
            role: 'Primary',
            name: 'Alex',
            contact: 'a@example.com',
            timeWindow: '24x7',
          },
          { team: '', role: 'Skip', name: 'No Team', contact: 'x@example.com' },
        ],
      }),
    );
    vi.mocked(bulkUpsertOnCall).mockResolvedValue({ imported: 1, updated: 0, errors: [] });

    const result = await importData(rootDir, 'oncall');

    expect(result.success).toBe(true);
    expect(bulkUpsertOnCall).toHaveBeenCalledWith(rootDir, [
      {
        team: 'SRE',
        role: 'Primary',
        name: 'Alex',
        contact: 'a@example.com',
        timeWindow: '24x7',
      },
    ]);
  });

  it('imports groups from flat CSV and skips existing names', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('csv-content');
    vi.mocked(parseCsvAsync).mockResolvedValue([
      ['group', 'email'],
      ['NOC', 'a@example.com'],
      ['NOC', 'a@example.com'],
      ['NOC', 'b@example.com'],
      ['Ops', 'ops@example.com'],
    ]);
    vi.mocked(getGroups).mockResolvedValue([{ id: 'old', name: 'Ops', contacts: [] } as never]);

    const result = await importData(rootDir, 'groups');

    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);
    expect(saveGroup).toHaveBeenCalledWith(rootDir, {
      name: 'NOC',
      contacts: ['a@example.com', 'b@example.com'],
    });
  });

  it('imports all categories from JSON bundle', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        contacts: [{ name: 'A', email: 'a@example.com', phone: '555-0100', title: 'Ops' }],
        servers: [{ name: 'web-1', owner: 'a@example.com', contact: 'a@example.com', os: 'Linux' }],
        onCall: [{ team: 'SRE', role: 'P', name: 'A', contact: 'a@example.com' }],
        groups: [{ name: 'Night', contacts: ['a@example.com'] }],
      }),
    );
    vi.mocked(bulkUpsertContacts).mockResolvedValue({ imported: 1, updated: 0, errors: [] });
    vi.mocked(bulkUpsertServers).mockResolvedValue({ imported: 1, updated: 0, errors: [] });
    vi.mocked(bulkUpsertOnCall).mockResolvedValue({ imported: 1, updated: 0, errors: [] });

    const result = await importData(rootDir, 'all');

    expect(result.success).toBe(true);
    expect(result.imported).toBe(4);
    expect(bulkUpsertContacts).toHaveBeenCalledTimes(1);
    expect(bulkUpsertServers).toHaveBeenCalledTimes(1);
    expect(bulkUpsertOnCall).toHaveBeenCalledTimes(1);
    expect(saveGroup).toHaveBeenCalledTimes(1);
  });

  it('rejects all-category CSV import', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('name,email\nA,a@example.com');

    const result = await importData(rootDir, 'all');

    expect(result.success).toBe(false);
    expect(result.errors).toContain('Import all requires a JSON file');
  });

  it('returns failure for malformed JSON', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('{ not json');

    const result = await importData(rootDir, 'contacts');

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('Invalid JSON format');
  });

  it('returns failure for unknown category', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('[]');

    const result = await importData(rootDir, 'unknown' as never);

    expect(result.success).toBe(false);
    expect(result.errors).toContain('Unknown category: unknown');
  });
});
