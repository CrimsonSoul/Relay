import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { OFFLINE_WRITABLE_COLLECTIONS } from '@shared/offlineCollections';
import { setupCacheHandlers } from './cacheHandlers';
import { loggers } from '../logger';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('../logger', () => ({
  loggers: {
    cache: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    sync: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  },
}));

// Trusted-sender guard: unit-tested in ../utils/trustedSender.test.ts and
// exercised for real (positive + negative) in authHandlers.test.ts.
// Here it is mocked to pass so each handler's own behavior is what's tested.
vi.mock('../utils/trustedSender', () => ({
  assertTrustedIpcSender: () => true,
  isTrustedIpcSender: () => true,
}));

describe('cacheHandlers', () => {
  const SECRET_FIELD = 'secret';
  const createFixturePassphrase = () => ['fixture', 'passphrase', '123'].join('-');
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const getHandler = (channel: string): ((...args: unknown[]) => unknown) => {
    const handler = handlers[channel];
    if (!handler) throw new Error(`No handler registered for ${channel}`);
    return handler;
  };

  const mockCache = {
    readCollection: vi.fn(),
    readQueryMembership: vi.fn(),
    updateRecord: vi.fn(),
    writeCollection: vi.fn(),
    writeQueryMembership: vi.fn(),
    getUsableCacheMarker: vi.fn(),
    setUsableCacheMarker: vi.fn(),
    clear: vi.fn(),
  };

  const mockPending = {
    getAll: vi.fn(),
    clear: vi.fn(),
    remove: vi.fn(),
    count: vi.fn(() => 0),
    markFailure: vi.fn(),
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

    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers[channel] = (...args: unknown[]) => Reflect.apply(handler, undefined, args);
      return ipcMain;
    });

    setupCacheHandlers(getCache, getPendingChanges, getSyncManager, getAppConfig);
  });

  describe('CACHE_READ', () => {
    it('returns data for a valid collection', () => {
      const mockData = [{ id: '1', name: 'Test' }];
      mockCache.readCollection.mockReturnValue(mockData);

      const result = getHandler(IPC_CHANNELS.CACHE_READ)({}, 'contacts');

      expect(mockCache.readCollection).toHaveBeenCalledWith('contacts');
      expect(result).toEqual(mockData);
    });

    it.each([
      ['shared', 'cloud_status_snapshot', 'snapshot'],
      ['Mist', 'cloud_status_mist_snapshot', 'mist-snapshot'],
      ['extension', 'cloud_status_extension_snapshot', 'extension-snapshot'],
    ])('reads the %s cloud status snapshot for offline clients', (_label, collection, id) => {
      const snapshot = [{ id, key: 'current' }];
      mockCache.readCollection.mockReturnValue(snapshot);

      const result = getHandler(IPC_CHANNELS.CACHE_READ)({}, collection);

      expect(mockCache.readCollection).toHaveBeenCalledWith(collection);
      expect(result).toEqual(snapshot);
    });

    it('does not expose the retired roster cache', () => {
      const retiredCollection = ['relay', 'operators'].join('_');

      expect(getHandler(IPC_CHANNELS.CACHE_READ)({}, retiredCollection)).toEqual([]);
      expect(mockCache.readCollection).not.toHaveBeenCalled();
    });

    it('reads knowledge metadata for offline clients', () => {
      const documents = [
        { id: 'document123', title: 'Runbook', lifecycleState: 'active' },
        { id: 'trashed123', title: 'Old Runbook', lifecycleState: 'trashed' },
      ];
      mockCache.readCollection.mockReturnValue(documents);

      const result = getHandler(IPC_CHANNELS.CACHE_READ)({}, 'knowledge_documents');

      expect(mockCache.readCollection).toHaveBeenCalledWith('knowledge_documents');
      expect(result).toEqual([documents[0]]);
    });

    it('reads category metadata for offline clients', () => {
      const categories = [{ id: 'category1', name: 'Operations', sortOrder: 100 }];
      mockCache.readCollection.mockReturnValue(categories);

      const result = getHandler(IPC_CHANNELS.CACHE_READ)({}, 'knowledge_categories');

      expect(mockCache.readCollection).toHaveBeenCalledWith('knowledge_categories');
      expect(result).toEqual(categories);
    });

    it.each([
      'knowledge_uploads',
      'knowledge_audit_events',
      'knowledge_library_state',
      'relay_privileged_commands',
    ])('does not expose protected management collection %s', (collection) => {
      expect(getHandler(IPC_CHANNELS.CACHE_READ)({}, collection)).toEqual([]);
      expect(mockCache.readCollection).not.toHaveBeenCalled();
    });

    it('returns empty array for invalid collection', () => {
      const result = getHandler(IPC_CHANNELS.CACHE_READ)({}, 'invalidCollection');

      expect(mockCache.readCollection).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('does not expose archived standalone notes through the cache', () => {
      const result = getHandler(IPC_CHANNELS.CACHE_READ)({}, 'standalone_notes');

      expect(result).toEqual([]);
      expect(mockCache.readCollection).not.toHaveBeenCalled();
    });

    it('returns empty array for non-string collection', () => {
      const result = getHandler(IPC_CHANNELS.CACHE_READ)({}, 42);

      expect(mockCache.readCollection).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('returns empty array when cache is null', () => {
      getCache.mockReturnValueOnce(null as never);

      const result = getHandler(IPC_CHANNELS.CACHE_READ)({}, 'contacts');

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
        'alert_reminders',
        'notes',
        'oncall_dismissals',
        'conflict_log',
        'oncall_board_settings',
      ];
      for (const collection of validCollections) {
        mockCache.readCollection.mockReturnValue([]);
        getHandler(IPC_CHANNELS.CACHE_READ)({}, collection);
        expect(mockCache.readCollection).toHaveBeenCalledWith(collection);
      }
    });
  });

  describe('query cache membership', () => {
    it('reads membership for a valid cached query', () => {
      const membership = {
        recordIds: ['first', 'second'],
        totalItems: 10,
        complete: false,
      };
      mockCache.readQueryMembership.mockReturnValue(membership);

      const result = getHandler(IPC_CHANNELS.CACHE_QUERY_READ)(
        {},
        'dynatrace_problems',
        '0123456789abcdef',
      );

      expect(result).toEqual(membership);
      expect(mockCache.readQueryMembership).toHaveBeenCalledWith(
        'dynatrace_problems',
        '0123456789abcdef',
      );
    });

    it('writes membership for a valid cached query', () => {
      const membership = {
        recordIds: ['first', 'second'],
        totalItems: 10,
        complete: false,
      };
      getHandler(IPC_CHANNELS.CACHE_QUERY_SNAPSHOT)(
        {},
        'dynatrace_problems',
        '0123456789abcdef',
        membership,
      );

      expect(mockCache.writeQueryMembership).toHaveBeenCalledWith(
        'dynatrace_problems',
        '0123456789abcdef',
        membership,
      );
    });

    it('rejects invalid query identities and memberships', () => {
      getHandler(IPC_CHANNELS.CACHE_QUERY_READ)({}, 'contacts', 'not-a-query-key');
      getHandler(IPC_CHANNELS.CACHE_QUERY_SNAPSHOT)({}, 'invalid', '0123456789abcdef', {
        recordIds: ['first'],
        totalItems: 1,
        complete: true,
      });
      getHandler(IPC_CHANNELS.CACHE_QUERY_SNAPSHOT)({}, 'contacts', '0123456789abcdef', {
        recordIds: ['', 'second'],
        totalItems: 2,
        complete: true,
      });

      expect(mockCache.readQueryMembership).not.toHaveBeenCalled();
      expect(mockCache.writeQueryMembership).not.toHaveBeenCalled();
    });
  });

  describe('CACHE_WRITE', () => {
    it('updates record for valid inputs', () => {
      const record = { id: '1', name: 'Test' };
      getHandler(IPC_CHANNELS.CACHE_WRITE)({}, 'contacts', 'create', record);

      expect(mockCache.updateRecord).toHaveBeenCalledWith('contacts', 'create', record);
    });

    it('accepts all valid actions', () => {
      for (const action of ['create', 'update', 'delete']) {
        const record = { id: '1' };
        getHandler(IPC_CHANNELS.CACHE_WRITE)({}, 'contacts', action, record);
        expect(mockCache.updateRecord).toHaveBeenCalledWith('contacts', action, record);
      }
    });

    it('returns early for invalid collection', () => {
      getHandler(IPC_CHANNELS.CACHE_WRITE)({}, 'bogus', 'create', { id: '1' });
      expect(mockCache.updateRecord).not.toHaveBeenCalled();
    });

    it('does not ingest archived standalone note records', () => {
      getHandler(IPC_CHANNELS.CACHE_WRITE)({}, 'standalone_notes', 'create', { id: 'note-1' });

      expect(mockCache.updateRecord).not.toHaveBeenCalled();
    });

    it.each([
      ['cloud_status_snapshot', 'snapshot'],
      ['cloud_status_mist_snapshot', 'mist-snapshot'],
      ['cloud_status_extension_snapshot', 'extension-snapshot'],
    ])('ingests realtime updates for the server-owned %s collection', (collection, id) => {
      const record = { id, key: 'current', providers: [] };

      getHandler(IPC_CHANNELS.CACHE_WRITE)({}, collection, 'update', record);

      expect(mockCache.updateRecord).toHaveBeenCalledWith(collection, 'update', record);
    });

    it('does not ingest retired roster realtime updates', () => {
      const retiredCollection = ['relay', 'operators'].join('_');

      getHandler(IPC_CHANNELS.CACHE_WRITE)({}, retiredCollection, 'update', {
        id: 'retired-record',
      });

      expect(mockCache.updateRecord).not.toHaveBeenCalled();
    });

    it('ingests knowledge metadata without queueing a server mutation', () => {
      const record = { id: 'document123', title: 'Updated Runbook' };

      getHandler(IPC_CHANNELS.CACHE_WRITE)({}, 'knowledge_documents', 'update', record);

      expect(mockCache.updateRecord).toHaveBeenCalledWith('knowledge_documents', 'update', record);
      expect(mockPending.getAll).not.toHaveBeenCalled();
      expect(mockSync.syncAll).not.toHaveBeenCalled();
    });

    it('ingests category metadata without making it offline writable', () => {
      const record = { id: 'category1', name: 'Operations', sortOrder: 100 };

      getHandler(IPC_CHANNELS.CACHE_WRITE)({}, 'knowledge_categories', 'update', record);

      expect(mockCache.updateRecord).toHaveBeenCalledWith('knowledge_categories', 'update', record);
      expect(mockPending.getAll).not.toHaveBeenCalled();
    });

    it('removes trashed knowledge metadata instead of caching it', () => {
      const record = { id: 'document123', title: 'Runbook', lifecycleState: 'trashed' };
      getHandler(IPC_CHANNELS.CACHE_WRITE)({}, 'knowledge_documents', 'update', record);

      expect(mockCache.updateRecord).toHaveBeenCalledWith('knowledge_documents', 'delete', {
        id: 'document123',
      });
    });

    it('returns early for non-string collection', () => {
      getHandler(IPC_CHANNELS.CACHE_WRITE)({}, 123, 'create', { id: '1' });
      expect(mockCache.updateRecord).not.toHaveBeenCalled();
    });

    it('returns early for invalid action', () => {
      getHandler(IPC_CHANNELS.CACHE_WRITE)({}, 'contacts', 'upsert', { id: '1' });
      expect(mockCache.updateRecord).not.toHaveBeenCalled();
    });

    it('returns early for non-string action', () => {
      getHandler(IPC_CHANNELS.CACHE_WRITE)({}, 'contacts', 99, { id: '1' });
      expect(mockCache.updateRecord).not.toHaveBeenCalled();
    });

    it('returns early for null record', () => {
      getHandler(IPC_CHANNELS.CACHE_WRITE)({}, 'contacts', 'create', null);
      expect(mockCache.updateRecord).not.toHaveBeenCalled();
    });

    it('returns early for non-object record', () => {
      getHandler(IPC_CHANNELS.CACHE_WRITE)({}, 'contacts', 'create', 'string');
      expect(mockCache.updateRecord).not.toHaveBeenCalled();
    });

    it('returns early for array record', () => {
      getHandler(IPC_CHANNELS.CACHE_WRITE)({}, 'contacts', 'create', [1, 2, 3]);
      expect(mockCache.updateRecord).not.toHaveBeenCalled();
    });

    it('returns early when record id is missing', () => {
      getHandler(IPC_CHANNELS.CACHE_WRITE)({}, 'contacts', 'create', { name: 'No Id' });
      expect(mockCache.updateRecord).not.toHaveBeenCalled();
    });

    it('returns early when record id is not a non-empty string', () => {
      for (const id of ['', '   ', 123, null]) {
        getHandler(IPC_CHANNELS.CACHE_WRITE)({}, 'contacts', 'create', { id });
      }

      expect(mockCache.updateRecord).not.toHaveBeenCalled();
    });

    it('returns early when record exceeds the cache size limit', () => {
      getHandler(IPC_CHANNELS.CACHE_WRITE)({}, 'contacts', 'create', {
        id: '1',
        body: 'x'.repeat(257 * 1024),
      });

      expect(mockCache.updateRecord).not.toHaveBeenCalled();
    });

    it('returns early when record cannot be serialized', () => {
      getHandler(IPC_CHANNELS.CACHE_WRITE)({}, 'contacts', 'create', { id: '1', value: 1n });

      expect(mockCache.updateRecord).not.toHaveBeenCalled();
    });

    it('returns early when cache is null', () => {
      getCache.mockReturnValueOnce(null as never);
      getHandler(IPC_CHANNELS.CACHE_WRITE)({}, 'contacts', 'create', { id: '1' });
      expect(mockCache.updateRecord).not.toHaveBeenCalled();
    });
  });

  describe('CACHE_SNAPSHOT', () => {
    it('writes collection for valid inputs', () => {
      const records = [{ id: '1' }, { id: '2' }];
      const signature = '2:0123456789abcdef';
      getHandler(IPC_CHANNELS.CACHE_SNAPSHOT)({}, 'contacts', signature, records);

      expect(mockCache.writeCollection).toHaveBeenCalledWith('contacts', signature, records);
    });

    it.each([
      ['cloud_status_snapshot', 'snapshot'],
      ['cloud_status_mist_snapshot', 'mist-snapshot'],
      ['cloud_status_extension_snapshot', 'extension-snapshot'],
    ])('persists the %s snapshot for offline clients', (collection, id) => {
      const records = [{ id, key: 'current' }];

      getHandler(IPC_CHANNELS.CACHE_SNAPSHOT)({}, collection, '1:0123456789abcdef', records);

      expect(mockCache.writeCollection).toHaveBeenCalledWith(
        collection,
        '1:0123456789abcdef',
        records,
      );
    });

    it('persists knowledge metadata snapshots for offline clients', () => {
      const records = [
        { id: 'document123', title: 'Runbook', lifecycleState: 'active' },
        { id: 'trashed123', title: 'Old Runbook', lifecycleState: 'trashed' },
      ];

      getHandler(IPC_CHANNELS.CACHE_SNAPSHOT)(
        {},
        'knowledge_documents',
        '1:0123456789abcdef',
        records,
      );

      expect(mockCache.writeCollection).toHaveBeenCalledWith(
        'knowledge_documents',
        '1:0123456789abcdef',
        [records[0]],
      );
    });

    it('marks a client cache usable only after an authenticated snapshot is written', () => {
      mockAppConfig.load.mockReturnValue({
        mode: 'client',
        serverUrl: 'https://relay.example.com',
      });
      mockCache.writeCollection.mockReturnValue(true);
      mockCache.getUsableCacheMarker.mockReturnValue(null);

      getHandler(IPC_CHANNELS.CACHE_SNAPSHOT)({}, 'contacts', '1:0123456789abcdef', [
        { id: 'abc123abc123abc' },
      ]);

      expect(mockCache.setUsableCacheMarker).toHaveBeenCalledWith(
        'https://relay.example.com',
        expect.any(Number),
        expect.any(Number),
      );
    });

    it('returns early when the revision signature is invalid', () => {
      getHandler(IPC_CHANNELS.CACHE_SNAPSHOT)({}, 'contacts', 'invalid', [{ id: '1' }]);

      expect(mockCache.writeCollection).not.toHaveBeenCalled();
    });

    it('returns early for invalid collection', () => {
      getHandler(IPC_CHANNELS.CACHE_SNAPSHOT)({}, 'invalid', []);
      expect(mockCache.writeCollection).not.toHaveBeenCalled();
    });

    it('does not persist archived standalone note snapshots', () => {
      getHandler(IPC_CHANNELS.CACHE_SNAPSHOT)({}, 'standalone_notes', '1:0123456789abcdef', [
        { id: 'note-1' },
      ]);

      expect(mockCache.writeCollection).not.toHaveBeenCalled();
    });

    it('returns early for non-string collection', () => {
      getHandler(IPC_CHANNELS.CACHE_SNAPSHOT)({}, 42, []);
      expect(mockCache.writeCollection).not.toHaveBeenCalled();
    });

    it('returns early when records is not an array', () => {
      getHandler(IPC_CHANNELS.CACHE_SNAPSHOT)({}, 'contacts', 'not-an-array');
      expect(mockCache.writeCollection).not.toHaveBeenCalled();
    });

    it('returns early when records is an object', () => {
      getHandler(IPC_CHANNELS.CACHE_SNAPSHOT)({}, 'contacts', { id: '1' });
      expect(mockCache.writeCollection).not.toHaveBeenCalled();
    });

    it('returns early when records is null', () => {
      getHandler(IPC_CHANNELS.CACHE_SNAPSHOT)({}, 'contacts', null);
      expect(mockCache.writeCollection).not.toHaveBeenCalled();
    });

    it('returns early when any snapshot record lacks a valid id', () => {
      getHandler(IPC_CHANNELS.CACHE_SNAPSHOT)({}, 'contacts', [{ id: '1' }, { name: 'No Id' }]);

      expect(mockCache.writeCollection).not.toHaveBeenCalled();
    });

    it('returns early when any snapshot record id is not a non-empty string', () => {
      getHandler(IPC_CHANNELS.CACHE_SNAPSHOT)({}, 'contacts', [{ id: '1' }, { id: '   ' }]);

      expect(mockCache.writeCollection).not.toHaveBeenCalled();
    });

    it('returns early when snapshot has too many records', () => {
      const records = Array.from({ length: 10_001 }, (_, index) => ({ id: `r${index}` }));

      getHandler(IPC_CHANNELS.CACHE_SNAPSHOT)({}, 'contacts', records);

      expect(mockCache.writeCollection).not.toHaveBeenCalled();
    });

    it('returns early when snapshot exceeds serialized size limits', () => {
      const records = [{ id: '1', body: 'x'.repeat(257 * 1024) }];

      getHandler(IPC_CHANNELS.CACHE_SNAPSHOT)({}, 'contacts', records);

      expect(mockCache.writeCollection).not.toHaveBeenCalled();
    });

    it('returns early when cache is null', () => {
      getCache.mockReturnValueOnce(null as never);
      getHandler(IPC_CHANNELS.CACHE_SNAPSHOT)({}, 'contacts', [{ id: '1' }]);
      expect(mockCache.writeCollection).not.toHaveBeenCalled();
    });
  });

  describe('SYNC_PENDING', () => {
    it('keeps an optimistic overlay for every offline-writable collection in the shared catalog', async () => {
      const changes = OFFLINE_WRITABLE_COLLECTIONS.map((collection, index) => ({
        id: index + 1,
        collection,
        action: 'create' as const,
        data: { id: `record-${index}` },
        timestamp: index,
      }));
      mockPending.getAll.mockReturnValue(changes);
      mockSync.isAuthenticated.mockReturnValue(false);
      mockAppConfig.load.mockReturnValue({});

      const result = (await getHandler(IPC_CHANNELS.SYNC_PENDING)()) as {
        remainingChanges: Array<{ collection: string }>;
      };

      expect(result.remainingChanges.map(({ collection }) => collection)).toEqual(
        OFFLINE_WRITABLE_COLLECTIONS,
      );
    });

    it('returns zero counts when pendingChanges is null', async () => {
      getPendingChanges.mockReturnValueOnce(null as never);
      const result = await getHandler(IPC_CHANNELS.SYNC_PENDING)();
      expect(result).toEqual({ total: 0, conflicts: 0, errors: [] });
    });

    it('returns zero counts when syncManager is null', async () => {
      getSyncManager.mockReturnValueOnce(null as never);
      const result = await getHandler(IPC_CHANNELS.SYNC_PENDING)();
      expect(result).toEqual({ total: 0, conflicts: 0, errors: [] });
    });

    it('returns zero counts when there are no pending changes', async () => {
      mockPending.getAll.mockReturnValue([]);
      const result = await getHandler(IPC_CHANNELS.SYNC_PENDING)();
      expect(result).toEqual({ total: 0, conflicts: 0, errors: [] });
    });

    it('syncs all changes and removes each by id on full success — never bulk-clears', async () => {
      const changes = [{ id: 1 }, { id: 2 }];
      mockPending.getAll.mockReturnValue(changes);
      mockSync.isAuthenticated.mockReturnValue(true);
      mockSync.syncAll.mockResolvedValue({
        total: 2,
        conflicts: 0,
        errors: [],
        synced: [1, 2],
        failed: [],
      });

      const result = await getHandler(IPC_CHANNELS.SYNC_PENDING)();

      expect(mockSync.syncAll).toHaveBeenCalledWith(changes);
      expect(mockPending.clear).not.toHaveBeenCalled();
      expect(mockPending.remove).toHaveBeenCalledWith(1);
      expect(mockPending.remove).toHaveBeenCalledWith(2);
      expect(result).toEqual({ total: 2, conflicts: 0, errors: [], synced: [1, 2], failed: [] });
    });

    it('removes only successful changes on partial failure', async () => {
      const changes = [{ id: 1 }, { id: 2 }, { id: 3 }];
      mockPending.getAll.mockReturnValue(changes);
      mockSync.isAuthenticated.mockReturnValue(true);
      mockSync.syncAll.mockResolvedValue({
        total: 3,
        conflicts: 0,
        errors: ['one error'],
        synced: [1, 3],
        failed: [{ changeId: 2, error: 'one error' }],
      });

      await getHandler(IPC_CHANNELS.SYNC_PENDING)();

      expect(mockPending.clear).not.toHaveBeenCalled();
      expect(mockPending.remove).toHaveBeenCalledWith(1);
      expect(mockPending.remove).not.toHaveBeenCalledWith(2);
      expect(mockPending.remove).toHaveBeenCalledWith(3);
    });

    it('removes only the synced change ids, never bulk-clears', async () => {
      const changes = [{ id: 1 }, { id: 2 }];
      mockPending.getAll.mockReturnValue(changes);
      mockSync.isAuthenticated.mockReturnValue(true);
      mockSync.syncAll.mockResolvedValue({
        total: 2,
        conflicts: 0,
        errors: [],
        synced: [1, 2],
        failed: [],
      });

      await getHandler(IPC_CHANNELS.SYNC_PENDING)();

      expect(mockPending.remove).toHaveBeenCalledWith(1);
      expect(mockPending.remove).toHaveBeenCalledWith(2);
      expect(mockPending.clear).not.toHaveBeenCalled();
    });

    it('re-authenticates when token has expired and succeeds', async () => {
      const reauthPassphrase = createFixturePassphrase();
      const changes = [{ id: '1' }];
      mockPending.getAll.mockReturnValue(changes);
      mockSync.isAuthenticated.mockReturnValue(false);
      mockAppConfig.load.mockReturnValue({ [SECRET_FIELD]: reauthPassphrase });
      mockSync.reauthenticate.mockResolvedValue(undefined);
      mockSync.syncAll.mockResolvedValue({
        total: 1,
        conflicts: 0,
        errors: [],
        synced: [],
        failed: [],
      });

      await getHandler(IPC_CHANNELS.SYNC_PENDING)();

      expect(mockSync.reauthenticate).toHaveBeenCalledWith('relay@relay.app', reauthPassphrase);
      expect(mockSync.syncAll).toHaveBeenCalledWith(changes);
    });

    it('returns error result when re-authentication fails', async () => {
      const reauthPassphrase = createFixturePassphrase();
      const changes = [{ id: '1' }, { id: '2' }];
      mockPending.getAll.mockReturnValue(changes);
      mockSync.isAuthenticated.mockReturnValue(false);
      mockAppConfig.load.mockReturnValue({ [SECRET_FIELD]: reauthPassphrase });
      mockSync.reauthenticate.mockRejectedValue(new Error(`server reflected ${reauthPassphrase}`));

      const result = await getHandler(IPC_CHANNELS.SYNC_PENDING)();

      expect(result).toEqual({
        total: 2,
        conflicts: 0,
        errors: ['Re-authentication failed'],
        remaining: 2,
        remainingChanges: [],
      });
      expect(mockSync.syncAll).not.toHaveBeenCalled();
      expect(JSON.stringify(vi.mocked(loggers.sync.error).mock.calls)).not.toContain(
        reauthPassphrase,
      );
    });

    it('reports the missing credential instead of syncing when config has no secret', async () => {
      const changes = [{ id: '1' }, { id: '2' }];
      mockPending.getAll.mockReturnValue(changes);
      mockSync.isAuthenticated.mockReturnValue(false);
      mockAppConfig.load.mockReturnValue({});

      const result = await getHandler(IPC_CHANNELS.SYNC_PENDING)();

      // Syncing unauthenticated would stamp every change with a raw PocketBase
      // transport error and hide the real cause from the pending-changes banner.
      expect(mockSync.reauthenticate).not.toHaveBeenCalled();
      expect(mockSync.syncAll).not.toHaveBeenCalled();
      expect(result).toEqual({
        total: 2,
        conflicts: 0,
        errors: ['Relay is not signed in'],
        remaining: 2,
        remainingChanges: [],
      });
      expect(mockPending.markFailure).toHaveBeenCalledWith('1', 'Relay is not signed in');
      expect(mockPending.markFailure).toHaveBeenCalledWith('2', 'Relay is not signed in');
    });

    it('reports the missing credential instead of syncing when appConfig is null', async () => {
      getAppConfig.mockReturnValueOnce(null as never);
      const changes = [{ id: '1' }];
      mockPending.getAll.mockReturnValue(changes);
      mockSync.isAuthenticated.mockReturnValue(false);

      const result = await getHandler(IPC_CHANNELS.SYNC_PENDING)();

      expect(mockSync.reauthenticate).not.toHaveBeenCalled();
      expect(mockSync.syncAll).not.toHaveBeenCalled();
      expect(result).toMatchObject({ errors: ['Relay is not signed in'] });
    });

    it('handles getPendingChanges and getSyncManager not provided', async () => {
      vi.clearAllMocks();
      vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
        handlers[channel] = (...args: unknown[]) => Reflect.apply(handler, undefined, args);
        return ipcMain;
      });

      setupCacheHandlers(getCache); // no optional params

      const result = await getHandler(IPC_CHANNELS.SYNC_PENDING)();
      expect(result).toEqual({ total: 0, conflicts: 0, errors: [] });
    });
  });
});
