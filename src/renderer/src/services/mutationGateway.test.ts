import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mutateCollection } from './mutationGateway';

const { create, update, remove, getConnectionState, applyOfflineMutationToStores } = vi.hoisted(
  () => ({
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    getConnectionState: vi.fn(),
    applyOfflineMutationToStores: vi.fn(),
  }),
);

vi.mock('./pocketbase', () => ({
  getConnectionState,
  getPb: () => ({ collection: () => ({ create, update, delete: remove }) }),
  handleApiError: vi.fn(),
  requireOnline: vi.fn(),
}));
vi.mock('../stores/collectionStoreRegistry', () => ({ applyOfflineMutationToStores }));

describe('mutationGateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getConnectionState.mockReturnValue('online');
    create.mockResolvedValue({ id: 'server-record' });
    update.mockResolvedValue({ id: 'abc123abc123abc', name: 'Updated' });
    remove.mockResolvedValue(true);
    (globalThis as Record<string, unknown>).api = undefined;
  });

  it('uses PocketBase directly while online', async () => {
    await mutateCollection('contacts', 'update', 'abc123abc123abc', { name: 'Updated' });

    expect(update).toHaveBeenCalledWith('abc123abc123abc', { name: 'Updated' });
  });

  it('queues and applies an optimistic mutation while offline', async () => {
    getConnectionState.mockReturnValue('offline');
    const mutation = {
      ok: true as const,
      mutationId: 'mutation-1',
      collection: 'contacts' as const,
      action: 'update' as const,
      record: { id: 'abc123abc123abc', name: 'Updated' },
      pendingCount: 1,
    };
    const mutateOffline = vi.fn().mockResolvedValue(mutation);
    (globalThis as Record<string, unknown>).api = { mutateOffline };

    const result = await mutateCollection<{ id: string; name: string }>(
      'contacts',
      'update',
      'abc123abc123abc',
      { name: 'Updated' },
    );

    expect(result).toEqual(mutation.record);
    expect(mutateOffline).toHaveBeenCalledWith({
      collection: 'contacts',
      action: 'update',
      recordId: 'abc123abc123abc',
      data: { name: 'Updated' },
    });
    expect(applyOfflineMutationToStores).toHaveBeenCalledWith(mutation);
    expect(update).not.toHaveBeenCalled();
  });

  it('never queues writes after an authentication failure', async () => {
    getConnectionState.mockReturnValue('auth-failed');
    const mutateOffline = vi.fn();
    (globalThis as Record<string, unknown>).api = { mutateOffline };

    await expect(
      mutateCollection('contacts', 'create', undefined, { name: 'Blocked' }),
    ).rejects.toThrow('Sign-in to the Relay server failed');
    expect(mutateOffline).not.toHaveBeenCalled();
  });

  it('never queues writes while authentication is still reconnecting', async () => {
    getConnectionState.mockReturnValue('reconnecting');
    const mutateOffline = vi.fn();
    (globalThis as Record<string, unknown>).api = { mutateOffline };

    await expect(
      mutateCollection('contacts', 'create', undefined, { name: 'Wait' }),
    ).rejects.toThrow('Relay is reconnecting');
    expect(mutateOffline).not.toHaveBeenCalled();
  });
});
