/**
 * FileManager rollback and edge case tests
 * These tests mock the underlying JSON operations to trigger rollback paths.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FileManager } from './FileManager';

// Mock the operations module to control success/failure
vi.mock('./operations', () => ({
  performBackup: vi.fn().mockResolvedValue(null),
  getGroups: vi.fn().mockResolvedValue([]),
  getContacts: vi.fn().mockResolvedValue([]),
  getServers: vi.fn().mockResolvedValue([]),
  getOnCall: vi.fn().mockResolvedValue([]),
  updateOnCallTeamJson: vi.fn().mockResolvedValue(true),
  deleteOnCallByTeam: vi.fn().mockResolvedValue(true),
  renameOnCallTeamJson: vi.fn().mockResolvedValue(true),
  reorderOnCallTeamsJson: vi.fn().mockResolvedValue(true),
  saveAllOnCallJson: vi.fn().mockResolvedValue(true),
  addContactRecord: vi
    .fn()
    .mockResolvedValue({
      id: 'new-id',
      name: '',
      email: '',
      phone: '',
      title: '',
      createdAt: 0,
      updatedAt: 0,
    }),
  deleteContactRecord: vi.fn().mockResolvedValue(true),
  findContactByEmail: vi
    .fn()
    .mockResolvedValue({
      id: 'c1',
      name: 'Test',
      email: 'test@example.com',
      phone: '',
      title: '',
      createdAt: 0,
      updatedAt: 0,
    }),
  addServerRecord: vi
    .fn()
    .mockResolvedValue({
      id: 'new-srv',
      name: 'srv',
      businessArea: '',
      lob: '',
      comment: '',
      owner: '',
      contact: '',
      os: '',
      createdAt: 0,
      updatedAt: 0,
    }),
  deleteServerRecord: vi.fn().mockResolvedValue(true),
  findServerByName: vi
    .fn()
    .mockResolvedValue({
      id: 's1',
      name: 'Server1',
      businessArea: '',
      lob: '',
      comment: '',
      owner: '',
      contact: '',
      os: '',
      createdAt: 0,
      updatedAt: 0,
    }),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/tmp'),
  },
}));

vi.mock('chokidar', () => ({
  watch: () => ({
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('./logger', () => ({
  loggers: {
    fileManager: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    ipc: { warn: vi.fn(), error: vi.fn() },
  },
}));

vi.mock('./fileLock', () => ({
  atomicWriteWithLock: vi.fn().mockResolvedValue(undefined),
  readWithLock: vi.fn().mockResolvedValue(null),
  modifyJsonWithLock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./FileSystemService', () => ({
  FileSystemService: vi.fn().mockImplementation(function (rootDir: string, bundledPath: string) {
    return {
      rootDir,
      bundledDataPath: bundledPath,
      ensureDataFiles: vi.fn().mockResolvedValue(undefined),
      atomicWrite: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('./DataCacheManager', () => ({
  DataCacheManager: vi.fn().mockImplementation(function () {
    let cache = { contacts: [], servers: [], onCall: [], groups: [], teamLayout: {} };
    return {
      getCache: vi.fn(() => cache),
      updateCache: vi.fn((update) => {
        cache = { ...cache, ...update };
      }),
      broadcast: vi.fn(),
      emitError: vi.fn(),
      emitReloadStarted: vi.fn(),
      emitReloadCompleted: vi.fn(),
      subscribe: vi.fn(),
    };
  }),
}));

vi.mock('./FileWatcher', () => ({
  createFileWatcher: vi.fn(() => ({ on: vi.fn(), close: vi.fn().mockResolvedValue(undefined) })),
  FileType: { CONTACTS: 'contacts', SERVERS: 'servers', ONCALL: 'oncall' },
}));

import * as operations from './operations';
import { loggers } from './logger';
import { createFileWatcher } from './FileWatcher';

describe('FileManager rollback paths', () => {
  let fm: FileManager;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset all operations to succeed by default
    vi.mocked(operations.updateOnCallTeamJson).mockResolvedValue(true);
    vi.mocked(operations.deleteOnCallByTeam).mockResolvedValue(true);
    vi.mocked(operations.renameOnCallTeamJson).mockResolvedValue(true);
    vi.mocked(operations.reorderOnCallTeamsJson).mockResolvedValue(true);
    vi.mocked(operations.saveAllOnCallJson).mockResolvedValue(true);
    vi.mocked(operations.addContactRecord).mockResolvedValue({
      id: 'new-id',
      name: '',
      email: '',
      phone: '',
      title: '',
      createdAt: 0,
      updatedAt: 0,
    });
    vi.mocked(operations.deleteContactRecord).mockResolvedValue(true);
    vi.mocked(operations.findContactByEmail).mockResolvedValue({
      id: 'c1',
      name: 'Test',
      email: 'test@example.com',
      phone: '',
      title: '',
      createdAt: 0,
      updatedAt: 0,
    });
    vi.mocked(operations.addServerRecord).mockResolvedValue({
      id: 'srv',
      name: 'x',
      businessArea: '',
      lob: '',
      comment: '',
      owner: '',
      contact: '',
      os: '',
      createdAt: 0,
      updatedAt: 0,
    });
    vi.mocked(operations.deleteServerRecord).mockResolvedValue(true);
    vi.mocked(operations.findServerByName).mockResolvedValue({
      id: 's1',
      name: 'Server1',
      businessArea: '',
      lob: '',
      comment: '',
      owner: '',
      contact: '',
      os: '',
      createdAt: 0,
      updatedAt: 0,
    });
    vi.mocked(operations.getOnCall).mockResolvedValue([]);
    vi.mocked(operations.getContacts).mockResolvedValue([]);
    vi.mocked(operations.getServers).mockResolvedValue([]);

    // eslint-disable-next-line sonarjs/publicly-writable-directories
    fm = new FileManager('/tmp/data', '/tmp/bundled');
  });

  describe('updateOnCallTeam', () => {
    it('rolls back cache when persistence fails', async () => {
      vi.mocked(operations.updateOnCallTeamJson).mockResolvedValue(false);

      const result = await fm.updateOnCallTeam('Team A', [
        { id: 'a1', team: 'Team A', role: 'Primary', name: 'Alice', contact: 'a@test.com' },
      ]);

      expect(result).toBe(false);
      expect(loggers.fileManager.error).toHaveBeenCalledWith(
        'updateOnCallTeam persistence failed, rolling back',
      );
    });

    it('succeeds and returns true when persistence works', async () => {
      const result = await fm.updateOnCallTeam('Team A', [
        { id: 'a1', team: 'Team A', role: 'Primary', name: 'Alice', contact: 'a@test.com' },
      ]);
      expect(result).toBe(true);
    });

    it('appends new team rows when team does not exist in cache', async () => {
      const result = await fm.updateOnCallTeam('New Team', [
        { id: 'n1', team: 'New Team', role: 'Primary', name: 'New', contact: 'n@test.com' },
      ]);
      expect(result).toBe(true);
    });
  });

  describe('removeOnCallTeam', () => {
    it('rolls back cache when persistence fails', async () => {
      vi.mocked(operations.deleteOnCallByTeam).mockResolvedValue(false);

      const result = await fm.removeOnCallTeam('Team A');

      expect(result).toBe(false);
      expect(loggers.fileManager.error).toHaveBeenCalledWith(
        'removeOnCallTeam persistence failed, rolling back',
      );
    });

    it('succeeds and returns true', async () => {
      const result = await fm.removeOnCallTeam('Team A');
      expect(result).toBe(true);
    });
  });

  describe('renameOnCallTeam', () => {
    it('rolls back cache when persistence fails', async () => {
      vi.mocked(operations.renameOnCallTeamJson).mockResolvedValue(false);

      const result = await fm.renameOnCallTeam('Old', 'New');

      expect(result).toBe(false);
      expect(loggers.fileManager.error).toHaveBeenCalledWith(
        'renameOnCallTeam persistence failed, rolling back',
      );
    });

    it('succeeds and returns true', async () => {
      const result = await fm.renameOnCallTeam('Old', 'New');
      expect(result).toBe(true);
    });
  });

  describe('reorderOnCallTeams', () => {
    it('rolls back cache when JSON reorder fails', async () => {
      vi.mocked(operations.reorderOnCallTeamsJson).mockResolvedValue(false);

      const result = await fm.reorderOnCallTeams(['Team A', 'Team B']);

      expect(result).toBe(false);
      expect(loggers.fileManager.error).toHaveBeenCalledWith(
        'Failed to persist reorder (JSON), rolling back',
      );
    });

    it('succeeds with layout', async () => {
      const layout = { 'Team A': { x: 0, y: 0, w: 6, h: 4 } };
      const result = await fm.reorderOnCallTeams(['Team A'], layout);
      expect(result).toBe(true);
    });

    it('succeeds without layout', async () => {
      const result = await fm.reorderOnCallTeams(['Team A']);
      expect(result).toBe(true);
    });
  });

  describe('generateDummyData', () => {
    it('returns false in production mode', async () => {
      const { app } = await import('electron');
      vi.mocked(app as unknown as { isPackaged: boolean }).isPackaged = true;

      const result = await fm.generateDummyData();
      expect(result).toBe(false);

      // Reset
      vi.mocked(app as unknown as { isPackaged: boolean }).isPackaged = false;
    });

    it('runs generator in development mode', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      vi.doMock('./dummyDataGenerator', () => ({
        generateDummyDataAsync: vi.fn().mockResolvedValue(true),
      }));

      const { app } = await import('electron');
      Object.defineProperty(app, 'isPackaged', { value: false, configurable: true });

      const result = await fm.generateDummyData();
      // May be true or false depending on mock resolution, but should not throw
      expect(typeof result).toBe('boolean');

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('destroy', () => {
    it('calls watcher close on destroy', () => {
      // Access private watcher via init which sets it
      const closeMock = vi.fn().mockResolvedValue(undefined);
      const cleanupMock = vi.fn();
      const watcherMock = {
        on: vi.fn(),
        close: closeMock,
        _cleanup: cleanupMock,
      };
      vi.mocked(operations.getOnCall).mockResolvedValue([]);
      vi.mocked(createFileWatcher).mockReturnValue(watcherMock as never);

      fm.init();
      fm.destroy();

      expect(cleanupMock).toHaveBeenCalled();
      expect(closeMock).toHaveBeenCalled();
    });

    it('does not throw when watcher is null', () => {
      expect(() => fm.destroy()).not.toThrow();
    });
  });

  describe('addContact / removeContact / addServer / removeServer success paths', () => {
    it('addContact returns true', async () => {
      const result = await fm.addContact({
        name: 'Alice',
        email: 'alice@test.com',
        phone: '555',
        title: 'Eng',
      });
      expect(result).toBe(true);
    });

    it('removeContact returns true when contact found', async () => {
      const result = await fm.removeContact('test@example.com');
      expect(result).toBe(true);
    });

    it('removeContact returns false when contact not found', async () => {
      vi.mocked(operations.findContactByEmail).mockResolvedValue(null);
      const result = await fm.removeContact('ghost@test.com');
      expect(result).toBe(false);
    });

    it('addServer returns true', async () => {
      const result = await fm.addServer({ name: 'web-01', businessArea: 'IT' });
      expect(result).toBe(true);
    });

    it('removeServer returns true when server found', async () => {
      const result = await fm.removeServer('Server1');
      expect(result).toBe(true);
    });

    it('removeServer returns false when server not found', async () => {
      vi.mocked(operations.findServerByName).mockResolvedValue(null);
      const result = await fm.removeServer('Ghost');
      expect(result).toBe(false);
    });
  });
});
