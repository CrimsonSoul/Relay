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
import type { ServerRecord } from '@shared/ipc';
import {
  getServers,
  addServerRecord,
  updateServerRecord,
  deleteServerRecord,
  findServerByName,
} from '../ServerJsonOperations';

const mockRead = vi.mocked(readWithLock);
const mockModify = vi.mocked(modifyJsonWithLock);

const rootDir = '/tmp/relay-data';

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

describe('ServerJsonOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── getServers ────────────────────────────────────────────────────

  describe('getServers', () => {
    it('reads and returns records', async () => {
      const servers = [makeServer({ id: 'srv1' }), makeServer({ id: 'srv2' })];
      mockRead.mockResolvedValue(JSON.stringify(servers));

      const result = await getServers(rootDir);
      expect(result).toEqual(servers);
    });

    it('returns empty array for ENOENT', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      mockRead.mockRejectedValue(error);

      const result = await getServers(rootDir);
      expect(result).toEqual([]);
    });

    it('returns empty array for invalid JSON', async () => {
      mockRead.mockResolvedValue('bad-json!!!');

      const result = await getServers(rootDir);
      expect(result).toEqual([]);
    });

    it('returns empty array when data is not an array', async () => {
      mockRead.mockResolvedValue(JSON.stringify({ not: 'array' }));

      const result = await getServers(rootDir);
      expect(result).toEqual([]);
    });
  });

  // ── addServerRecord ───────────────────────────────────────────────

  describe('addServerRecord', () => {
    it('creates new server', async () => {
      let captured: ServerRecord[] | undefined;

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([]) as ServerRecord[];
      });

      const result = await addServerRecord(rootDir, {
        name: 'new-server',
        businessArea: 'Eng',
        lob: 'Core',
        comment: 'new',
        owner: 'me',
        contact: 'me@co.com',
        os: 'Windows',
      });

      expect(result).not.toBeNull();
      expect(result!.id).toBe('test-id-123');
      expect(result!.name).toBe('new-server');
      expect(captured!).toHaveLength(1);
    });

    it('updates existing server with same name (dedup)', async () => {
      const existing = [makeServer({ id: 'srv1', name: 'Web-Server-01' })];
      let captured: ServerRecord[] | undefined;

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([...existing]) as ServerRecord[];
      });

      const result = await addServerRecord(rootDir, {
        name: 'web-server-01', // lowercase match
        businessArea: 'NewArea',
        lob: 'NewLob',
        comment: 'updated',
        owner: 'new-ops',
        contact: 'new@co.com',
        os: 'FreeBSD',
      });

      expect(result).not.toBeNull();
      // Should still have only 1 record (updated, not added)
      expect(captured!).toHaveLength(1);
      expect(captured![0].id).toBe('srv1'); // preserved original id
      expect(captured![0].businessArea).toBe('NewArea');
    });

    it('returns null on error', async () => {
      mockModify.mockRejectedValue(new Error('fail'));

      const result = await addServerRecord(rootDir, {
        name: 'x',
        businessArea: '',
        lob: '',
        comment: '',
        owner: '',
        contact: '',
        os: '',
      });

      expect(result).toBeNull();
    });
  });

  // ── updateServerRecord ────────────────────────────────────────────

  describe('updateServerRecord', () => {
    it('updates by id', async () => {
      const existing = [makeServer({ id: 'srv1', comment: 'old' })];
      let captured: ServerRecord[] | undefined;

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([...existing]) as ServerRecord[];
      });

      const result = await updateServerRecord(rootDir, 'srv1', { comment: 'new' });

      expect(result).toBe(true);
      expect(captured![0].comment).toBe('new');
    });

    it('returns false when id not found', async () => {
      mockModify.mockImplementation(async (_path, callback) => {
        callback([makeServer({ id: 'srv1' })]);
      });

      const result = await updateServerRecord(rootDir, 'nonexistent', { comment: 'x' });
      expect(result).toBe(false);
    });
  });

  // ── deleteServerRecord ────────────────────────────────────────────

  describe('deleteServerRecord', () => {
    it('removes by id', async () => {
      const servers = [makeServer({ id: 'srv1' }), makeServer({ id: 'srv2' })];
      let captured: ServerRecord[] | undefined;

      mockModify.mockImplementation(async (_path, callback) => {
        captured = callback([...servers]) as ServerRecord[];
      });

      const result = await deleteServerRecord(rootDir, 'srv1');

      expect(result).toBe(true);
      expect(captured!).toHaveLength(1);
      expect(captured![0].id).toBe('srv2');
    });

    it('returns false when id not found', async () => {
      mockModify.mockImplementation(async (_path, callback) => {
        callback([makeServer({ id: 'srv1' })]);
      });

      const result = await deleteServerRecord(rootDir, 'nonexistent');
      expect(result).toBe(false);
    });
  });

  // ── findServerByName ──────────────────────────────────────────────

  describe('findServerByName', () => {
    it('finds case-insensitive', async () => {
      const servers = [
        makeServer({ id: 'srv1', name: 'Web-Server-01' }),
        makeServer({ id: 'srv2', name: 'db-server-01' }),
      ];
      mockRead.mockResolvedValue(JSON.stringify(servers));

      const result = await findServerByName(rootDir, 'WEB-SERVER-01');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('srv1');
    });

    it('returns null when not found', async () => {
      mockRead.mockResolvedValue(JSON.stringify([makeServer({ id: 'srv1', name: 'abc' })]));

      const result = await findServerByName(rootDir, 'nonexistent');
      expect(result).toBeNull();
    });
  });
});
