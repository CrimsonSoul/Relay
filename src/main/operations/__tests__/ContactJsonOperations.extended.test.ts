import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../fileLock', () => ({
  readWithLock: vi.fn(),
  modifyJsonWithLock: vi.fn(),
}));

vi.mock('fs/promises');
vi.mock('fs');
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
  generateId: (prefix: string) => `${prefix}-test-id`,
}));

import { readWithLock, modifyJsonWithLock } from '../../fileLock';
import {
  getContacts,
  addContactRecord,
  updateContactRecord,
  deleteContactRecord,
  findContactByEmail,
  bulkUpsertContacts,
} from '../ContactJsonOperations';

// eslint-disable-next-line sonarjs/publicly-writable-directories
const rootDir = '/tmp/test-relay-data';

// Helper: simulate modifyJsonWithLock calling the transform
function setupModifyJsonWithLock(initialData: unknown[] = []) {
  vi.mocked(modifyJsonWithLock).mockImplementation(
    async (_path: string, transform: (data: unknown[]) => unknown[], _default: unknown[]) => {
      transform(initialData);
    },
  );
}

describe('ContactJsonOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── getContacts ─────────────────────────────────────────────────────────────
  describe('getContacts', () => {
    it('returns contacts array from valid JSON', async () => {
      const data = [{ id: 'c1', email: 'a@example.com', name: 'Alice' }];
      vi.mocked(readWithLock).mockResolvedValue(JSON.stringify(data));
      const result = await getContacts(rootDir);
      expect(result).toEqual(data);
    });

    it('returns empty array when file is empty/null', async () => {
      vi.mocked(readWithLock).mockResolvedValue('');
      const result = await getContacts(rootDir);
      expect(result).toEqual([]);
    });

    it('returns empty array when JSON is not an array', async () => {
      vi.mocked(readWithLock).mockResolvedValue(JSON.stringify({ contacts: [] }));
      const result = await getContacts(rootDir);
      expect(result).toEqual([]);
    });

    it('returns empty array on JSON parse error', async () => {
      vi.mocked(readWithLock).mockResolvedValue('{ invalid json ]]]');
      const result = await getContacts(rootDir);
      expect(result).toEqual([]);
    });

    it('throws on non-ENOENT errors (e.g. EACCES)', async () => {
      const err = Object.assign(new Error('EACCES'), { code: 'EACCES' });
      vi.mocked(readWithLock).mockRejectedValue(err);
      await expect(getContacts(rootDir)).rejects.toMatchObject({ code: 'EACCES' });
    });

    it('returns empty array on ENOENT', async () => {
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      vi.mocked(readWithLock).mockRejectedValue(err);
      const result = await getContacts(rootDir);
      expect(result).toEqual([]);
    });
  });

  // ── addContactRecord ─────────────────────────────────────────────────────────
  describe('addContactRecord', () => {
    it('adds a new contact and returns it', async () => {
      const existingContacts: {
        id: string;
        email: string;
        name: string;
        createdAt: number;
        updatedAt: number;
      }[] = [];
      setupModifyJsonWithLock(existingContacts);

      const result = await addContactRecord(rootDir, {
        name: 'Alice',
        email: 'alice@example.com',
        phone: '555-1234',
        title: 'Engineer',
      });

      expect(result).not.toBeNull();
      expect(result?.email).toBe('alice@example.com');
      expect(result?.id).toBe('contact-test-id');
    });

    it('updates existing contact when email matches (case-insensitive)', async () => {
      const now = Date.now();
      const existing = [
        {
          id: 'existing-id',
          email: 'alice@example.com',
          name: 'Old Name',
          phone: '',
          title: '',
          createdAt: now,
          updatedAt: now,
        },
      ];
      setupModifyJsonWithLock(existing);

      const result = await addContactRecord(rootDir, {
        name: 'New Name',
        email: 'ALICE@EXAMPLE.COM',
        phone: '555-9999',
        title: 'Manager',
      });

      expect(result).not.toBeNull();
      expect(result?.id).toBe('existing-id');
      expect(result?.name).toBe('New Name');
    });

    it('returns null on unexpected error', async () => {
      vi.mocked(modifyJsonWithLock).mockRejectedValue(new Error('disk full'));
      const result = await addContactRecord(rootDir, {
        name: 'Bob',
        email: 'bob@example.com',
        phone: '',
        title: '',
      });
      expect(result).toBeNull();
    });
  });

  // ── updateContactRecord ──────────────────────────────────────────────────────
  describe('updateContactRecord', () => {
    it('returns true and updates matching contact', async () => {
      const existing = [
        {
          id: 'c1',
          email: 'a@example.com',
          name: 'Alice',
          phone: '',
          title: '',
          createdAt: 1000,
          updatedAt: 1000,
        },
      ];
      setupModifyJsonWithLock(existing);

      const result = await updateContactRecord(rootDir, 'c1', { name: 'Alice Updated' });
      expect(result).toBe(true);
    });

    it('returns false when contact ID not found', async () => {
      setupModifyJsonWithLock([]);

      const result = await updateContactRecord(rootDir, 'nonexistent', { name: 'X' });
      expect(result).toBe(false);
    });

    it('returns false on unexpected error', async () => {
      vi.mocked(modifyJsonWithLock).mockRejectedValue(new Error('disk error'));
      const result = await updateContactRecord(rootDir, 'c1', { name: 'X' });
      expect(result).toBe(false);
    });
  });

  // ── deleteContactRecord ──────────────────────────────────────────────────────
  describe('deleteContactRecord', () => {
    it('returns true when contact is deleted', async () => {
      const existing = [{ id: 'c1', email: 'a@example.com', name: 'Alice' }];
      setupModifyJsonWithLock(existing);

      const result = await deleteContactRecord(rootDir, 'c1');
      expect(result).toBe(true);
    });

    it('returns false when contact ID not found', async () => {
      setupModifyJsonWithLock([{ id: 'c1', email: 'a@example.com', name: 'Alice' }]);

      const result = await deleteContactRecord(rootDir, 'nonexistent');
      expect(result).toBe(false);
    });

    it('returns false on unexpected error', async () => {
      vi.mocked(modifyJsonWithLock).mockRejectedValue(new Error('disk error'));
      const result = await deleteContactRecord(rootDir, 'c1');
      expect(result).toBe(false);
    });
  });

  // ── findContactByEmail ───────────────────────────────────────────────────────
  describe('findContactByEmail', () => {
    it('finds contact by email (case-insensitive)', async () => {
      const data = [{ id: 'c1', email: 'alice@example.com', name: 'Alice' }];
      vi.mocked(readWithLock).mockResolvedValue(JSON.stringify(data));

      const result = await findContactByEmail(rootDir, 'ALICE@EXAMPLE.COM');
      expect(result).not.toBeNull();
      expect(result?.name).toBe('Alice');
    });

    it('returns null when email not found', async () => {
      vi.mocked(readWithLock).mockResolvedValue(JSON.stringify([]));
      const result = await findContactByEmail(rootDir, 'nobody@example.com');
      expect(result).toBeNull();
    });

    it('returns null on error', async () => {
      vi.mocked(readWithLock).mockRejectedValue(new Error('read error'));
      const result = await findContactByEmail(rootDir, 'a@b.com');
      expect(result).toBeNull();
    });
  });

  // ── bulkUpsertContacts ───────────────────────────────────────────────────────
  describe('bulkUpsertContacts', () => {
    it('imports new contacts and updates existing ones', async () => {
      const now = Date.now();
      const existing = [
        {
          id: 'c1',
          email: 'existing@example.com',
          name: 'Existing',
          phone: '',
          title: '',
          createdAt: now,
          updatedAt: now,
        },
      ];
      setupModifyJsonWithLock(existing);

      const result = await bulkUpsertContacts(rootDir, [
        { name: 'New', email: 'new@example.com', phone: '', title: '' },
        { name: 'Updated', email: 'EXISTING@EXAMPLE.COM', phone: '555-1234', title: '' },
      ]);

      expect(result.imported).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('returns error in results on modifyJsonWithLock failure', async () => {
      vi.mocked(modifyJsonWithLock).mockRejectedValue(new Error('disk full'));
      const result = await bulkUpsertContacts(rootDir, [
        { name: 'A', email: 'a@example.com', phone: '', title: '' },
      ]);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Bulk upsert failed');
    });

    it('returns empty result for empty input', async () => {
      setupModifyJsonWithLock([]);
      const result = await bulkUpsertContacts(rootDir, []);
      expect(result.imported).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });
});
