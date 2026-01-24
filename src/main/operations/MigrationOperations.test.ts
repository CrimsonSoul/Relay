import { describe, it, expect, vi, beforeEach } from 'vitest';
import { migrateContactsCsv, migrateServersCsv, migrateGroupsCsv, needsMigration } from './MigrationOperations';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import * as backupOps from './BackupOperations';
import * as fileLock from '../fileLock';

// Mock fs and fs/promises
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
  },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}));

// Mock logger
vi.mock('../logger', () => ({
  loggers: {
    fileManager: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    },
  },
}));

// Mock withFileLock
vi.mock('../fileLock', () => ({
  withFileLock: vi.fn((path, cb) => cb()),
}));

describe('MigrationOperations', () => {
  const rootDir = '/test/root';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('needsMigration', () => {
    it('should return true if CSV exists but JSON does not', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        if (path.toString().endsWith('.csv')) return true;
        return false;
      });

      const result = await needsMigration(rootDir);
      expect(result).toBe(true);
    });

    it('should return false if neither exist', async () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const result = await needsMigration(rootDir);
      expect(result).toBe(false);
    });
  });

  describe('migrateContactsCsv', () => {
    it('should migrate contacts from CSV to JSON', async () => {
      const csvContent = 'Name,Email,Phone,Title\nJohn Doe,john@example.com,123456,Dev';
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue(csvContent);

      const result = await migrateContactsCsv(rootDir);

      expect(result.migrated).toBe(1);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('contacts.json.tmp'),
        expect.stringContaining('john@example.com'),
        'utf-8'
      );
      expect(fs.rename).toHaveBeenCalled();
    });

    it('should handle empty CSV', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue('Name,Email,Phone,Title');

      const result = await migrateContactsCsv(rootDir);
      expect(result.migrated).toBe(0);
      expect(fs.writeFile).toHaveBeenCalledWith(expect.stringContaining('contacts.json'), '[]', 'utf-8');
    });
  });

  describe('migrateServersCsv', () => {
    it('should migrate servers and handle header offset', async () => {
      const csvContent = '\n\nVM-M,Business Area,LOB,Comment,Owner,IT Contact,OS\nserver1,area1,lob1,comm,own,cont,linux';
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue(csvContent);

      const result = await migrateServersCsv(rootDir);

      expect(result.migrated).toBe(1);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('servers.json.tmp'),
        expect.stringContaining('server1'),
        'utf-8'
      );
    });
  });

  describe('migrateGroupsCsv', () => {
    it('should migrate column-based groups', async () => {
      const csvContent = 'Eng,Sales\na@e.c,s@e.c\nb@e.c,';
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(fs.readFile).mockResolvedValue(csvContent);

      const result = await migrateGroupsCsv(rootDir);

      expect(result.migrated).toBe(2); // Eng and Sales
      const writtenData = JSON.parse(vi.mocked(fs.writeFile).mock.calls[0][1] as string);
      const eng = writtenData.find((g: any) => g.name === 'Eng');
      expect(eng.contacts).toContain('a@e.c');
      expect(eng.contacts).toContain('b@e.c');
    });
  });
});
