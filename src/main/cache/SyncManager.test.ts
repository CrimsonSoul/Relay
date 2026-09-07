import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncManager } from './SyncManager';
import type { PendingChange } from './PendingChanges';

/** Index into an array, failing loudly rather than silently yielding `undefined`. */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Expected an element at index ${index} (length ${items.length})`);
  }
  return item;
}

// Mock the logger
vi.mock('../logger', () => ({
  loggers: {
    sync: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}));

// Mock PocketBase client
const mockPb = {
  collection: vi.fn(),
  send: vi.fn(),
  authStore: { isValid: false },
};

describe('SyncManager', () => {
  let syncManager: SyncManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPb.send.mockReset().mockResolvedValue({ applied: true });
    mockPb.authStore.isValid = false;
    syncManager = new SyncManager(mockPb as unknown as import('pocketbase').default);
  });

  // ── applyChange: create ──────────────────────────────────────────────────────

  it('applies a create change without conflict', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 'new-1' });
    mockPb.collection.mockReturnValue({ create: mockCreate });

    const change: PendingChange = {
      id: 1,
      collection: 'contacts',
      action: 'create',
      data: { name: 'Alice', email: 'alice@example.com' },
      timestamp: Date.now(),
    };

    const result = await syncManager.applyChange(change);
    expect(result.conflict).toBe(false);
    expect(mockCreate).toHaveBeenCalled();
  });

  it('preserves the stable offline id when creating a record', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 'server-generated' });
    mockPb.collection.mockReturnValue({ create: mockCreate });

    const change: PendingChange = {
      id: 1,
      collection: 'contacts',
      action: 'create',
      data: { id: 'local-1', name: 'Bob' },
      timestamp: Date.now(),
    };

    await syncManager.applyChange(change);
    const createArg = at(mockCreate.mock.calls, 0)[0] as Record<string, unknown>;
    expect(createArg).toHaveProperty('id', 'local-1');
    expect(createArg).toHaveProperty('name', 'Bob');
  });

  // ── applyChange: update ──────────────────────────────────────────────────────

  it('detects conflict on update when server record is newer', async () => {
    const serverRecord = { id: '1', name: 'Server Version', updated: '2026-03-21T12:00:00Z' };
    const mockGetOne = vi.fn().mockResolvedValue(serverRecord);
    const mockUpdate = vi.fn().mockResolvedValue({ id: '1', name: 'Client Version' });
    const mockCreate = vi.fn().mockResolvedValue({});
    mockPb.collection.mockReturnValue({
      getOne: mockGetOne,
      update: mockUpdate,
      create: mockCreate,
    });

    const change: PendingChange = {
      id: 2,
      collection: 'contacts',
      action: 'update',
      data: { id: '1', name: 'Client Version' },
      timestamp: new Date('2026-03-21T11:00:00Z').getTime(),
    };

    const result = await syncManager.applyChange(change);
    expect(result.conflict).toBe(true);
    expect(result.overwrittenData).toEqual(serverRecord);
    expect(result.applied).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockPb.send).not.toHaveBeenCalled();
  });

  it('applies update without conflict when client record is newer', async () => {
    const serverRecord = { id: '1', name: 'Old Name', updated: '2026-03-20T10:00:00Z' };
    const mockGetOne = vi.fn().mockResolvedValue(serverRecord);
    const mockUpdate = vi.fn().mockResolvedValue({ id: '1', name: 'New Name' });
    mockPb.collection.mockReturnValue({ getOne: mockGetOne, update: mockUpdate });

    const change: PendingChange = {
      id: 2,
      collection: 'contacts',
      action: 'update',
      data: { id: '1', name: 'New Name' },
      // client timestamp is after server updated time
      timestamp: new Date('2026-03-21T11:00:00Z').getTime(),
    };

    const result = await syncManager.applyChange(change);
    expect(result).toEqual({ conflict: false, applied: true });
    expect(mockPb.send).toHaveBeenCalledWith('/api/relay/offline/replay', {
      method: 'POST',
      body: {
        collection: 'contacts',
        action: 'update',
        recordId: '1',
        expectedUpdated: '2026-03-20T10:00:00Z',
        expectedFingerprint: '3edcc33ad2974110125f6e0d4cbf19afc8985d8e6c594878d53e13ac9f9ecbfa',
        data: { name: 'New Name' },
      },
      requestKey: null,
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('uses the exact cached server revision as the update conflict baseline', async () => {
    const serverRecord = { id: '1', name: 'Server edit', updated: '2026-07-10T12:01:00Z' };
    const mockGetOne = vi.fn().mockResolvedValue(serverRecord);
    const mockUpdate = vi.fn();
    mockPb.collection.mockReturnValue({
      getOne: mockGetOne,
      update: mockUpdate,
      create: vi.fn().mockResolvedValue({}),
    });

    const result = await syncManager.applyChange({
      id: 2,
      collection: 'contacts',
      action: 'update',
      data: { id: '1', name: 'Offline edit' },
      timestamp: new Date('2026-07-10T13:00:00Z').getTime(),
      baseUpdated: '2026-07-10T12:00:00Z',
    });

    expect(result).toMatchObject({ conflict: true, applied: false });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockPb.send).not.toHaveBeenCalled();
  });

  it('falls back to create when record not found on server during update', async () => {
    const notFoundError = new Error('Not found') as Error & { status: number };
    notFoundError.status = 404;
    const mockGetOne = vi.fn().mockRejectedValue(notFoundError);
    const mockCreate = vi.fn().mockResolvedValue({ id: '1' });
    mockPb.collection.mockReturnValue({ getOne: mockGetOne, create: mockCreate });

    const change: PendingChange = {
      id: 2,
      collection: 'contacts',
      action: 'update',
      data: { id: '1', name: 'Alice' },
      timestamp: Date.now(),
    };

    const result = await syncManager.applyChange(change);
    expect(result.conflict).toBe(false);
    expect(mockCreate).toHaveBeenCalled();
    const createArg = at(mockCreate.mock.calls, 0)[0] as Record<string, unknown>;
    expect(createArg).toHaveProperty('id', '1');
  });

  it('does not resurrect a remotely deleted record when the update has a base revision', async () => {
    const notFoundError = new Error('Not found') as Error & { status: number };
    notFoundError.status = 404;
    const mockCreate = vi.fn();
    mockPb.collection.mockReturnValue({
      getOne: vi.fn().mockRejectedValue(notFoundError),
      create: mockCreate,
    });

    const result = await syncManager.applyChange({
      id: 2,
      collection: 'contacts',
      action: 'update',
      data: { id: '1', name: 'Offline edit' },
      timestamp: Date.now(),
      baseUpdated: '2026-07-10T12:00:00Z',
    });

    expect(result).toEqual({ conflict: true, applied: false });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('strips id/created/updated meta-fields when updating a record', async () => {
    const serverRecord = { id: '1', name: 'Old', updated: '2026-03-20T10:00:00Z' };
    const mockGetOne = vi.fn().mockResolvedValue(serverRecord);
    const mockUpdate = vi.fn().mockResolvedValue({});
    mockPb.collection.mockReturnValue({ getOne: mockGetOne, update: mockUpdate });

    const change: PendingChange = {
      id: 2,
      collection: 'contacts',
      action: 'update',
      data: {
        id: '1',
        name: 'New',
        created: '2026-01-01T00:00:00Z',
        updated: '2026-03-22T00:00:00Z',
      },
      timestamp: new Date('2026-03-21T11:00:00Z').getTime(),
    };

    await syncManager.applyChange(change);

    const request = at(mockPb.send.mock.calls, 0)[1] as {
      body: { data: Record<string, unknown> };
    };
    expect(request.body.data).toEqual({ name: 'New' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // ── applyChange: delete ──────────────────────────────────────────────────────

  it('applies delete without conflict', async () => {
    const mockDelete = vi.fn().mockResolvedValue(true);
    mockPb.collection.mockReturnValue({
      getOne: vi.fn().mockResolvedValue({ id: '1', updated: '2026-03-20T10:00:00Z' }),
      delete: mockDelete,
    });

    const change: PendingChange = {
      id: 3,
      collection: 'contacts',
      action: 'delete',
      data: { id: '1' },
      timestamp: Date.now(),
    };

    const result = await syncManager.applyChange(change);
    expect(result).toEqual({ conflict: false, applied: true });
    expect(mockPb.send).toHaveBeenCalledWith('/api/relay/offline/replay', {
      method: 'POST',
      body: {
        collection: 'contacts',
        action: 'delete',
        recordId: '1',
        expectedUpdated: '2026-03-20T10:00:00Z',
        expectedFingerprint: 'ab988e52769fcd0cc4cb5903e67e51378801ad10de4560f100ece6e73b2e2d70',
      },
      requestKey: null,
    });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('keeps an offline delete pending when the server record changed', async () => {
    const existing = { id: '1', updated: '2026-07-10T12:01:00Z' };
    const mockDelete = vi.fn();
    mockPb.collection.mockReturnValue({
      getOne: vi.fn().mockResolvedValue(existing),
      delete: mockDelete,
    });

    const result = await syncManager.applyChange({
      id: 3,
      collection: 'contacts',
      action: 'delete',
      data: { id: '1' },
      timestamp: Date.now(),
      baseUpdated: '2026-07-10T12:00:00Z',
    });

    expect(result).toMatchObject({ conflict: true, applied: false });
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockPb.send).not.toHaveBeenCalled();
  });

  it('swallows error when deleting an already-deleted record', async () => {
    const notFoundError = new Error('Record not found') as Error & { status: number };
    notFoundError.status = 404;
    const mockDelete = vi.fn();
    mockPb.collection.mockReturnValue({
      getOne: vi.fn().mockRejectedValue(notFoundError),
      delete: mockDelete,
    });

    const change: PendingChange = {
      id: 3,
      collection: 'contacts',
      action: 'delete',
      data: { id: '99' },
      timestamp: Date.now(),
    };

    const result = await syncManager.applyChange(change);
    expect(result).toEqual({ conflict: false, applied: true });
    expect(mockPb.send).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  describe.each(['update', 'delete'] as const)('atomic %s replay', (action) => {
    const nativeMutation = vi.fn();
    const change: PendingChange = {
      id: 12,
      collection: 'contacts',
      action,
      data: { id: '1', name: 'Offline version' },
      timestamp: new Date('2026-03-21T11:00:00Z').getTime(),
      baseUpdated: '2026-03-20T10:00:00Z',
    };

    beforeEach(() => {
      mockPb.collection.mockReturnValue({
        getOne: vi.fn().mockResolvedValue({ id: '1', updated: '2026-03-20T10:00:00Z' }),
        create: nativeMutation,
        update: nativeMutation,
        delete: nativeMutation,
      });
    });

    it('fingerprints all nested server values independently of object key order', async () => {
      const getOne = vi
        .fn()
        .mockResolvedValueOnce({
          id: '1',
          metadata: { flags: [{ a: 1, z: 2 }, 'keep'], owner: 'server' },
          updated: '2026-03-20T10:00:00Z',
        })
        .mockResolvedValueOnce({
          updated: '2026-03-20T10:00:00Z',
          metadata: { owner: 'server', flags: [{ z: 2, a: 1 }, 'keep'] },
          id: '1',
        })
        .mockResolvedValueOnce({
          id: '1',
          metadata: { flags: [{ a: 2, z: 2 }, 'keep'], owner: 'server' },
          updated: '2026-03-20T10:00:00Z',
        });
      mockPb.collection.mockReturnValue({ getOne });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect(await syncManager.applyChange(change)).toEqual({ conflict: false, applied: true });
      }

      // Known SHA256 values for the hand-ordered JSON fixtures above.
      const fingerprints = mockPb.send.mock.calls.map(([, options]) => {
        return (options as { body: { expectedFingerprint: string } }).body.expectedFingerprint;
      });
      expect(fingerprints).toEqual([
        'c295bb56fcaef372376561789a80760436212fd44edd1e287a5e1d56c22a8384',
        'c295bb56fcaef372376561789a80760436212fd44edd1e287a5e1d56c22a8384',
        '41141e7b0a5310ed7e84adea6a4496eeafd7160b548e7494d837a21e56e13987',
      ]);
    });

    it('keeps changes unsynced when the replay route is missing without a native fallback', async () => {
      mockPb.send.mockRejectedValueOnce(
        Object.assign(new Error('Route not found'), { status: 404 }),
      );

      const result = await syncManager.syncAll([change]);

      expect(result.synced).toEqual([]);
      expect(result.conflicted).toEqual([]);
      expect(result.failed).toEqual([
        { changeId: 12, error: expect.stringContaining('Update the Relay server') },
      ]);
      expect(nativeMutation).not.toHaveBeenCalled();
    });

    it.each([
      { label: 'null response', response: null },
      { label: 'missing confirmation', response: {} },
      { label: 'false confirmation', response: { applied: false } },
      { label: 'nonboolean confirmation', response: { applied: 'true' } },
    ])('keeps changes unsynced for $label without a native fallback', async ({ response }) => {
      mockPb.send.mockResolvedValueOnce(response);

      const result = await syncManager.syncAll([change]);

      expect(result.synced).toEqual([]);
      expect(result.conflicted).toEqual([]);
      expect(result.failed).toEqual([
        { changeId: 12, error: expect.stringContaining('did not confirm the offline change') },
      ]);
      expect(nativeMutation).not.toHaveBeenCalled();
    });

    it('marks a concurrent revision conflict without syncing or falling back', async () => {
      mockPb.send.mockRejectedValueOnce(
        Object.assign(new Error('Revision changed'), { status: 409 }),
      );

      const result = await syncManager.syncAll([change]);

      expect(result.synced).toEqual([]);
      expect(result.conflicts).toBe(1);
      expect(result.conflicted).toEqual([12]);
      expect(result.failed).toEqual([]);
      expect(nativeMutation).not.toHaveBeenCalled();
    });
  });

  // ── applyChange: unknown action ──────────────────────────────────────────────

  it('throws on unknown action', async () => {
    const change = {
      id: 4,
      collection: 'contacts',
      action: 'upsert' as 'create',
      data: {},
      timestamp: Date.now(),
    };

    await expect(syncManager.applyChange(change)).rejects.toThrow('Unknown action: upsert');
  });

  // ── syncAll() ────────────────────────────────────────────────────────────────

  it('syncAll processes multiple changes and returns correct totals', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 'new-1' });
    const mockDelete = vi.fn().mockResolvedValue(true);
    mockPb.collection.mockReturnValue({
      create: mockCreate,
      getOne: vi.fn().mockResolvedValue({ id: '5', updated: '2026-03-20T10:00:00Z' }),
      delete: mockDelete,
    });

    const changes: PendingChange[] = [
      {
        id: 1,
        collection: 'contacts',
        action: 'create',
        data: { name: 'Alice' },
        timestamp: Date.now(),
      },
      {
        id: 2,
        collection: 'contacts',
        action: 'create',
        data: { name: 'Bob' },
        timestamp: Date.now(),
      },
      { id: 3, collection: 'contacts', action: 'delete', data: { id: '5' }, timestamp: Date.now() },
    ];

    const result = await syncManager.syncAll(changes);
    expect(result.total).toBe(3);
    expect(result.conflicts).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.synced).toEqual([1, 2, 3]);
  });

  it('syncAll counts conflicts correctly', async () => {
    const serverRecord = { id: '1', name: 'Server', updated: '2026-03-21T12:00:00Z' };
    const mockGetOne = vi.fn().mockResolvedValue(serverRecord);
    const mockUpdate = vi.fn().mockResolvedValue({});
    const mockCreate = vi.fn().mockResolvedValue({});
    mockPb.collection.mockReturnValue({
      getOne: mockGetOne,
      update: mockUpdate,
      create: mockCreate,
    });

    const changes: PendingChange[] = [
      {
        id: 1,
        collection: 'contacts',
        action: 'update',
        data: { id: '1', name: 'Client' },
        // older than server
        timestamp: new Date('2026-03-21T11:00:00Z').getTime(),
      },
    ];

    const result = await syncManager.syncAll(changes);
    expect(result.conflicts).toBe(1);
    expect(result.synced).toEqual([]);
    expect(result.errors).toHaveLength(0);
  });

  it('syncAll captures errors for failed changes', async () => {
    mockPb.collection.mockReturnValue({
      create: vi.fn().mockRejectedValue(new Error('Network error')),
    });

    const changes: PendingChange[] = [
      {
        id: 1,
        collection: 'contacts',
        action: 'create',
        data: { name: 'Alice' },
        timestamp: Date.now(),
      },
    ];

    const result = await syncManager.syncAll(changes);
    expect(result.total).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('contacts/create');
  });

  it('syncAll calls onProgress callback for each change', async () => {
    const mockCreate = vi.fn().mockResolvedValue({});
    mockPb.collection.mockReturnValue({ create: mockCreate });

    const changes: PendingChange[] = [
      { id: 1, collection: 'contacts', action: 'create', data: {}, timestamp: Date.now() },
      { id: 2, collection: 'contacts', action: 'create', data: {}, timestamp: Date.now() },
    ];

    const onProgress = vi.fn();
    await syncManager.syncAll(changes, onProgress);

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, 1, 2);
    expect(onProgress).toHaveBeenNthCalledWith(2, 2, 2);
  });

  it('syncAll continues processing after a failed change', async () => {
    const mockCreate = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ id: 'new-2' });
    mockPb.collection.mockReturnValue({ create: mockCreate });

    const changes: PendingChange[] = [
      {
        id: 1,
        collection: 'contacts',
        action: 'create',
        data: { name: 'Fail' },
        timestamp: Date.now(),
      },
      {
        id: 2,
        collection: 'contacts',
        action: 'create',
        data: { name: 'Success' },
        timestamp: Date.now(),
      },
    ];

    const result = await syncManager.syncAll(changes);
    expect(result.total).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  // ── isAuthenticated() ────────────────────────────────────────────────────────

  it('isAuthenticated returns false when authStore.isValid is false', () => {
    mockPb.authStore.isValid = false;
    expect(syncManager.isAuthenticated()).toBe(false);
  });

  it('isAuthenticated returns true when authStore.isValid is true', () => {
    mockPb.authStore.isValid = true;
    expect(syncManager.isAuthenticated()).toBe(true);
  });

  // ── reauthenticate() ─────────────────────────────────────────────────────────

  it('reauthenticate calls authWithPassword with correct credentials', async () => {
    const mockAuthWithPassword = vi.fn().mockResolvedValue({ token: 'new-token' });
    mockPb.collection.mockReturnValue({ authWithPassword: mockAuthWithPassword });

    await syncManager.reauthenticate('admin@example.com', 'supersecret');

    expect(mockPb.collection).toHaveBeenCalledWith('_pb_users_auth_');
    expect(mockAuthWithPassword).toHaveBeenCalledWith('admin@example.com', 'supersecret');
  });

  it('reauthenticate propagates errors from authWithPassword', async () => {
    const mockAuthWithPassword = vi.fn().mockRejectedValue(new Error('Invalid credentials'));
    mockPb.collection.mockReturnValue({ authWithPassword: mockAuthWithPassword });

    await expect(syncManager.reauthenticate('user@example.com', 'wrong')).rejects.toThrow(
      'Invalid credentials',
    );
  });
});
