import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { setupOfflineMutationHandlers } from './offlineMutationHandlers';

const send = vi.fn();
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send } }],
  },
}));
vi.mock('../utils/trustedSender', () => ({ assertTrustedIpcSender: () => true }));

describe('offlineMutationHandlers', () => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const cache = {
    readCollection: vi.fn(() => [{ id: 'abc123abc123abc', name: 'Before' }]),
    updateRecord: vi.fn(),
    applyOfflineMutationAtomically: vi.fn(() => true),
  };
  const pending = {
    enqueue: vi.fn(() => 1),
    enqueueCoalesced: vi.fn(() => ({ id: 1, action: 'update' })),
    count: vi.fn(() => 1),
    remove: vi.fn(),
    getAll: vi.fn(() => []),
  };
  const appConfig = { load: vi.fn(() => ({ mode: 'client' })) };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers[channel] = handler as (...args: unknown[]) => unknown;
      return ipcMain;
    });
    setupOfflineMutationHandlers(
      () => cache as never,
      () => pending as never,
      () => appConfig as never,
    );
  });

  it('queues and applies a validated optimistic update', () => {
    const result = handlers[IPC_CHANNELS.OFFLINE_MUTATE](
      {},
      {
        collection: 'contacts',
        action: 'update',
        recordId: 'abc123abc123abc',
        data: { name: 'After' },
      },
    ) as { ok: boolean; record: Record<string, unknown>; pendingCount: number };

    expect(result).toMatchObject({
      ok: true,
      record: { id: 'abc123abc123abc', name: 'After' },
      pendingCount: 1,
    });
    expect(cache.applyOfflineMutationAtomically).toHaveBeenCalledWith(
      'contacts',
      'update',
      expect.objectContaining({ id: 'abc123abc123abc', name: 'After' }),
      '',
    );
    expect(cache.updateRecord).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      IPC_CHANNELS.OFFLINE_MUTATION_APPLIED,
      expect.objectContaining({ collection: 'contacts', pendingCount: 1 }),
    );
  });

  it('assigns a valid stable PocketBase ID to offline creates', () => {
    const result = handlers[IPC_CHANNELS.OFFLINE_MUTATE](
      {},
      {
        collection: 'alert_reminders',
        action: 'create',
        data: { title: 'Send update' },
      },
    ) as { ok: boolean; record: { id: string } };

    expect(result.ok).toBe(true);
    expect(result.record.id).toMatch(/^[a-z0-9]{15}$/);
  });

  it('rejects source records, invalid IDs, and oversized payloads', () => {
    expect(
      handlers[IPC_CHANNELS.OFFLINE_MUTATE](
        {},
        {
          collection: 'dynatrace_problems',
          action: 'create',
        },
      ),
    ).toMatchObject({ ok: false });
    expect(
      handlers[IPC_CHANNELS.OFFLINE_MUTATE](
        {},
        {
          collection: 'contacts',
          action: 'update',
          recordId: 'short',
        },
      ),
    ).toMatchObject({ ok: false });
    expect(
      handlers[IPC_CHANNELS.OFFLINE_MUTATE](
        {},
        {
          collection: 'contacts',
          action: 'create',
          data: { value: 'x'.repeat(257 * 1024) },
        },
      ),
    ).toMatchObject({ ok: false });
    expect(cache.applyOfflineMutationAtomically).not.toHaveBeenCalled();
  });

  it('never queues knowledge base mutations', () => {
    const result = handlers[IPC_CHANNELS.OFFLINE_MUTATE](
      {},
      {
        collection: 'knowledge_documents',
        action: 'update',
        recordId: 'abc123abc123abc',
        data: { title: 'Operator edit' },
      },
    );

    expect(result).toMatchObject({ ok: false });
    expect(cache.applyOfflineMutationAtomically).not.toHaveBeenCalled();
    expect(pending.enqueueCoalesced).not.toHaveBeenCalled();
  });

  it('never queues retired roster mutations', () => {
    const result = handlers[IPC_CHANNELS.OFFLINE_MUTATE](
      {},
      {
        collection: ['relay', 'operators'].join('_'),
        action: 'create',
        data: { displayName: 'Retired user' },
      },
    );

    expect(result).toMatchObject({ ok: false });
    expect(cache.applyOfflineMutationAtomically).not.toHaveBeenCalled();
    expect(pending.enqueueCoalesced).not.toHaveBeenCalled();
  });

  it('rejects offline queue writes in server mode', () => {
    appConfig.load.mockReturnValueOnce({ mode: 'server' } as never);

    const result = handlers[IPC_CHANNELS.OFFLINE_MUTATE](
      {},
      {
        collection: 'contacts',
        action: 'create',
        data: { name: 'Nope' },
      },
    );

    expect(result).toMatchObject({ ok: false });
  });
});
