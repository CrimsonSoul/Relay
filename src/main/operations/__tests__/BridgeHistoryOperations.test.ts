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
import type { BridgeHistoryEntry } from '@shared/ipc';
import {
  getBridgeHistory,
  addBridgeHistory,
  deleteBridgeHistory,
  clearBridgeHistory,
} from '../BridgeHistoryOperations';

const mockRead = vi.mocked(readWithLock);
const mockModify = vi.mocked(modifyJsonWithLock);

import os from 'node:os';
import path from 'node:path';

const rootDir = path.join(os.homedir(), 'relay-data');

function makeEntry(overrides: Partial<BridgeHistoryEntry> = {}): BridgeHistoryEntry {
  return {
    id: 'h1',
    timestamp: Date.now(),
    note: 'test note',
    groups: ['group1'],
    contacts: ['a@b.com'],
    recipientCount: 1,
    ...overrides,
  };
}

describe('BridgeHistoryOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── getBridgeHistory ──────────────────────────────────────────────

  describe('getBridgeHistory', () => {
    it('returns entries from JSON', async () => {
      const entries = [makeEntry({ id: 'h1' }), makeEntry({ id: 'h2' })];
      mockRead.mockResolvedValue(JSON.stringify(entries));

      const result = await getBridgeHistory(rootDir);
      expect(result).toEqual(entries);
    });

    it('returns empty array for ENOENT', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockRead.mockRejectedValue(error);

      const result = await getBridgeHistory(rootDir);
      expect(result).toEqual([]);
    });

    it('filters entries older than 30 days', async () => {
      const recent = makeEntry({ id: 'recent', timestamp: Date.now() });
      const old = makeEntry({
        id: 'old',
        timestamp: Date.now() - 31 * 24 * 60 * 60 * 1000,
      });
      mockRead.mockResolvedValue(JSON.stringify([recent, old]));

      const result = await getBridgeHistory(rootDir);
      expect(result).toBeDefined();
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('recent');
    });

    it('returns empty array for invalid JSON', async () => {
      mockRead.mockResolvedValue('not-valid-json{{{');

      const result = await getBridgeHistory(rootDir);
      expect(result).toEqual([]);
    });

    it('returns empty array when contents is empty string', async () => {
      mockRead.mockResolvedValue('');

      const result = await getBridgeHistory(rootDir);
      expect(result).toEqual([]);
    });

    it('returns empty array when data is not an array', async () => {
      mockRead.mockResolvedValue(JSON.stringify({ not: 'array' }));

      const result = await getBridgeHistory(rootDir);
      expect(result).toEqual([]);
    });
  });

  // ── addBridgeHistory ──────────────────────────────────────────────

  describe('addBridgeHistory', () => {
    it('prepends new entry', async () => {
      const existing = [makeEntry({ id: 'existing' })];
      let captured: BridgeHistoryEntry[] = [];

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([...existing]) as BridgeHistoryEntry[];
      });

      const result = await addBridgeHistory(rootDir, {
        note: 'new note',
        groups: ['g1'],
        contacts: ['x@y.com'],
        recipientCount: 2,
      });

      expect(result).not.toBeNull();
      expect(result!.id).toBe('test-id-123');
      expect(result!.note).toBe('new note');
      // The new entry should be first in the returned array
      expect(captured).toBeDefined();
      expect(captured[0]?.id).toBe('test-id-123');
      expect(captured[1]?.id).toBe('existing');
    });

    it('prunes old entries', async () => {
      const oldTimestamp = Date.now() - 31 * 24 * 60 * 60 * 1000;
      const oldEntry = makeEntry({ id: 'old', timestamp: oldTimestamp });
      let captured: BridgeHistoryEntry[] = [];

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([oldEntry]) as BridgeHistoryEntry[];
      });

      await addBridgeHistory(rootDir, {
        note: 'new',
        groups: [],
        contacts: [],
        recipientCount: 0,
      });

      // Old entry should be pruned, only new entry remains
      expect(captured).toHaveLength(1);
      expect(captured[0]?.id).toBe('test-id-123');
    });

    it('returns null on error', async () => {
      mockModify.mockRejectedValue(new Error('write failure'));

      const result = await addBridgeHistory(rootDir, {
        note: 'test',
        groups: [],
        contacts: [],
        recipientCount: 0,
      });

      expect(result).toBeNull();
    });
  });

  // ── deleteBridgeHistory ───────────────────────────────────────────

  describe('deleteBridgeHistory', () => {
    it('removes entry by id', async () => {
      const entries = [makeEntry({ id: 'h1' }), makeEntry({ id: 'h2' })];
      let captured: BridgeHistoryEntry[] = [];

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([...entries]) as BridgeHistoryEntry[];
      });

      const result = await deleteBridgeHistory(rootDir, 'h1');

      expect(result).toBe(true);
      expect(captured).toHaveLength(1);
      expect(captured[0]?.id).toBe('h2');
    });

    it('returns false when id not found', async () => {
      const entries = [makeEntry({ id: 'h1' })];

      mockModify.mockImplementation(async (_path, callback) => {
        callback([...entries]);
      });

      const result = await deleteBridgeHistory(rootDir, 'nonexistent');
      expect(result).toBe(false);
    });
  });

  // ── clearBridgeHistory ────────────────────────────────────────────

  describe('clearBridgeHistory', () => {
    it('empties the array', async () => {
      let captured: BridgeHistoryEntry[] | undefined;

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([makeEntry(), makeEntry()]) as BridgeHistoryEntry[];
      });

      const result = await clearBridgeHistory(rootDir);

      expect(result).toBe(true);
      expect(captured!).toEqual([]);
    });

    it('returns false on error', async () => {
      mockModify.mockRejectedValue(new Error('fail'));

      const result = await clearBridgeHistory(rootDir);
      expect(result).toBe(false);
    });
  });
});
