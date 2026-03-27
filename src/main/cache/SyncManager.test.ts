import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncManager } from './SyncManager';
import type { PendingChange } from './PendingChanges';

// Mock the logger
vi.mock('../logger', () => ({
  loggers: {
    sync: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}));

// Mock PocketBase client
const mockPb = {
  collection: vi.fn(),
  authStore: { isValid: false },
};

describe('SyncManager', () => {
  let syncManager: SyncManager;

  beforeEach(() => {
    vi.clearAllMocks();
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

  it('strips the id field when creating a record', async () => {
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
    // The create call should NOT include the 'id' field
    const createArg = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(createArg).not.toHaveProperty('id');
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
    expect(mockUpdate).toHaveBeenCalled();
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
    expect(result.conflict).toBe(false);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('falls back to create when record not found on server during update', async () => {
    const mockGetOne = vi.fn().mockRejectedValue(new Error('Not found'));
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
    // id should be stripped from the create payload
    const createArg = mockCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(createArg).not.toHaveProperty('id');
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

    const updateArg = mockUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(updateArg).not.toHaveProperty('id');
    expect(updateArg).not.toHaveProperty('created');
    expect(updateArg).not.toHaveProperty('updated');
    expect(updateArg).toHaveProperty('name', 'New');
  });

  // ── applyChange: delete ──────────────────────────────────────────────────────

  it('applies delete without conflict', async () => {
    const mockDelete = vi.fn().mockResolvedValue(true);
    mockPb.collection.mockReturnValue({ delete: mockDelete });

    const change: PendingChange = {
      id: 3,
      collection: 'contacts',
      action: 'delete',
      data: { id: '1' },
      timestamp: Date.now(),
    };

    const result = await syncManager.applyChange(change);
    expect(result.conflict).toBe(false);
    expect(mockDelete).toHaveBeenCalledWith('1');
  });

  it('swallows error when deleting an already-deleted record', async () => {
    const mockDelete = vi.fn().mockRejectedValue(new Error('Record not found'));
    mockPb.collection.mockReturnValue({ delete: mockDelete });

    const change: PendingChange = {
      id: 3,
      collection: 'contacts',
      action: 'delete',
      data: { id: '99' },
      timestamp: Date.now(),
    };

    const result = await syncManager.applyChange(change);
    expect(result.conflict).toBe(false);
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
    mockPb.collection.mockReturnValue({ create: mockCreate, delete: mockDelete });

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
