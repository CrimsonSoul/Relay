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

import { readWithLock, modifyJsonWithLock } from '../../fileLock';
import { getGroups, saveGroup, updateGroup, deleteGroup } from '../PresetOperations';

const mockRead = vi.mocked(readWithLock);
const mockModify = vi.mocked(modifyJsonWithLock);

const rootDir = '/tmp/relay-test';

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
      expect(capturedGroups[0].createdAt).toBeTypeOf('number');
      expect(capturedGroups[0].updatedAt).toBeTypeOf('number');
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
      expect(capturedGroups[0].name).toBe('Team A Renamed');
      expect(capturedGroups[0].updatedAt).toBeGreaterThanOrEqual(Date.now() - 1000);
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
      expect(capturedGroups[0].id).toBe('g2');
    });

    it('returns false if id not found', async () => {
      mockModify.mockImplementation(async (_path, callback, _defaultValue) => {
        await callback(structuredClone(sampleGroups));
      });

      const result = await deleteGroup(rootDir, 'nonexistent');
      expect(result).toBe(false);
    });
  });
});
