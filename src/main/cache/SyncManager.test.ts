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
};

describe('SyncManager', () => {
  let syncManager: SyncManager;

  beforeEach(() => {
    vi.clearAllMocks();
    syncManager = new SyncManager(mockPb as any);
  });

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
});
