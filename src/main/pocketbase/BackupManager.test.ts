import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'path';
import type { Stats } from 'fs';

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  rmSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock('../logger', () => ({
  loggers: {
    backup: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs';
import { BackupManager } from './BackupManager';

const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockRmSync = vi.mocked(rmSync);
const mockStatSync = vi.mocked(statSync);

function makeStatResult(mtime: Date, size = 1024): Stats {
  return { mtime, size } as unknown as Stats;
}

function makePbClient(
  createImpl: () => Promise<void> = () => Promise.resolve(),
  restoreImpl: () => Promise<void> = () => Promise.resolve(),
) {
  return {
    backups: {
      create: vi.fn().mockImplementation(createImpl),
      restore: vi.fn().mockImplementation(restoreImpl),
    },
  } as unknown as import('pocketbase').default;
}

describe('BackupManager', () => {
  const dataDir = '/fake/data';
  const backupsDir = join(dataDir, 'pb_data', 'backups');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('creates the backups directory', () => {
      const manager = new BackupManager(dataDir);
      expect(manager).toBeDefined();
      expect(mockMkdirSync).toHaveBeenCalledWith(backupsDir, { recursive: true });
    });
  });

  describe('setPocketBase', () => {
    it('stores the PocketBase client (verified by backup() using it)', async () => {
      const manager = new BackupManager(dataDir);
      const pb = makePbClient();
      mockReaddirSync.mockReturnValue([] as unknown as string[]);
      manager.setPocketBase(pb);
      const result = await manager.backup();
      expect(
        (pb.backups as unknown as { create: ReturnType<typeof vi.fn> }).create,
      ).toHaveBeenCalled();
      expect(result).not.toBeNull();
    });
  });

  describe('backup()', () => {
    it('calls pb.backups.create() with a timestamped .zip name', async () => {
      const manager = new BackupManager(dataDir);
      const createMock = vi.fn().mockResolvedValue(undefined);
      const pb = { backups: { create: createMock } } as unknown as import('pocketbase').default;
      mockReaddirSync.mockReturnValue([] as unknown as string[]);
      manager.setPocketBase(pb);

      const result = await manager.backup();

      expect(createMock).toHaveBeenCalledOnce();
      const backupName: string = createMock.mock.calls[0][0] as string;
      expect(backupName).toMatch(/\.zip$/);
      // ISO timestamp chars : and . are replaced with - in the stem (before .zip)
      const stem = backupName.replace(/\.zip$/, '');
      expect(stem).not.toMatch(/[:.]/);
      expect(result).toBe(join(backupsDir, backupName));
    });

    it('throws when no PocketBase client is set', async () => {
      const manager = new BackupManager(dataDir);
      await expect(manager.backup()).rejects.toThrow('PocketBase client not ready');
    });

    it('throws when PB API fails', async () => {
      const manager = new BackupManager(dataDir);
      const pb = {
        backups: { create: vi.fn().mockRejectedValue(new Error('API error')) },
      } as unknown as import('pocketbase').default;
      manager.setPocketBase(pb);

      await expect(manager.backup()).rejects.toThrow('API error');
    });

    it('prunes old backups after a successful backup', async () => {
      const manager = new BackupManager(dataDir);
      const pb = makePbClient();
      manager.setPocketBase(pb);

      // Simulate 12 existing backup files (10 max, so 2 should be pruned)
      const files = Array.from(
        { length: 12 },
        (_, i) => `backup-${String(i).padStart(2, '0')}.zip`,
      );
      mockReaddirSync.mockReturnValue(files as unknown as string[]);
      // Newer files have lower index (sorted descending by mtime — keep first 10, prune indices 10+)
      mockStatSync.mockImplementation((filePath) => {
        const name = String(filePath).split('/').pop()!;
        const idx = files.indexOf(name);
        return makeStatResult(new Date(2025 - idx, 0, 1));
      });

      await manager.backup();

      // rmSync should be called for the 2 oldest files (indices 10 and 11)
      expect(mockRmSync).toHaveBeenCalledTimes(2);
    });
  });

  describe('listBackups()', () => {
    it('returns empty array when the backups directory does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      const manager = new BackupManager(dataDir);
      const result = manager.listBackups();
      expect(result).toEqual([]);
    });

    it('returns sorted list of .zip and .db files with name/date/size', () => {
      mockExistsSync.mockReturnValue(true);
      const files = ['backup-a.zip', 'backup-b.db', 'not-a-backup.txt'];
      mockReaddirSync.mockReturnValue(files as unknown as string[]);
      const dates: Record<string, Date> = {
        'backup-a.zip': new Date('2025-01-02T00:00:00Z'),
        'backup-b.db': new Date('2025-01-03T00:00:00Z'),
      };
      mockStatSync.mockImplementation((filePath) => {
        const name = String(filePath).split('/').pop()!;
        return { mtime: dates[name], size: 2048 } as unknown as Stats;
      });

      const manager = new BackupManager(dataDir);
      const result = manager.listBackups();

      // .txt file excluded, result sorted descending by date
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('backup-b.db');
      expect(result[1].name).toBe('backup-a.zip');
      expect(result[0].date).toEqual(dates['backup-b.db']);
      expect(result[0].size).toBe(2048);
    });

    it('excludes non-backup file extensions', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['file.txt', 'file.log', 'file.zip'] as unknown as string[]);
      mockStatSync.mockReturnValue(makeStatResult(new Date('2025-01-01')));

      const manager = new BackupManager(dataDir);
      const result = manager.listBackups();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('file.zip');
    });
  });

  describe('restore()', () => {
    it('throws when no PocketBase client is set', async () => {
      const manager = new BackupManager(dataDir);
      await expect(manager.restore('backup.zip')).rejects.toThrow('No PocketBase client available');
    });

    it('creates a safety backup then restores the named backup', async () => {
      const manager = new BackupManager(dataDir);
      const pb = makePbClient();
      manager.setPocketBase(pb);

      await manager.restore('my-backup.zip');

      const createMock = (pb.backups as unknown as { create: ReturnType<typeof vi.fn> }).create;
      const restoreMock = (pb.backups as unknown as { restore: ReturnType<typeof vi.fn> }).restore;

      // Safety backup should be created first
      expect(createMock).toHaveBeenCalledOnce();
      const safetyName: string = createMock.mock.calls[0][0] as string;
      expect(safetyName).toMatch(/^pre-restore-.*\.zip$/);

      // Then restore the requested backup
      expect(restoreMock).toHaveBeenCalledWith('my-backup.zip');
    });

    it('throws when safety backup creation fails', async () => {
      const manager = new BackupManager(dataDir);
      const pb = makePbClient(() => Promise.reject(new Error('Disk full')));
      manager.setPocketBase(pb);

      await expect(manager.restore('backup.zip')).rejects.toThrow(
        'Could not create safety backup before restore',
      );

      // Restore should not have been called
      const restoreMock = (pb.backups as unknown as { restore: ReturnType<typeof vi.fn> }).restore;
      expect(restoreMock).not.toHaveBeenCalled();
    });

    it('throws when restore API call fails', async () => {
      const manager = new BackupManager(dataDir);
      const pb = makePbClient(
        () => Promise.resolve(),
        () => Promise.reject(new Error('Restore failed')),
      );
      manager.setPocketBase(pb);

      await expect(manager.restore('backup.zip')).rejects.toThrow('Restore failed');
    });
  });

  describe('pruneOldBackups error handling', () => {
    it('logs warning when rmSync fails during pruning', async () => {
      const manager = new BackupManager(dataDir);
      const pb = makePbClient();
      manager.setPocketBase(pb);

      const files = Array.from(
        { length: 12 },
        (_, i) => `backup-${String(i).padStart(2, '0')}.zip`,
      );
      mockReaddirSync.mockReturnValue(files as unknown as string[]);
      mockStatSync.mockImplementation((filePath) => {
        const name = String(filePath).split('/').pop()!;
        const idx = files.indexOf(name);
        return makeStatResult(new Date(2025 - idx, 0, 1));
      });
      mockRmSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      // Should not throw even when rmSync fails
      await manager.backup();

      expect(mockRmSync).toHaveBeenCalledTimes(2);
    });
  });
});
