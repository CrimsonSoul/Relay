/* eslint-disable sonarjs/publicly-writable-directories */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BridgeGroup } from '@shared/ipc';

vi.mock('../../fileLock', () => ({
  readWithLock: vi.fn(),
  modifyJsonWithLock: vi.fn(),
}));

vi.mock('../../logger', () => ({
  loggers: {
    fileManager: {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

vi.mock('../idUtils', () => ({
  generateId: vi.fn(() => 'test-id-123'),
}));

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn(),
  },
}));

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(),
  },
}));

vi.mock('../../csvUtils', () => ({
  parseCsvAsync: vi.fn(),
}));

import { readWithLock, modifyJsonWithLock } from '../../fileLock';
import {
  getGroups,
  saveGroup,
  updateGroup,
  deleteGroup,
  importGroupsFromCsv,
} from '../PresetOperations';
import { dialog } from 'electron';
import fs from 'node:fs/promises';
import { parseCsvAsync } from '../../csvUtils';

const mockRead = vi.mocked(readWithLock);
const mockModify = vi.mocked(modifyJsonWithLock);
const mockDialog = vi.mocked(dialog.showOpenDialog);
const mockReadFile = vi.mocked(fs.readFile);
const mockParseCsv = vi.mocked(parseCsvAsync);

import os from 'node:os';
import path from 'node:path';

const rootDir = path.join(os.homedir(), 'relay-data');

const sampleGroups: BridgeGroup[] = [
  { id: 'g1', name: 'Team A', contacts: ['a@test.com'], createdAt: 1000, updatedAt: 1000 },
  { id: 'g2', name: 'Team B', contacts: ['b@test.com'], createdAt: 2000, updatedAt: 2000 },
];

describe('PresetOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getGroups', () => {
    it('reads and returns groups', async () => {
      mockRead.mockResolvedValue(JSON.stringify(sampleGroups));

      const result = await getGroups(rootDir);
      expect(result).toEqual(sampleGroups);
      expect(mockRead).toHaveBeenCalledWith(expect.stringContaining('bridgeGroups.json'));
    });

    it('returns empty array when file does not exist (ENOENT)', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockRead.mockRejectedValue(error);

      const result = await getGroups(rootDir);
      expect(result).toEqual([]);
    });

    it('returns empty array for null/empty content', async () => {
      mockRead.mockResolvedValue(null as unknown as string);

      const result = await getGroups(rootDir);
      expect(result).toEqual([]);
    });

    it('returns empty array for invalid JSON', async () => {
      mockRead.mockResolvedValue('not valid json');

      const result = await getGroups(rootDir);
      expect(result).toEqual([]);
    });
  });

  describe('saveGroup', () => {
    it('adds new group with generated id', async () => {
      let capturedGroups: BridgeGroup[] = [];
      mockModify.mockImplementation(async (_path, callback, _defaultValue) => {
        const existing: BridgeGroup[] = [];
        const result = await callback(existing);
        capturedGroups = result as BridgeGroup[];
      });

      const result = await saveGroup(rootDir, {
        name: 'New Group',
        contacts: ['x@test.com', 'y@test.com'],
      });

      expect(mockModify).toHaveBeenCalledOnce();
      expect(capturedGroups).toHaveLength(1);
      expect(capturedGroups[0]).toMatchObject({
        id: 'test-id-123',
        name: 'New Group',
        contacts: ['x@test.com', 'y@test.com'],
      });
      expect(capturedGroups[0]?.createdAt).toBeTypeOf('number');
      expect(capturedGroups[0]?.updatedAt).toBeTypeOf('number');
      expect(result).toMatchObject({ id: 'test-id-123', name: 'New Group' });
    });
  });

  describe('updateGroup', () => {
    it('updates fields by id', async () => {
      let capturedGroups: BridgeGroup[] = [];
      mockModify.mockImplementation(async (_path, callback, _defaultValue) => {
        const existing = structuredClone(sampleGroups);
        const result = await callback(existing);
        capturedGroups = result as BridgeGroup[];
      });

      const result = await updateGroup(rootDir, 'g1', { name: 'Team A Renamed' });

      expect(result).toBe(true);
      expect(capturedGroups[0]?.name).toBe('Team A Renamed');
      expect(capturedGroups[0]?.updatedAt).toBeGreaterThanOrEqual(Date.now() - 1000);
    });

    it('returns false if id not found', async () => {
      mockModify.mockImplementation(async (_path, callback, _defaultValue) => {
        await callback(structuredClone(sampleGroups));
      });

      const result = await updateGroup(rootDir, 'nonexistent', { name: 'Nope' });
      expect(result).toBe(false);
    });
  });

  describe('deleteGroup', () => {
    it('removes group by id', async () => {
      let capturedGroups: BridgeGroup[] = [];
      mockModify.mockImplementation(async (_path, callback, _defaultValue) => {
        const existing = structuredClone(sampleGroups);
        const result = await callback(existing);
        capturedGroups = result as BridgeGroup[];
      });

      const result = await deleteGroup(rootDir, 'g1');

      expect(result).toBe(true);
      expect(capturedGroups).toHaveLength(1);
      expect(capturedGroups[0]?.id).toBe('g2');
    });

    it('returns false if id not found', async () => {
      mockModify.mockImplementation(async (_path, callback, _defaultValue) => {
        await callback(structuredClone(sampleGroups));
      });

      const result = await deleteGroup(rootDir, 'nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('importGroupsFromCsv', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns false when dialog is canceled', async () => {
      mockDialog.mockResolvedValue({ canceled: true, filePaths: [] });

      const result = await importGroupsFromCsv(rootDir);
      expect(result).toBe(false);
    });

    it('returns false when no file path returned', async () => {
      mockDialog.mockResolvedValue({ canceled: false, filePaths: [] });

      const result = await importGroupsFromCsv(rootDir);
      expect(result).toBe(false);
    });

    it('returns false when CSV is empty', async () => {
      mockDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/groups.csv'] });
      mockReadFile.mockResolvedValue('');
      mockParseCsv.mockResolvedValue([]);

      const result = await importGroupsFromCsv(rootDir);
      expect(result).toBe(false);
    });

    it('returns false when required columns are missing', async () => {
      mockDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/groups.csv'] });
      mockReadFile.mockResolvedValue('foo,bar\nA,B');
      mockParseCsv.mockResolvedValue([
        ['foo', 'bar'],
        ['A', 'B'],
      ]);

      const result = await importGroupsFromCsv(rootDir);
      expect(result).toBe(false);
    });

    it('imports groups from valid CSV (group_name + email format)', async () => {
      mockDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/groups.csv'] });
      mockReadFile.mockResolvedValue(
        'group_name,email\nNOC,a@test.com\nNOC,b@test.com\nOps,c@test.com',
      );
      mockParseCsv.mockResolvedValue([
        ['group_name', 'email'],
        ['NOC', 'a@test.com'],
        ['NOC', 'b@test.com'],
        ['Ops', 'c@test.com'],
      ]);

      let capturedGroups: BridgeGroup[] = [];
      mockModify.mockImplementation(async (_path, callback, _defaultValue) => {
        const result = await callback([]);
        capturedGroups = result as BridgeGroup[];
      });

      const result = await importGroupsFromCsv(rootDir);

      expect(result).toBe(true);
      expect(capturedGroups).toHaveLength(2);
      const nocGroup = capturedGroups.find((g) => g.name === 'NOC');
      expect(nocGroup?.contacts).toContain('a@test.com');
      expect(nocGroup?.contacts).toContain('b@test.com');
    });

    it('skips duplicate groups (case-insensitive match)', async () => {
      mockDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/groups.csv'] });
      mockReadFile.mockResolvedValue('name,email\nNOC,a@test.com');
      mockParseCsv.mockResolvedValue([
        ['name', 'email'],
        ['NOC', 'a@test.com'],
      ]);

      const existing: BridgeGroup[] = [
        { id: 'old', name: 'noc', contacts: [], createdAt: 1000, updatedAt: 1000 },
      ];
      mockModify.mockImplementation(async (_path, callback, _defaultValue) => {
        await callback(existing);
      });

      const result = await importGroupsFromCsv(rootDir);
      expect(result).toBe(true);
      // The NOC group should have been skipped (already exists as 'noc')
      expect(mockModify).toHaveBeenCalledOnce();
    });

    it('skips rows with missing group name or email', async () => {
      mockDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/groups.csv'] });
      mockReadFile.mockResolvedValue('group_name,email\n,a@test.com\nNOC,\nValid,v@test.com');
      mockParseCsv.mockResolvedValue([
        ['group_name', 'email'],
        ['', 'a@test.com'],
        ['NOC', ''],
        ['Valid', 'v@test.com'],
      ]);

      let capturedGroups: BridgeGroup[] = [];
      mockModify.mockImplementation(async (_path, callback, _defaultValue) => {
        const result = await callback([]);
        capturedGroups = result as BridgeGroup[];
      });

      await importGroupsFromCsv(rootDir);
      expect(capturedGroups).toHaveLength(1);
      expect(capturedGroups[0]?.name).toBe('Valid');
    });

    it('deduplicates emails within the same group', async () => {
      mockDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/groups.csv'] });
      mockParseCsv.mockResolvedValue([
        ['group_name', 'email'],
        ['Team', 'dup@test.com'],
        ['Team', 'dup@test.com'],
        ['Team', 'other@test.com'],
      ]);
      mockReadFile.mockResolvedValue('irrelevant');

      let capturedGroups: BridgeGroup[] = [];
      mockModify.mockImplementation(async (_path, callback, _defaultValue) => {
        const result = await callback([]);
        capturedGroups = result as BridgeGroup[];
      });

      await importGroupsFromCsv(rootDir);
      const team = capturedGroups.find((g) => g.name === 'Team');
      expect(team?.contacts).toHaveLength(2);
    });

    it('returns false on unexpected error', async () => {
      mockDialog.mockRejectedValue(new Error('dialog crashed'));

      const result = await importGroupsFromCsv(rootDir);
      expect(result).toBe(false);
    });
  });
});
