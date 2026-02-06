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
  generateId: vi.fn(() => 'test-id-123'),
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
} from '../OnCallJsonOperations';

const mockRead = vi.mocked(readWithLock);
const mockModify = vi.mocked(modifyJsonWithLock);

const rootDir = '/tmp/relay-data';

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

describe('OnCallJsonOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── getOnCall ─────────────────────────────────────────────────────

  describe('getOnCall', () => {
    it('reads and returns records', async () => {
      const records = [makeRecord({ id: 'oc1' }), makeRecord({ id: 'oc2' })];
      mockRead.mockResolvedValue(JSON.stringify(records));

      const result = await getOnCall(rootDir);
      expect(result).toEqual(records);
    });

    it('returns empty array for ENOENT', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockRead.mockRejectedValue(error);

      const result = await getOnCall(rootDir);
      expect(result).toEqual([]);
    });

    it('returns empty array for invalid JSON', async () => {
      mockRead.mockResolvedValue('not-json{{{');

      const result = await getOnCall(rootDir);
      expect(result).toEqual([]);
    });

    it('returns empty array when data is not an array', async () => {
      mockRead.mockResolvedValue(JSON.stringify({ not: 'array' }));

      const result = await getOnCall(rootDir);
      expect(result).toEqual([]);
    });
  });

  // ── addOnCallRecord ───────────────────────────────────────────────

  describe('addOnCallRecord', () => {
    it('creates record with generated id', async () => {
      let captured: OnCallRecord[] | undefined;

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([]) as OnCallRecord[];
      });

      const result = await addOnCallRecord(rootDir, {
        team: 'TeamB',
        role: 'Secondary',
        name: 'Bob',
        contact: 'bob@co.com',
        timeWindow: '5-9',
      });

      expect(result).not.toBeNull();
      expect(result!.id).toBe('test-id-123');
      expect(result!.team).toBe('TeamB');
      expect(result!.role).toBe('Secondary');
      expect(captured!).toHaveLength(1);
    });

    it('returns null on error', async () => {
      mockModify.mockRejectedValue(new Error('fail'));

      const result = await addOnCallRecord(rootDir, {
        team: 'T',
        role: 'R',
        name: 'N',
        contact: 'C',
      });

      expect(result).toBeNull();
    });
  });

  // ── updateOnCallRecord ────────────────────────────────────────────

  describe('updateOnCallRecord', () => {
    it('updates by id', async () => {
      const existing = [makeRecord({ id: 'oc1', name: 'Alice' })];
      let captured: OnCallRecord[] | undefined;

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([...existing]) as OnCallRecord[];
      });

      const result = await updateOnCallRecord(rootDir, 'oc1', { name: 'Alicia' });

      expect(result).toBe(true);
      expect(captured![0].name).toBe('Alicia');
    });

    it('returns false if not found', async () => {
      mockModify.mockImplementation(async (_path, callback) => {
        callback([makeRecord({ id: 'oc1' })]);
      });

      const result = await updateOnCallRecord(rootDir, 'nonexistent', { name: 'X' });
      expect(result).toBe(false);
    });
  });

  // ── deleteOnCallRecord ────────────────────────────────────────────

  describe('deleteOnCallRecord', () => {
    it('filters by id', async () => {
      const records = [makeRecord({ id: 'oc1' }), makeRecord({ id: 'oc2' })];
      let captured: OnCallRecord[] | undefined;

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([...records]) as OnCallRecord[];
      });

      const result = await deleteOnCallRecord(rootDir, 'oc1');

      expect(result).toBe(true);
      expect(captured!).toHaveLength(1);
      expect(captured![0].id).toBe('oc2');
    });

    it('returns false when id not found', async () => {
      mockModify.mockImplementation(async (_path, callback) => {
        callback([makeRecord({ id: 'oc1' })]);
      });

      const result = await deleteOnCallRecord(rootDir, 'nonexistent');
      expect(result).toBe(false);
    });
  });

  // ── deleteOnCallByTeam ────────────────────────────────────────────

  describe('deleteOnCallByTeam', () => {
    it('removes all team records', async () => {
      const records = [
        makeRecord({ id: 'oc1', team: 'TeamA' }),
        makeRecord({ id: 'oc2', team: 'TeamA' }),
        makeRecord({ id: 'oc3', team: 'TeamB' }),
      ];
      let captured: OnCallRecord[] | undefined;

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([...records]) as OnCallRecord[];
      });

      const result = await deleteOnCallByTeam(rootDir, 'TeamA');

      expect(result).toBe(true);
      expect(captured!).toHaveLength(1);
      expect(captured![0].id).toBe('oc3');
    });

    it('returns false when team not found', async () => {
      mockModify.mockImplementation(async (_path, callback) => {
        callback([makeRecord({ id: 'oc1', team: 'TeamA' })]);
      });

      const result = await deleteOnCallByTeam(rootDir, 'NonExistentTeam');
      expect(result).toBe(false);
    });
  });

  // ── updateOnCallTeamJson ──────────────────────────────────────────

  describe('updateOnCallTeamJson', () => {
    it('replaces team records preserving order', async () => {
      const records = [
        makeRecord({ id: 'oc1', team: 'TeamA' }),
        makeRecord({ id: 'oc2', team: 'TeamB' }),
        makeRecord({ id: 'oc3', team: 'TeamC' }),
      ];
      let captured: OnCallRecord[] | undefined;

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([...records]) as OnCallRecord[];
      });

      const result = await updateOnCallTeamJson(rootDir, 'TeamB', [
        { role: 'Lead', name: 'NewBob', contact: 'newbob@co.com' },
      ]);

      expect(result).toBe(true);
      // TeamA should still be first, new TeamB record at position 1, TeamC last
      expect(captured!).toHaveLength(3);
      expect(captured![0].team).toBe('TeamA');
      expect(captured![1].team).toBe('TeamB');
      expect(captured![1].name).toBe('NewBob');
      expect(captured![2].team).toBe('TeamC');
    });

    it('appends to end if team did not exist', async () => {
      const records = [makeRecord({ id: 'oc1', team: 'TeamA' })];
      let captured: OnCallRecord[] | undefined;

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([...records]) as OnCallRecord[];
      });

      const result = await updateOnCallTeamJson(rootDir, 'NewTeam', [
        { role: 'Primary', name: 'Eve' },
      ]);

      expect(result).toBe(true);
      expect(captured!).toHaveLength(2);
      expect(captured![0].team).toBe('TeamA');
      expect(captured![1].team).toBe('NewTeam');
    });
  });

  // ── renameOnCallTeamJson ──────────────────────────────────────────

  describe('renameOnCallTeamJson', () => {
    it('renames team field', async () => {
      const records = [
        makeRecord({ id: 'oc1', team: 'OldName' }),
        makeRecord({ id: 'oc2', team: 'OldName' }),
        makeRecord({ id: 'oc3', team: 'Other' }),
      ];
      let captured: OnCallRecord[] | undefined;

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([...records]) as OnCallRecord[];
      });

      const result = await renameOnCallTeamJson(rootDir, 'OldName', 'NewName');

      expect(result).toBe(true);
      expect(captured![0].team).toBe('NewName');
      expect(captured![1].team).toBe('NewName');
      expect(captured![2].team).toBe('Other');
    });

    it('returns false when old name not found', async () => {
      mockModify.mockImplementation(async (_path, callback) => {
        callback([makeRecord({ id: 'oc1', team: 'TeamA' })]);
      });

      const result = await renameOnCallTeamJson(rootDir, 'NonExistent', 'NewName');
      expect(result).toBe(false);
    });
  });

  // ── reorderOnCallTeamsJson ────────────────────────────────────────

  describe('reorderOnCallTeamsJson', () => {
    it('reorders by team order', async () => {
      const records = [
        makeRecord({ id: 'a1', team: 'Alpha' }),
        makeRecord({ id: 'b1', team: 'Bravo' }),
        makeRecord({ id: 'b2', team: 'Bravo' }),
        makeRecord({ id: 'c1', team: 'Charlie' }),
      ];
      let captured: OnCallRecord[] | undefined;

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([...records]) as OnCallRecord[];
      });

      const result = await reorderOnCallTeamsJson(rootDir, ['Charlie', 'Alpha', 'Bravo']);

      expect(result).toBe(true);
      expect(captured!.map((r) => r.id)).toEqual(['c1', 'a1', 'b1', 'b2']);
    });

    it('appends teams not in order list at the end', async () => {
      const records = [
        makeRecord({ id: 'a1', team: 'Alpha' }),
        makeRecord({ id: 'b1', team: 'Bravo' }),
        makeRecord({ id: 'c1', team: 'Charlie' }),
      ];
      let captured: OnCallRecord[] | undefined;

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([...records]) as OnCallRecord[];
      });

      // Only specify Alpha; Bravo and Charlie should be appended
      await reorderOnCallTeamsJson(rootDir, ['Alpha']);

      expect(captured![0].team).toBe('Alpha');
      // Remaining teams appended in their original iteration order
      expect(captured!).toHaveLength(3);
    });
  });

  // ── saveAllOnCallJson ─────────────────────────────────────────────

  describe('saveAllOnCallJson', () => {
    it('replaces all records', async () => {
      let captured: OnCallRecord[] | undefined;

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([makeRecord()]) as OnCallRecord[];
      });

      const result = await saveAllOnCallJson(rootDir, [
        { team: 'X', role: 'Lead', name: 'Xena', contact: 'x@co.com' },
        { team: 'Y', role: 'Member', name: 'Yara', contact: 'y@co.com' },
      ]);

      expect(result).toBe(true);
      expect(captured!).toHaveLength(2);
      expect(captured![0].team).toBe('X');
      expect(captured![0].id).toBe('test-id-123');
      expect(captured![1].team).toBe('Y');
    });

    it('returns false on error', async () => {
      mockModify.mockRejectedValue(new Error('fail'));

      const result = await saveAllOnCallJson(rootDir, []);
      expect(result).toBe(false);
    });
  });
});
