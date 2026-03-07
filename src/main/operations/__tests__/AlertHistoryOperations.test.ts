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
import type { AlertHistoryEntry } from '@shared/ipc';
import {
  getAlertHistory,
  addAlertHistory,
  deleteAlertHistory,
  clearAlertHistory,
  pinAlertHistory,
  updateAlertHistoryLabel,
} from '../AlertHistoryOperations';

const mockRead = vi.mocked(readWithLock);
const mockModify = vi.mocked(modifyJsonWithLock);

import os from 'node:os';
import path from 'node:path';

const rootDir = path.join(os.homedir(), 'relay-data');

function makeEntry(overrides: Partial<AlertHistoryEntry> = {}): AlertHistoryEntry {
  return {
    id: 'h1',
    timestamp: Date.now(),
    severity: 'INFO',
    subject: 'Test Alert',
    bodyHtml: '<p>Test body</p>',
    sender: 'IT Operations',
    recipient: 'All Employees',
    ...overrides,
  };
}

describe('AlertHistoryOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── getAlertHistory ──────────────────────────────────────────────

  describe('getAlertHistory', () => {
    it('returns entries from JSON', async () => {
      const entries = [makeEntry({ id: 'h1' }), makeEntry({ id: 'h2' })];
      mockRead.mockResolvedValue(JSON.stringify(entries));

      const result = await getAlertHistory(rootDir);
      expect(result).toEqual(entries);
    });

    it('returns empty array for ENOENT', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockRead.mockRejectedValue(error);

      const result = await getAlertHistory(rootDir);
      expect(result).toEqual([]);
    });

    it('filters entries older than 90 days', async () => {
      const recent = makeEntry({ id: 'recent', timestamp: Date.now() });
      const old = makeEntry({
        id: 'old',
        timestamp: Date.now() - 91 * 24 * 60 * 60 * 1000,
      });
      mockRead.mockResolvedValue(JSON.stringify([recent, old]));

      const result = await getAlertHistory(rootDir);
      expect(result).toBeDefined();
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('recent');
    });

    it('returns empty array for invalid JSON', async () => {
      mockRead.mockResolvedValue('not-valid-json{{{');

      const result = await getAlertHistory(rootDir);
      expect(result).toEqual([]);
    });

    it('returns empty array when contents is empty string', async () => {
      mockRead.mockResolvedValue('');

      const result = await getAlertHistory(rootDir);
      expect(result).toEqual([]);
    });

    it('returns empty array when data is not an array', async () => {
      mockRead.mockResolvedValue(JSON.stringify({ not: 'array' }));

      const result = await getAlertHistory(rootDir);
      expect(result).toEqual([]);
    });
  });

  // ── addAlertHistory ──────────────────────────────────────────────

  describe('addAlertHistory', () => {
    it('prepends new entry', async () => {
      const existing = [makeEntry({ id: 'existing' })];
      let captured: AlertHistoryEntry[] = [];

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([...existing]) as AlertHistoryEntry[];
      });

      const result = await addAlertHistory(rootDir, {
        severity: 'ISSUE',
        subject: 'Outage Alert',
        bodyHtml: '<strong>Systems down</strong>',
        sender: 'NOC',
      });

      expect(result).not.toBeNull();
      expect(result!.id).toBe('test-id-123');
      expect(result!.severity).toBe('ISSUE');
      expect(result!.subject).toBe('Outage Alert');
      expect(captured).toBeDefined();
      expect(captured[0]?.id).toBe('test-id-123');
      expect(captured[1]?.id).toBe('existing');
    });

    it('prunes old entries', async () => {
      const oldTimestamp = Date.now() - 91 * 24 * 60 * 60 * 1000;
      const oldEntry = makeEntry({ id: 'old', timestamp: oldTimestamp });
      let captured: AlertHistoryEntry[] = [];

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([oldEntry]) as AlertHistoryEntry[];
      });

      await addAlertHistory(rootDir, {
        severity: 'INFO',
        subject: 'new',
        bodyHtml: '',
        sender: '',
      });

      expect(captured).toHaveLength(1);
      expect(captured[0]?.id).toBe('test-id-123');
    });

    it('trims to max 50 entries', async () => {
      const manyEntries = Array.from({ length: 55 }, (_, i) =>
        makeEntry({ id: `h${i}`, timestamp: Date.now() - i * 1000 }),
      );
      let captured: AlertHistoryEntry[] = [];

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([...manyEntries]) as AlertHistoryEntry[];
      });

      await addAlertHistory(rootDir, {
        severity: 'INFO',
        subject: 'newest',
        bodyHtml: '',
        sender: '',
      });

      // 55 existing + 1 new = 56, trimmed to 50
      expect(captured).toHaveLength(50);
      expect(captured[0]?.id).toBe('test-id-123');
    });

    it('returns null on error', async () => {
      mockModify.mockRejectedValue(new Error('write failure'));

      const result = await addAlertHistory(rootDir, {
        severity: 'INFO',
        subject: 'test',
        bodyHtml: '',
        sender: '',
      });

      expect(result).toBeNull();
    });
  });

  // ── deleteAlertHistory ───────────────────────────────────────────

  describe('deleteAlertHistory', () => {
    it('removes entry by id', async () => {
      const entries = [makeEntry({ id: 'h1' }), makeEntry({ id: 'h2' })];
      let captured: AlertHistoryEntry[] = [];

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([...entries]) as AlertHistoryEntry[];
      });

      const result = await deleteAlertHistory(rootDir, 'h1');

      expect(result).toBe(true);
      expect(captured).toHaveLength(1);
      expect(captured[0]?.id).toBe('h2');
    });

    it('returns false when id not found', async () => {
      const entries = [makeEntry({ id: 'h1' })];

      mockModify.mockImplementation(async (_path, callback) => {
        callback([...entries]);
      });

      const result = await deleteAlertHistory(rootDir, 'nonexistent');
      expect(result).toBe(false);
    });
  });

  // ── clearAlertHistory ────────────────────────────────────────────

  describe('clearAlertHistory', () => {
    it('empties the array', async () => {
      let captured: AlertHistoryEntry[] | undefined;

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([makeEntry(), makeEntry()]) as AlertHistoryEntry[];
      });

      const result = await clearAlertHistory(rootDir);

      expect(result).toBe(true);
      expect(captured!).toEqual([]);
    });

    it('returns false on error', async () => {
      mockModify.mockRejectedValue(new Error('fail'));

      const result = await clearAlertHistory(rootDir);
      expect(result).toBe(false);
    });
  });

  // ── pinAlertHistory ──────────────────────────────────────────────

  describe('pinAlertHistory', () => {
    it('pins an entry by id', async () => {
      const entries = [makeEntry({ id: 'h1' }), makeEntry({ id: 'h2' })];
      let captured: AlertHistoryEntry[] = [];

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback(entries.map((e) => ({ ...e }))) as AlertHistoryEntry[];
      });

      const result = await pinAlertHistory(rootDir, 'h1', true);

      expect(result).toBe(true);
      expect(captured.find((e) => e.id === 'h1')?.pinned).toBe(true);
    });

    it('unpins an entry and removes label', async () => {
      const entries = [makeEntry({ id: 'h1', pinned: true, label: 'My Template' })];
      let captured: AlertHistoryEntry[] = [];

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback(entries.map((e) => ({ ...e }))) as AlertHistoryEntry[];
      });

      const result = await pinAlertHistory(rootDir, 'h1', false);

      expect(result).toBe(true);
      const entry = captured.find((e) => e.id === 'h1');
      expect(entry?.pinned).toBeUndefined();
      expect(entry?.label).toBeUndefined();
    });

    it('returns false when id not found', async () => {
      mockModify.mockImplementation(async (_path, callback) => {
        callback([makeEntry({ id: 'h1' })]);
      });

      const result = await pinAlertHistory(rootDir, 'nonexistent', true);
      expect(result).toBe(false);
    });

    it('returns false on error', async () => {
      mockModify.mockRejectedValue(new Error('fail'));

      const result = await pinAlertHistory(rootDir, 'h1', true);
      expect(result).toBe(false);
    });
  });

  // ── updateAlertHistoryLabel ────────────────────────────────────

  describe('updateAlertHistoryLabel', () => {
    it('updates label on an entry', async () => {
      const entries = [makeEntry({ id: 'h1', pinned: true })];
      let captured: AlertHistoryEntry[] = [];

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback(entries.map((e) => ({ ...e }))) as AlertHistoryEntry[];
      });

      const result = await updateAlertHistoryLabel(rootDir, 'h1', 'Network Outage');

      expect(result).toBe(true);
      expect(captured.find((e) => e.id === 'h1')?.label).toBe('Network Outage');
    });

    it('clears label when empty string', async () => {
      const entries = [makeEntry({ id: 'h1', pinned: true, label: 'Old Label' })];
      let captured: AlertHistoryEntry[] = [];

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback(entries.map((e) => ({ ...e }))) as AlertHistoryEntry[];
      });

      const result = await updateAlertHistoryLabel(rootDir, 'h1', '');

      expect(result).toBe(true);
      expect(captured.find((e) => e.id === 'h1')?.label).toBeUndefined();
    });

    it('returns false when id not found', async () => {
      mockModify.mockImplementation(async (_path, callback) => {
        callback([makeEntry({ id: 'h1' })]);
      });

      const result = await updateAlertHistoryLabel(rootDir, 'nonexistent', 'Label');
      expect(result).toBe(false);
    });

    it('returns false on error', async () => {
      mockModify.mockRejectedValue(new Error('fail'));

      const result = await updateAlertHistoryLabel(rootDir, 'h1', 'Label');
      expect(result).toBe(false);
    });
  });

  // ── Pin-aware filtering and pruning ────────────────────────────

  describe('pin-aware behavior', () => {
    it('getAlertHistory preserves pinned entries older than 90 days', async () => {
      const oldPinned = makeEntry({
        id: 'old-pinned',
        timestamp: Date.now() - 91 * 24 * 60 * 60 * 1000,
        pinned: true,
        label: 'Template',
      });
      const oldUnpinned = makeEntry({
        id: 'old-unpinned',
        timestamp: Date.now() - 91 * 24 * 60 * 60 * 1000,
      });
      const recent = makeEntry({ id: 'recent', timestamp: Date.now() });

      mockRead.mockResolvedValue(JSON.stringify([oldPinned, oldUnpinned, recent]));

      const result = await getAlertHistory(rootDir);
      expect(result).toHaveLength(2);
      expect(result.map((e) => e.id)).toContain('old-pinned');
      expect(result.map((e) => e.id)).toContain('recent');
      expect(result.map((e) => e.id)).not.toContain('old-unpinned');
    });

    it('addAlertHistory does not count pinned entries toward max limit', async () => {
      const pinnedEntries = Array.from({ length: 10 }, (_, i) =>
        makeEntry({ id: `pinned-${i}`, pinned: true, timestamp: Date.now() - i * 1000 }),
      );
      const unpinnedEntries = Array.from({ length: 50 }, (_, i) =>
        makeEntry({ id: `unpinned-${i}`, timestamp: Date.now() - i * 1000 }),
      );
      let captured: AlertHistoryEntry[] = [];

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([...pinnedEntries, ...unpinnedEntries]) as AlertHistoryEntry[];
      });

      await addAlertHistory(rootDir, {
        severity: 'INFO',
        subject: 'new',
        bodyHtml: '',
        sender: '',
      });

      // 10 pinned + 50 unpinned (capped) + 1 new = 61 total, but unpinned capped to 50
      // New entry is unpinned, so: 10 pinned + 50 unpinned (including new) = 60
      const pinnedCount = captured.filter((e) => e.pinned).length;
      const unpinnedCount = captured.filter((e) => !e.pinned).length;
      expect(pinnedCount).toBe(10);
      expect(unpinnedCount).toBeLessThanOrEqual(50);
    });
  });
});
