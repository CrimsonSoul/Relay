/**
 * Extended tests for OnCallJsonOperations covering bulkUpsertOnCall
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
import type { OnCallRecord } from '@shared/ipc';
import {
  getOnCall,
  addOnCallRecord,
  updateOnCallRecord,
  deleteOnCallRecord,
  deleteOnCallByTeam,
  updateOnCallTeamJson,
  renameOnCallTeamJson,
  reorderOnCallTeamsJson,
  saveAllOnCallJson,
  bulkUpsertOnCall,
} from '../OnCallJsonOperations';

const mockRead = vi.mocked(readWithLock);
const mockModify = vi.mocked(modifyJsonWithLock);

import os from 'node:os';
import path from 'node:path';

const rootDir = path.join(os.homedir(), 'relay-data');

function makeRecord(overrides: Partial<OnCallRecord> = {}): OnCallRecord {
  return {
    id: 'oc1',
    team: 'TeamA',
    role: 'Primary',
    name: 'Alice',
    contact: 'alice@co.com',
    timeWindow: '9-5',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe('OnCallJsonOperations (extended)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── getOnCall error branch ────────────────────────────────────────────

  describe('getOnCall', () => {
    it('returns empty array when content is empty string', async () => {
      mockRead.mockResolvedValue('');
      const result = await getOnCall(rootDir);
      expect(result).toEqual([]);
    });

    it('throws on non-ENOENT errors', async () => {
      const error = new Error('Permission denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      mockRead.mockRejectedValue(error);

      await expect(getOnCall(rootDir)).rejects.toThrow('Permission denied');
    });
  });

  // ── addOnCallRecord error branches ────────────────────────────────────

  describe('addOnCallRecord', () => {
    it('returns null on lock failure', async () => {
      mockModify.mockRejectedValue(new Error('disk full'));
      const result = await addOnCallRecord(rootDir, {
        team: 'T',
        role: 'R',
        name: 'N',
        contact: 'C',
        timeWindow: '',
      });
      expect(result).toBeNull();
    });
  });

  // ── updateOnCallRecord error branch ───────────────────────────────────

  describe('updateOnCallRecord', () => {
    it('returns false on lock failure', async () => {
      mockModify.mockRejectedValue(new Error('lock failure'));
      const result = await updateOnCallRecord(rootDir, 'oc1', { name: 'X' });
      expect(result).toBe(false);
    });
  });

  // ── deleteOnCallRecord error branch ──────────────────────────────────

  describe('deleteOnCallRecord', () => {
    it('returns false on lock failure', async () => {
      mockModify.mockRejectedValue(new Error('lock failure'));
      const result = await deleteOnCallRecord(rootDir, 'oc1');
      expect(result).toBe(false);
    });
  });

  // ── deleteOnCallByTeam error branch ──────────────────────────────────

  describe('deleteOnCallByTeam', () => {
    it('returns false on lock failure', async () => {
      mockModify.mockRejectedValue(new Error('lock failure'));
      const result = await deleteOnCallByTeam(rootDir, 'TeamA');
      expect(result).toBe(false);
    });
  });

  // ── updateOnCallTeamJson error branch ─────────────────────────────────

  describe('updateOnCallTeamJson', () => {
    it('returns false on lock failure', async () => {
      mockModify.mockRejectedValue(new Error('lock failure'));
      const result = await updateOnCallTeamJson(rootDir, 'TeamA', []);
      expect(result).toBe(false);
    });
  });

  // ── renameOnCallTeamJson error branch ─────────────────────────────────

  describe('renameOnCallTeamJson', () => {
    it('returns false on lock failure', async () => {
      mockModify.mockRejectedValue(new Error('lock failure'));
      const result = await renameOnCallTeamJson(rootDir, 'OldName', 'NewName');
      expect(result).toBe(false);
    });
  });

  // ── reorderOnCallTeamsJson error branch ───────────────────────────────

  describe('reorderOnCallTeamsJson', () => {
    it('returns false on lock failure', async () => {
      mockModify.mockRejectedValue(new Error('lock failure'));
      const result = await reorderOnCallTeamsJson(rootDir, ['TeamA']);
      expect(result).toBe(false);
    });
  });

  // ── saveAllOnCallJson ─────────────────────────────────────────────────

  describe('saveAllOnCallJson', () => {
    it('preserves existing id when provided', async () => {
      let captured: OnCallRecord[] = [];

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([]) as OnCallRecord[];
      });

      const result = await saveAllOnCallJson(rootDir, [
        { id: 'preserved-id', team: 'X', role: 'Lead', name: 'Xena', contact: 'x@co.com' },
      ]);

      expect(result).toBe(true);
      expect(captured[0]?.id).toBe('preserved-id');
    });
  });

  // ── bulkUpsertOnCall ──────────────────────────────────────────────────

  describe('bulkUpsertOnCall', () => {
    it('imports new records when none exist', async () => {
      let captured: OnCallRecord[] = [];

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([]) as OnCallRecord[];
      });

      const result = await bulkUpsertOnCall(rootDir, [
        { team: 'Alpha', role: 'Primary', name: 'Alice', contact: 'a@co.com', timeWindow: '9-5' },
        { team: 'Alpha', role: 'Secondary', name: 'Bob', contact: 'b@co.com', timeWindow: '5-9' },
      ]);

      expect(result.imported).toBe(2);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(captured).toHaveLength(2);
      // Generated IDs should be set
      expect(captured[0]?.id).toBe('gen-id');
    });

    it('updates existing record matched by team+role+name key', async () => {
      const existing = [
        makeRecord({ id: 'oc-existing', team: 'TeamA', role: 'Primary', name: 'Alice' }),
      ];
      let captured: OnCallRecord[] = [];

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([...existing]) as OnCallRecord[];
      });

      const result = await bulkUpsertOnCall(rootDir, [
        {
          team: 'TeamA',
          role: 'Primary',
          name: 'Alice', // matches existing (same key)
          contact: 'alice-new@co.com',
          timeWindow: '8-6',
        },
      ]);

      expect(result.imported).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(captured).toHaveLength(1);
      // Original id preserved
      expect(captured[0]?.id).toBe('oc-existing');
      // Contact updated
      expect(captured[0]?.contact).toBe('alice-new@co.com');
      expect(captured[0]?.timeWindow).toBe('8-6');
    });

    it('handles mixed imports and updates', async () => {
      const existing = [makeRecord({ id: 'oc1', team: 'TeamA', role: 'Primary', name: 'Alice' })];
      let captured: OnCallRecord[] = [];

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([...existing]) as OnCallRecord[];
      });

      const result = await bulkUpsertOnCall(rootDir, [
        {
          team: 'TeamA',
          role: 'Primary',
          name: 'Alice', // update
          contact: 'alice2@co.com',
          timeWindow: '',
        },
        {
          team: 'TeamB',
          role: 'Lead',
          name: 'Carlos', // new import
          contact: 'carlos@co.com',
          timeWindow: 'all-day',
        },
      ]);

      expect(result.imported).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(captured).toHaveLength(2);
    });

    it('returns error string when modifyJsonWithLock throws', async () => {
      mockModify.mockRejectedValue(new Error('disk full'));

      const result = await bulkUpsertOnCall(rootDir, [
        { team: 'T', role: 'R', name: 'N', contact: 'C', timeWindow: '' },
      ]);

      expect(result.imported).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Bulk upsert failed');
    });

    it('handles empty input array gracefully', async () => {
      let captured: OnCallRecord[] = [];
      const existing = [makeRecord()];

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([...existing]) as OnCallRecord[];
      });

      const result = await bulkUpsertOnCall(rootDir, []);

      expect(result.imported).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(0);
      // Existing records preserved unchanged
      expect(captured).toHaveLength(1);
    });

    it('key matching is case-insensitive for team+role+name', async () => {
      const existing = [makeRecord({ id: 'oc99', team: 'TEAM-X', role: 'LEAD', name: 'Dave' })];
      let captured: OnCallRecord[] = [];

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([...existing]) as OnCallRecord[];
      });

      // Different case but same logical key
      const result = await bulkUpsertOnCall(rootDir, [
        {
          team: 'team-x',
          role: 'lead',
          name: 'dave',
          contact: 'dave-new@co.com',
          timeWindow: '',
        },
      ]);

      expect(result.updated).toBe(1);
      expect(captured[0]?.id).toBe('oc99');
      expect(captured[0]?.contact).toBe('dave-new@co.com');
    });
  });
});
