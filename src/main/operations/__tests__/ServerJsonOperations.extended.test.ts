/**
 * Extended tests for ServerJsonOperations covering bulkUpsertServers
 * and additional error/edge-case branches not covered by the base test file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../fileLock', () => ({
  readWithLock: vi.fn(),
  modifyJsonWithLock: vi.fn(),
}));

vi.mock('../../logger', () => ({
  loggers: {
    fileManager: {
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
    },
  },
}));

vi.mock('../idUtils', () => ({
  generateId: vi.fn(() => 'gen-id'),
}));

import { readWithLock, modifyJsonWithLock } from '../../fileLock';
import type { ServerRecord } from '@shared/ipc';
import {
  getServers,
  updateServerRecord,
  deleteServerRecord,
  findServerByName,
  bulkUpsertServers,
} from '../ServerJsonOperations';

const mockRead = vi.mocked(readWithLock);
const mockModify = vi.mocked(modifyJsonWithLock);

import os from 'node:os';
import path from 'node:path';

const rootDir = path.join(os.homedir(), 'relay-data');

function makeServer(overrides: Partial<ServerRecord> = {}): ServerRecord {
  return {
    id: 'srv1',
    name: 'web-server-01',
    businessArea: 'Engineering',
    lob: 'Platform',
    comment: '',
    owner: 'ops',
    contact: 'ops@co.com',
    os: 'Linux',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe('ServerJsonOperations (extended)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── getServers error branch ──────────────────────────────────────────

  describe('getServers', () => {
    it('returns empty array when readWithLock returns empty string', async () => {
      mockRead.mockResolvedValue('');
      const result = await getServers(rootDir);
      expect(result).toEqual([]);
    });

    it('throws on non-ENOENT errors', async () => {
      const error = new Error('Permission denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      mockRead.mockRejectedValue(error);

      await expect(getServers(rootDir)).rejects.toThrow('Permission denied');
    });
  });

  // ── updateServerRecord error branch ─────────────────────────────────

  describe('updateServerRecord', () => {
    it('returns false on thrown error', async () => {
      mockModify.mockRejectedValue(new Error('lock failure'));
      const result = await updateServerRecord(rootDir, 'srv1', { comment: 'x' });
      expect(result).toBe(false);
    });
  });

  // ── deleteServerRecord error branch ─────────────────────────────────

  describe('deleteServerRecord', () => {
    it('returns false on thrown error', async () => {
      mockModify.mockRejectedValue(new Error('lock failure'));
      const result = await deleteServerRecord(rootDir, 'srv1');
      expect(result).toBe(false);
    });
  });

  // ── findServerByName error branch ────────────────────────────────────

  describe('findServerByName', () => {
    it('returns null on thrown error', async () => {
      mockRead.mockRejectedValue(new Error('disk error'));
      const result = await findServerByName(rootDir, 'web-server-01');
      expect(result).toBeNull();
    });
  });

  // ── bulkUpsertServers ────────────────────────────────────────────────

  describe('bulkUpsertServers', () => {
    it('imports new servers when none exist', async () => {
      let captured: ServerRecord[] = [];

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([]) as ServerRecord[];
      });

      const result = await bulkUpsertServers(rootDir, [
        {
          name: 'alpha-server',
          businessArea: 'Eng',
          lob: 'Core',
          comment: '',
          owner: 'team-a',
          contact: 'a@co.com',
          os: 'Linux',
        },
        {
          name: 'beta-server',
          businessArea: 'Ops',
          lob: 'Infra',
          comment: '',
          owner: 'team-b',
          contact: 'b@co.com',
          os: 'Windows',
        },
      ]);

      expect(result.imported).toBe(2);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(captured).toHaveLength(2);
      expect(captured[0]?.id).toBe('gen-id');
      expect(captured.map((s) => s.name)).toContain('alpha-server');
      expect(captured.map((s) => s.name)).toContain('beta-server');
    });

    it('updates existing servers matched by name (case-insensitive)', async () => {
      const existing = [makeServer({ id: 'srv1', name: 'Web-Server-01', businessArea: 'OldArea' })];
      let captured: ServerRecord[] = [];

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([...existing]) as ServerRecord[];
      });

      const result = await bulkUpsertServers(rootDir, [
        {
          name: 'web-server-01', // lowercase — should match existing
          businessArea: 'NewArea',
          lob: 'NewLob',
          comment: 'updated',
          owner: 'new-owner',
          contact: 'new@co.com',
          os: 'FreeBSD',
        },
      ]);

      expect(result.imported).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(captured).toHaveLength(1);
      // Original id preserved
      expect(captured[0]?.id).toBe('srv1');
      // Fields updated
      expect(captured[0]?.businessArea).toBe('NewArea');
      expect(captured[0]?.os).toBe('FreeBSD');
    });

    it('handles mix of new imports and updates in the same call', async () => {
      const existing = [makeServer({ id: 'existing-1', name: 'old-server' })];
      let captured: ServerRecord[] = [];

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([...existing]) as ServerRecord[];
      });

      const result = await bulkUpsertServers(rootDir, [
        {
          name: 'old-server', // update
          businessArea: 'Eng',
          lob: 'A',
          comment: '',
          owner: 'x',
          contact: 'x@co.com',
          os: 'Linux',
        },
        {
          name: 'brand-new-server', // import
          businessArea: 'Infra',
          lob: 'B',
          comment: '',
          owner: 'y',
          contact: 'y@co.com',
          os: 'Windows',
        },
      ]);

      expect(result.imported).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(captured).toHaveLength(2);
    });

    it('returns error string when modifyJsonWithLock throws', async () => {
      mockModify.mockRejectedValue(new Error('lock acquisition failed'));

      const result = await bulkUpsertServers(rootDir, [
        {
          name: 'some-server',
          businessArea: '',
          lob: '',
          comment: '',
          owner: '',
          contact: '',
          os: '',
        },
      ]);

      expect(result.imported).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Bulk upsert failed');
    });

    it('handles empty input array gracefully', async () => {
      let captured: ServerRecord[] = [];

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([makeServer()]) as ServerRecord[];
      });

      const result = await bulkUpsertServers(rootDir, []);

      expect(result.imported).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(0);
      // Existing records preserved
      expect(captured).toHaveLength(1);
    });
  });
});
