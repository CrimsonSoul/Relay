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

import { readWithLock, modifyJsonWithLock } from '../../fileLock';
import type { NotesData } from '@shared/ipc';
import { getNotes, setContactNote, setServerNote } from '../NotesOperations';

const mockRead = vi.mocked(readWithLock);
const mockModify = vi.mocked(modifyJsonWithLock);

import os from 'node:os';
import path from 'node:path';

const rootDir = path.join(os.homedir(), 'relay-data');

const emptyNotes: NotesData = { contacts: {}, servers: {} };

describe('NotesOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── getNotes ──────────────────────────────────────────────────────

  describe('getNotes', () => {
    it('returns default structure when file does not exist', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockRead.mockRejectedValue(error);

      const result = await getNotes(rootDir);
      expect(result).toEqual(emptyNotes);
    });

    it('reads existing notes', async () => {
      const data: NotesData = {
        contacts: {
          'alice@co.com': { note: 'VIP', tags: ['important'], updatedAt: 1000 },
        },
        servers: {
          'web-01': { note: 'prod', tags: ['production'], updatedAt: 2000 },
        },
      };
      mockRead.mockResolvedValue(JSON.stringify(data));

      const result = await getNotes(rootDir);
      expect(result).toEqual(data);
    });

    it('returns default structure for empty contents', async () => {
      mockRead.mockResolvedValue('');

      const result = await getNotes(rootDir);
      expect(result).toEqual(emptyNotes);
    });

    it('returns default structure for invalid JSON', async () => {
      mockRead.mockResolvedValue('not-json{{{');

      const result = await getNotes(rootDir);
      expect(result).toEqual(emptyNotes);
    });

    it('fills in missing contacts/servers keys', async () => {
      mockRead.mockResolvedValue(
        JSON.stringify({ contacts: { 'a@b.com': { note: 'hi', tags: [], updatedAt: 1 } } }),
      );

      const result = await getNotes(rootDir);
      expect(result.contacts).toEqual({ 'a@b.com': { note: 'hi', tags: [], updatedAt: 1 } });
      expect(result.servers).toEqual({});
    });
  });

  // ── setContactNote ────────────────────────────────────────────────

  describe('setContactNote', () => {
    it('adds note and tags', async () => {
      let captured: NotesData = { contacts: {}, servers: {} };

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback({ contacts: {}, servers: {} }) as NotesData;
      });

      const result = await setContactNote(rootDir, 'Alice@Co.com', 'VIP client', ['important']);

      expect(result).toBe(true);
      // Key should be lowercased
      expect(captured.contacts['alice@co.com']).toBeDefined();
      expect(captured.contacts['alice@co.com']?.note).toBe('VIP client');
      expect(captured.contacts['alice@co.com']?.tags).toEqual(['important']);
    });

    it('removes entry when both note and tags are empty', async () => {
      let captured: NotesData = { contacts: {}, servers: {} };

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback({
          contacts: {
            'alice@co.com': { note: 'old', tags: ['tag'], updatedAt: 1000 },
          },
          servers: {},
        }) as NotesData;
      });

      const result = await setContactNote(rootDir, 'alice@co.com', '', []);

      expect(result).toBe(true);
      expect(captured.contacts['alice@co.com']).toBeUndefined();
    });

    it('returns false on error', async () => {
      mockModify.mockRejectedValue(new Error('fail'));

      const result = await setContactNote(rootDir, 'a@b.com', 'note', []);
      expect(result).toBe(false);
    });
  });

  // ── setServerNote ─────────────────────────────────────────────────

  describe('setServerNote', () => {
    it('adds note and tags for server', async () => {
      let captured: NotesData = { contacts: {}, servers: {} };

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback({ contacts: {}, servers: {} }) as NotesData;
      });

      const result = await setServerNote(rootDir, 'Web-01', 'production', ['prod']);

      expect(result).toBe(true);
      expect(captured.servers['web-01']).toBeDefined();
      expect(captured.servers['web-01']?.note).toBe('production');
      expect(captured.servers['web-01']?.tags).toEqual(['prod']);
    });

    it('removes entry when both note and tags are empty', async () => {
      let captured: NotesData = { contacts: {}, servers: {} };

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback({
          contacts: {},
          servers: {
            'web-01': { note: 'old', tags: ['tag'], updatedAt: 1000 },
          },
        }) as NotesData;
      });

      const result = await setServerNote(rootDir, 'web-01', '', []);

      expect(result).toBe(true);
      expect(captured.servers['web-01']).toBeUndefined();
    });

    it('ensures structure when notes object is missing keys', async () => {
      let captured: NotesData = { contacts: {}, servers: {} };

      mockModify.mockImplementation(async (_path, callback) => {
        // Simulate data with missing keys
        captured = callback({
          contacts: undefined,
          servers: undefined,
        } as unknown as NotesData) as NotesData;
      });

      const result = await setServerNote(rootDir, 'db-01', 'staging', ['stg']);

      expect(result).toBe(true);
      expect(captured.servers['db-01']?.note).toBe('staging');
    });
  });
});
