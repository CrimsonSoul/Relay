import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dialog } from 'electron';
import fs from 'node:fs/promises';
import { exportData } from '../DataExportOperations';
import { getContacts } from '../ContactJsonOperations';
import { getServers } from '../ServerJsonOperations';
import { getOnCall } from '../OnCallJsonOperations';
import { getGroups } from '../PresetOperations';

vi.mock('electron', () => ({
  dialog: {
    showSaveDialog: vi.fn(),
  },
}));

vi.mock('node:fs/promises', () => ({
  default: {
    writeFile: vi.fn(),
  },
}));

vi.mock('../ContactJsonOperations', () => ({
  getContacts: vi.fn(),
}));

vi.mock('../ServerJsonOperations', () => ({
  getServers: vi.fn(),
}));

vi.mock('../OnCallJsonOperations', () => ({
  getOnCall: vi.fn(),
}));

vi.mock('../PresetOperations', () => ({
  getGroups: vi.fn(),
}));

vi.mock('../../logger', () => ({
  loggers: {
    fileManager: {
      info: vi.fn(),
      error: vi.fn(),
    },
  },
}));

describe('DataExportOperations', () => {
  // eslint-disable-next-line sonarjs/publicly-writable-directories
  const rootDir = '/tmp/data';

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line sonarjs/publicly-writable-directories
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: '/tmp/out.txt',
    });
    vi.mocked(getContacts).mockResolvedValue([
      {
        id: 'c1',
        name: 'Alice',
        email: 'alice@example.com',
        phone: '555-0100',
        title: 'Engineer',
        createdAt: 100,
        updatedAt: 200,
      },
    ] as never);
    vi.mocked(getServers).mockResolvedValue([
      {
        id: 's1',
        name: 'web-01',
        businessArea: 'Ecomm',
        lob: 'Store',
        comment: 'Primary',
        owner: 'owner@example.com',
        contact: 'tech@example.com',
        os: 'Linux',
        createdAt: 100,
        updatedAt: 200,
      },
    ] as never);
    vi.mocked(getOnCall).mockResolvedValue([
      {
        id: 'o1',
        team: 'SRE',
        role: 'Primary',
        name: 'Pat',
        contact: 'pat@example.com',
        timeWindow: '24x7',
        createdAt: 100,
        updatedAt: 200,
      },
    ] as never);
    vi.mocked(getGroups).mockResolvedValue([
      {
        id: 'g1',
        name: 'Night',
        contacts: ['alice@example.com'],
        createdAt: 100,
        updatedAt: 200,
      },
    ] as never);
  });

  it('returns false when user cancels save dialog', async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true, filePath: undefined });

    const result = await exportData(rootDir, { category: 'contacts', format: 'json' });

    expect(result).toBe(false);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('exports contacts JSON without metadata by default', async () => {
    const result = await exportData(rootDir, { category: 'contacts', format: 'json' });

    expect(result).toBe(true);
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    const [, content] = vi.mocked(fs.writeFile).mock.calls[0];
    const parsed = JSON.parse(content as string);
    expect(parsed).toEqual([
      {
        name: 'Alice',
        email: 'alice@example.com',
        phone: '555-0100',
        title: 'Engineer',
      },
    ]);
  });

  it('exports contacts CSV with formula-injection escaping', async () => {
    vi.mocked(getContacts).mockResolvedValue([
      {
        id: 'c1',
        name: '=HYPERLINK("x")',
        email: 'safe@example.com',
        phone: '555-0100',
        title: 'Ops',
        createdAt: 100,
        updatedAt: 200,
      },
    ] as never);

    const result = await exportData(rootDir, {
      category: 'contacts',
      format: 'csv',
      includeMetadata: true,
    });

    expect(result).toBe(true);
    const [, content] = vi.mocked(fs.writeFile).mock.calls[0];
    expect(content).toContain('\uFEFF');
    expect(content).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('exports all categories as JSON', async () => {
    const result = await exportData(rootDir, {
      category: 'all',
      format: 'json',
      includeMetadata: false,
    });

    expect(result).toBe(true);
    const [, content] = vi.mocked(fs.writeFile).mock.calls[0];
    const parsed = JSON.parse(content as string);
    expect(parsed.contacts[0].id).toBeUndefined();
    expect(parsed.servers[0].id).toBeUndefined();
    expect(parsed.onCall[0].id).toBeUndefined();
    expect(parsed.groups[0].id).toBeUndefined();
    expect(parsed.exportedAt).toBeTypeOf('string');
  });

  it('exports all categories as CSV with section headers', async () => {
    const result = await exportData(rootDir, {
      category: 'all',
      format: 'csv',
      includeMetadata: false,
    });

    expect(result).toBe(true);
    const [, content] = vi.mocked(fs.writeFile).mock.calls[0];
    expect(content).toContain('# CONTACTS');
    expect(content).toContain('# SERVERS');
    expect(content).toContain('# ONCALL');
    expect(content).toContain('# GROUPS');
  });

  it('returns false on unknown category', async () => {
    const result = await exportData(rootDir, {
      category: 'unknown' as never,
      format: 'json',
    });

    expect(result).toBe(false);
  });
});
