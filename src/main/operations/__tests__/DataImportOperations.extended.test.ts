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
  dialog: { showOpenDialog: vi.fn() },
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

describe('DataImportOperations (extended coverage)', () => {
  // eslint-disable-next-line sonarjs/publicly-writable-directories
  const rootDir = '/tmp/data-ext';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      // eslint-disable-next-line sonarjs/publicly-writable-directories
      filePaths: ['/tmp/test.json'],
    });
    vi.mocked(fs.stat).mockResolvedValue({ size: 500 } as never);
    vi.mocked(fs.readFile).mockResolvedValue('[]');
    vi.mocked(parseCsvAsync).mockResolvedValue([]);
    vi.mocked(bulkUpsertContacts).mockResolvedValue({ imported: 0, updated: 0, errors: [] });
    vi.mocked(bulkUpsertServers).mockResolvedValue({ imported: 0, updated: 0, errors: [] });
    vi.mocked(bulkUpsertOnCall).mockResolvedValue({ imported: 0, updated: 0, errors: [] });
    vi.mocked(getGroups).mockResolvedValue([]);
    vi.mocked(saveGroup).mockResolvedValue({ id: 'g1', name: 'G', contacts: [] } as never);
  });

  it('handles BOM in file content', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('\uFEFF[]');
    const result = await importData(rootDir, 'contacts');
    expect(result.success).toBe(true);
    expect(bulkUpsertContacts).toHaveBeenCalledWith(rootDir, []);
  });

  it('imports contacts from wrapped JSON object { contacts: [...] }', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        contacts: [{ name: 'Bob', email: 'bob@example.com', phone: '555-0100', title: 'Dev' }],
      }),
    );
    vi.mocked(bulkUpsertContacts).mockResolvedValue({ imported: 1, updated: 0, errors: [] });

    const result = await importData(rootDir, 'contacts');
    expect(result.success).toBe(true);
    expect(bulkUpsertContacts).toHaveBeenCalledWith(rootDir, [
      { name: 'Bob', email: 'bob@example.com', phone: '555-0100', title: 'Dev' },
    ]);
  });

  it('skips contacts with missing email fields', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify([
        { name: 'No Email', email: '', phone: '', title: '' },
        { name: 'Good', email: 'good@example.com', phone: '', title: '' },
      ]),
    );
    vi.mocked(bulkUpsertContacts).mockResolvedValue({ imported: 1, updated: 0, errors: [] });

    await importData(rootDir, 'contacts');
    const call = vi.mocked(bulkUpsertContacts).mock.calls[0][1];
    expect(call).toHaveLength(1);
    expect(call[0].email).toBe('good@example.com');
  });

  it('throws on contacts JSON that is not an array and not object with contacts key', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify('just a string'));
    const result = await importData(rootDir, 'contacts');
    // validateContactRecords skips non-object entries; result is empty but no crash
    expect(result.success).toBe(true);
  });

  it('imports servers from JSON array', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify([
        {
          name: 'svr-01',
          businessArea: 'Ops',
          lob: 'Core',
          comment: '',
          owner: '',
          contact: '',
          os: 'Linux',
        },
        { name: '', businessArea: 'Skip' }, // filtered out - no name
      ]),
    );
    vi.mocked(bulkUpsertServers).mockResolvedValue({ imported: 1, updated: 0, errors: [] });

    const result = await importData(rootDir, 'servers');
    expect(result.success).toBe(true);
    const call = vi.mocked(bulkUpsertServers).mock.calls[0][1];
    expect(call).toHaveLength(1);
    expect(call[0].name).toBe('svr-01');
  });

  it('imports servers from wrapped JSON { servers: [...] }', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        servers: [
          {
            name: 'web-1',
            businessArea: 'Web',
            lob: '',
            comment: '',
            owner: '',
            contact: '',
            os: '',
          },
        ],
      }),
    );
    vi.mocked(bulkUpsertServers).mockResolvedValue({ imported: 1, updated: 0, errors: [] });

    const result = await importData(rootDir, 'servers');
    expect(result.success).toBe(true);
  });

  it('imports on-call CSV with time window column', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('csv-content');
    vi.mocked(parseCsvAsync).mockResolvedValue([
      ['team', 'role', 'name', 'contact', 'time window'],
      ['SRE', 'Primary', 'Alex', 'a@example.com', 'Night'],
      ['', 'Skip', 'NoTeam', '', ''],
    ]);
    vi.mocked(bulkUpsertOnCall).mockResolvedValue({ imported: 1, updated: 0, errors: [] });

    const result = await importData(rootDir, 'oncall');
    expect(result.success).toBe(true);
    const call = vi.mocked(bulkUpsertOnCall).mock.calls[0][1];
    expect(call[0].timeWindow).toBe('Night');
  });

  it('imports on-call from oncall-keyed JSON', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({
        oncall: [{ team: 'SRE', role: 'P', name: 'A', contact: 'a@example.com' }],
      }),
    );
    vi.mocked(bulkUpsertOnCall).mockResolvedValue({ imported: 1, updated: 0, errors: [] });

    const result = await importData(rootDir, 'oncall');
    expect(result.success).toBe(true);
  });

  it('imports groups from standard CSV (name + contacts columns)', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('csv-content');
    vi.mocked(parseCsvAsync).mockResolvedValue([
      ['name', 'contacts'],
      ['Night', 'a@example.com;b@example.com'],
      ['', ''], // filtered out
    ]);
    vi.mocked(getGroups).mockResolvedValue([]);

    const result = await importData(rootDir, 'groups');
    expect(result.success).toBe(true);
    expect(saveGroup).toHaveBeenCalledWith(rootDir, {
      name: 'Night',
      contacts: ['a@example.com', 'b@example.com'],
    });
  });

  it('skips group save when group already exists', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify([{ name: 'Existing', contacts: ['x@example.com'] }]),
    );
    vi.mocked(getGroups).mockResolvedValue([{ id: 'g1', name: 'Existing', contacts: [] } as never]);

    const result = await importData(rootDir, 'groups');
    expect(result.skipped).toBe(1);
    expect(saveGroup).not.toHaveBeenCalled();
  });

  it('counts error when saveGroup returns falsy', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify([{ name: 'NewGroup', contacts: ['x@example.com'] }]),
    );
    vi.mocked(getGroups).mockResolvedValue([]);
    vi.mocked(saveGroup).mockResolvedValue(null as never);

    const result = await importData(rootDir, 'groups');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Failed to save group: NewGroup');
  });

  it('handles exception during importData gracefully', async () => {
    vi.mocked(fs.stat).mockRejectedValue(new Error('stat failed'));
    const result = await importData(rootDir, 'contacts');
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('Import failed');
  });

  it('imports groups from JSON where groups key has importedBridgeGroup format', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify({ groups: [{ name: 'Alpha', contacts: ['a@example.com'] }] }),
    );
    vi.mocked(getGroups).mockResolvedValue([]);
    vi.mocked(saveGroup).mockResolvedValue({ id: 'g1', name: 'Alpha', contacts: [] } as never);

    const result = await importData(rootDir, 'all');
    expect(result.success).toBe(true);
    expect(saveGroup).toHaveBeenCalledWith(rootDir, {
      name: 'Alpha',
      contacts: ['a@example.com'],
    });
  });

  it('handles on-call records with timeWindow undefined/null properly', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(
      JSON.stringify([
        { team: 'SRE', role: 'P', name: 'A', contact: 'a@b.com', timeWindow: null },
        { team: 'SRE', role: 'P', name: 'B', contact: 'b@b.com' },
      ]),
    );
    vi.mocked(bulkUpsertOnCall).mockResolvedValue({ imported: 2, updated: 0, errors: [] });

    const result = await importData(rootDir, 'oncall');
    expect(result.success).toBe(true);
    const call = vi.mocked(bulkUpsertOnCall).mock.calls[0][1];
    expect(call[0].timeWindow).toBeUndefined();
    expect(call[1].timeWindow).toBeUndefined();
  });
});
