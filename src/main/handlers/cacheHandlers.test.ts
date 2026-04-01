import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { setupCacheHandlers } from './cacheHandlers';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('../logger', () => ({
  loggers: {
    cache: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    sync: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  },
}));

describe('cacheHandlers', () => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};

  const mockCache = {
    readCollection: vi.fn(),
    updateRecord: vi.fn(),
    writeCollection: vi.fn(),
    clear: vi.fn(),
  };

  const mockPending = {
    getAll: vi.fn(),
    clear: vi.fn(),
    remove: vi.fn(),
  };

  const mockSync = {
    isAuthenticated: vi.fn(),
    reauthenticate: vi.fn(),
    syncAll: vi.fn(),
  };

  const mockAppConfig = {
    load: vi.fn(),
  };

  const getCache = vi.fn(() => mockCache as never);
  const getPendingChanges = vi.fn(() => mockPending as never);
  const getSyncManager = vi.fn(() => mockSync as never);
  const getAppConfig = vi.fn(() => mockAppConfig as never);

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(ipcMain.handle).mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers[channel] = handler;
        return ipcMain;
      },
    );

    setupCacheHandlers(getCache, getPendingChanges, getSyncManager, getAppConfig);
  });

  describe('CACHE_READ', () => {
    it('returns data for a valid collection', () => {
      const mockData = [{ id: '1', name: 'Test' }];
      mockCache.readCollection.mockReturnValue(mockData);

      const result = handlers[IPC_CHANNELS.CACHE_READ]({}, 'contacts');

      expect(mockCache.readCollection).toHaveBeenCalledWith('contacts');
      expect(result).toEqual(mockData);
    });

    it('returns empty array for invalid collection', () => {
      const result = handlers[IPC_CHANNELS.CACHE_READ]({}, 'invalidCollection');

      expect(mockCache.readCollection).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('returns empty array for non-string collection', () => {
      const result = handlers[IPC_CHANNELS.CACHE_READ]({}, 42);

      expect(mockCache.readCollection).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('returns empty array when cache is null', () => {
      getCache.mockReturnValueOnce(null as never);

      const result = handlers[IPC_CHANNELS.CACHE_READ]({}, 'contacts');

      expect(result).toEqual([]);
    });

    it('accepts all valid collection names', () => {
      const validCollections = [
        'contacts',
        'servers',
        'oncall',
        'bridge_groups',
        'bridge_history',
        'alert_history',
        'notes',
        'saved_locations',
        'standalone_notes',
        'oncall_dismissals',
        'conflict_log',
        'oncall_board_settings',
      ];
      for (const collection of validCollections) {
        mockCache.readCollection.mockReturnValue([]);
        handlers[IPC_CHANNELS.CACHE_READ]({}, collection);
        expect(mockCache.readCollection).toHaveBeenCalledWith(collection);
      }
    });
  });

  describe('CACHE_WRITE', () => {
    it('updates record for valid inputs', () => {
      const record = { id: '1', name: 'Test' };
      handlers[IPC_CHANNELS.CACHE_WRITE]({}, 'contacts', 'create', record);

      expect(mockCache.updateRecord).toHaveBeenCalledWith('contacts', 'create', record);
    });

    it('accepts all valid actions', () => {
      for (const action of ['create', 'update', 'delete']) {
        const record = { id: '1' };
        handlers[IPC_CHANNELS.CACHE_WRITE]({}, 'contacts', action, record);
        expect(mockCache.updateRecord).toHaveBeenCalledWith('contacts', action, record);
      }
    });

    it('returns early for invalid collection', () => {
      handlers[IPC_CHANNELS.CACHE_WRITE]({}, 'bogus', 'create', { id: '1' });
      expect(mockCache.updateRecord).not.toHaveBeenCalled();
    });

    it('returns early for non-string collection', () => {
      handlers[IPC_CHANNELS.CACHE_WRITE]({}, 123, 'create', { id: '1' });
      expect(mockCache.updateRecord).not.toHaveBeenCalled();
    });

    it('returns early for invalid action', () => {
      handlers[IPC_CHANNELS.CACHE_WRITE]({}, 'contacts', 'upsert', { id: '1' });
      expect(mockCache.updateRecord).not.toHaveBeenCalled();
    });

    it('returns early for non-string action', () => {
      handlers[IPC_CHANNELS.CACHE_WRITE]({}, 'contacts', 99, { id: '1' });
      expect(mockCache.updateRecord).not.toHaveBeenCalled();
    });

    it('returns early for null record', () => {
      handlers[IPC_CHANNELS.CACHE_WRITE]({}, 'contacts', 'create', null);
      expect(mockCache.updateRecord).not.toHaveBeenCalled();
    });

    it('returns early for non-object record', () => {
      handlers[IPC_CHANNELS.CACHE_WRITE]({}, 'contacts', 'create', 'string');
      expect(mockCache.updateRecord).not.toHaveBeenCalled();
    });

    it('returns early for array record', () => {
      handlers[IPC_CHANNELS.CACHE_WRITE]({}, 'contacts', 'create', [1, 2, 3]);
      expect(mockCache.updateRecord).not.toHaveBeenCalled();
    });

    it('returns early when cache is null', () => {
      getCache.mockReturnValueOnce(null as never);
      handlers[IPC_CHANNELS.CACHE_WRITE]({}, 'contacts', 'create', { id: '1' });
      expect(mockCache.updateRecord).not.toHaveBeenCalled();
    });
  });

  describe('CACHE_SNAPSHOT', () => {
    it('writes collection for valid inputs', () => {
      const records = [{ id: '1' }, { id: '2' }];
      handlers[IPC_CHANNELS.CACHE_SNAPSHOT]({}, 'contacts', records);

      expect(mockCache.writeCollection).toHaveBeenCalledWith('contacts', records);
    });

    it('returns early for invalid collection', () => {
      handlers[IPC_CHANNELS.CACHE_SNAPSHOT]({}, 'invalid', []);
      expect(mockCache.writeCollection).not.toHaveBeenCalled();
    });

    it('returns early for non-string collection', () => {
      handlers[IPC_CHANNELS.CACHE_SNAPSHOT]({}, 42, []);
      expect(mockCache.writeCollection).not.toHaveBeenCalled();
    });

    it('returns early when records is not an array', () => {
      handlers[IPC_CHANNELS.CACHE_SNAPSHOT]({}, 'contacts', 'not-an-array');
      expect(mockCache.writeCollection).not.toHaveBeenCalled();
    });

    it('returns early when records is an object', () => {
      handlers[IPC_CHANNELS.CACHE_SNAPSHOT]({}, 'contacts', { id: '1' });
      expect(mockCache.writeCollection).not.toHaveBeenCalled();
    });

    it('returns early when records is null', () => {
      handlers[IPC_CHANNELS.CACHE_SNAPSHOT]({}, 'contacts', null);
      expect(mockCache.writeCollection).not.toHaveBeenCalled();
    });

    it('returns early when cache is null', () => {
      getCache.mockReturnValueOnce(null as never);
      handlers[IPC_CHANNELS.CACHE_SNAPSHOT]({}, 'contacts', [{ id: '1' }]);
      expect(mockCache.writeCollection).not.toHaveBeenCalled();
    });
  });

  describe('SYNC_PENDING', () => {
    it('returns zero counts when pendingChanges is null', async () => {
      getPendingChanges.mockReturnValueOnce(null as never);
      const result = await handlers[IPC_CHANNELS.SYNC_PENDING]();
      expect(result).toEqual({ total: 0, conflicts: 0, errors: [] });
    });

    it('returns zero counts when syncManager is null', async () => {
      getSyncManager.mockReturnValueOnce(null as never);
      const result = await handlers[IPC_CHANNELS.SYNC_PENDING]();
      expect(result).toEqual({ total: 0, conflicts: 0, errors: [] });
    });

    it('returns zero counts when there are no pending changes', async () => {
      mockPending.getAll.mockReturnValue([]);
      const result = await handlers[IPC_CHANNELS.SYNC_PENDING]();
      expect(result).toEqual({ total: 0, conflicts: 0, errors: [] });
    });

    it('syncs all changes and clears pending on full success', async () => {
      const changes = [{ id: '1' }, { id: '2' }];
      mockPending.getAll.mockReturnValue(changes);
      mockSync.isAuthenticated.mockReturnValue(true);
      mockSync.syncAll.mockResolvedValue({
        total: 2,
        conflicts: 0,
        errors: [],
        failed: [],
      });

      const result = await handlers[IPC_CHANNELS.SYNC_PENDING]();

      expect(mockSync.syncAll).toHaveBeenCalledWith(changes);
      expect(mockPending.clear).toHaveBeenCalled();
      expect(result).toEqual({ total: 2, conflicts: 0, errors: [], failed: [] });
    });

    it('removes only successful changes on partial failure', async () => {
      const changes = [{ id: '1' }, { id: '2' }, { id: '3' }];
      mockPending.getAll.mockReturnValue(changes);
      mockSync.isAuthenticated.mockReturnValue(true);
      mockSync.syncAll.mockResolvedValue({
        total: 3,
        conflicts: 0,
        errors: ['one error'],
        failed: [{ changeId: '2' }],
      });

      await handlers[IPC_CHANNELS.SYNC_PENDING]();

      expect(mockPending.clear).not.toHaveBeenCalled();
      expect(mockPending.remove).toHaveBeenCalledWith('1');
      expect(mockPending.remove).not.toHaveBeenCalledWith('2');
      expect(mockPending.remove).toHaveBeenCalledWith('3');
    });

    it('re-authenticates when token has expired and succeeds', async () => {
      const changes = [{ id: '1' }];
      mockPending.getAll.mockReturnValue(changes);
      mockSync.isAuthenticated.mockReturnValue(false);
      mockAppConfig.load.mockReturnValue({ secret: 'mysecret123' });
      mockSync.reauthenticate.mockResolvedValue(undefined);
      mockSync.syncAll.mockResolvedValue({ total: 1, conflicts: 0, errors: [], failed: [] });

      await handlers[IPC_CHANNELS.SYNC_PENDING]();

      expect(mockSync.reauthenticate).toHaveBeenCalledWith('relay@relay.app', 'mysecret123');
      expect(mockSync.syncAll).toHaveBeenCalledWith(changes);
    });

    it('returns error result when re-authentication fails', async () => {
      const changes = [{ id: '1' }, { id: '2' }];
      mockPending.getAll.mockReturnValue(changes);
      mockSync.isAuthenticated.mockReturnValue(false);
      mockAppConfig.load.mockReturnValue({ secret: 'mysecret123' });
      mockSync.reauthenticate.mockRejectedValue(new Error('auth failed'));

      const result = await handlers[IPC_CHANNELS.SYNC_PENDING]();

      expect(result).toEqual({ total: 2, conflicts: 0, errors: ['Re-authentication failed'] });
      expect(mockSync.syncAll).not.toHaveBeenCalled();
    });

    it('skips re-auth when config has no secret', async () => {
      const changes = [{ id: '1' }];
      mockPending.getAll.mockReturnValue(changes);
      mockSync.isAuthenticated.mockReturnValue(false);
      mockAppConfig.load.mockReturnValue({});
      mockSync.syncAll.mockResolvedValue({ total: 1, conflicts: 0, errors: [], failed: [] });

      await handlers[IPC_CHANNELS.SYNC_PENDING]();

      expect(mockSync.reauthenticate).not.toHaveBeenCalled();
      expect(mockSync.syncAll).toHaveBeenCalled();
    });

    it('skips re-auth when appConfig is null', async () => {
      getAppConfig.mockReturnValueOnce(null as never);
      const changes = [{ id: '1' }];
      mockPending.getAll.mockReturnValue(changes);
      mockSync.isAuthenticated.mockReturnValue(false);
      mockSync.syncAll.mockResolvedValue({ total: 1, conflicts: 0, errors: [], failed: [] });

      await handlers[IPC_CHANNELS.SYNC_PENDING]();

      expect(mockSync.reauthenticate).not.toHaveBeenCalled();
      expect(mockSync.syncAll).toHaveBeenCalled();
    });

    it('handles getPendingChanges and getSyncManager not provided', async () => {
      vi.clearAllMocks();
      vi.mocked(ipcMain.handle).mockImplementation(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers[channel] = handler;
          return ipcMain;
        },
      );

      setupCacheHandlers(getCache); // no optional params

      const result = await handlers[IPC_CHANNELS.SYNC_PENDING]();
      expect(result).toEqual({ total: 0, conflicts: 0, errors: [] });
    });
  });
});
