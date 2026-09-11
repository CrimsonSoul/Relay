import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ipcMain } from 'electron';
import type PocketBase from 'pocketbase';
import { IPC_CHANNELS, type PendingChangesResponse } from '@shared/ipc';
import { PendingChanges } from '../cache/PendingChanges';
import { OfflineCache } from '../cache/OfflineCache';
import { SyncManager } from '../cache/SyncManager';
import { setupCacheHandlers } from './cacheHandlers';

const trusted = vi.hoisted(() => ({ value: true }));
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock('../utils/trustedSender', () => ({ assertTrustedIpcSender: () => trusted.value }));

describe('durable pending recovery', () => {
  let dir: string;
  let pending: PendingChanges;
  let cache: OfflineCache;
  let sync: SyncManager;
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const server = { id: 'abcdefghijklmno', name: 'Server', updated: '2026-01-02T00:00:00Z' };
  const getOne = vi.fn();
  const send = vi.fn();
  const request = (input: unknown) =>
    handlers.get(IPC_CHANNELS.PENDING_CHANGES)!({}, input) as Promise<PendingChangesResponse>;
  const review = async () => {
    const result = await request({ action: 'review', id: pending.getAll()[0]!.id });
    if (!result.ok || !('review' in result)) throw new Error('Review failed');
    return result.review;
  };
  beforeEach(() => {
    trusted.value = true;
    dir = mkdtempSync(join(tmpdir(), 'relay-recovery-'));
    cache = new OfflineCache(join(dir, 'cache.db'));
    pending = new PendingChanges(join(dir, 'cache.db'));
    getOne.mockReset().mockResolvedValue(server);
    send.mockReset().mockResolvedValue({ applied: true });
    sync = new SyncManager({
      authStore: { isValid: true },
      collection: () => ({ getOne }),
      send,
    } as unknown as PocketBase);
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers.set(channel, (...args) => Reflect.apply(handler, undefined, args));
      return ipcMain;
    });
    setupCacheHandlers(
      () => cache,
      () => pending,
      () => sync,
    );
    cache.applyOfflineMutationAtomically(
      'contacts',
      'update',
      { id: server.id, name: 'Local', updated: '2026-01-01T00:00:00Z' },
      '2026-01-01T00:00:00Z',
    );
  });
  afterEach(() => {
    pending.close();
    cache.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists identity and shows local/server differences', async () => {
    expect(await request({ action: 'list' })).toMatchObject({
      ok: true,
      entries: [{ label: 'Local', collection: 'contacts', action: 'update' }],
    });
    expect(await review()).toMatchObject({
      local: { name: 'Local' },
      server: { name: 'Server' },
      serverState: 'present',
    });
  });
  it('accepts server into cache and removes the exact entry', async () => {
    const inspected = await review();
    expect(
      await request({ action: 'resolve', token: inspected.token, resolution: 'server' }),
    ).toEqual({ ok: true, resolved: true, remainingChanges: [] });
    expect(pending.count()).toBe(0);
    expect(cache.readCollection('contacts')).toEqual([server]);
  });
  it.each(['server', 'retry'] as const)(
    'returns durable remaining overlays after %s resolution',
    async (resolution) => {
      cache.applyOfflineMutationAtomically(
        'oncall',
        'update',
        { id: 'remainingrecord', name: 'Queued', updated: 'local' },
        '2026-01-01T00:00:00Z',
      );
      cache.applyOfflineMutationAtomically('contacts', 'delete', { id: 'deletedrecordid' }, 'base');
      const inspected = await review();
      const result = await request({ action: 'resolve', token: inspected.token, resolution });
      expect(result).toMatchObject({
        ok: true,
        resolved: true,
        remainingChanges: [
          {
            collection: 'oncall',
            action: 'update',
            record: {
              id: 'remainingrecord',
              name: 'Queued',
              updated: '2026-01-01T00:00:00Z',
              queuedAt: expect.any(String),
            },
          },
          { collection: 'contacts', action: 'delete', record: { id: 'deletedrecordid' } },
        ],
      });
      expect(pending.count()).toBe(2);
    },
  );
  it('rejects stale review after a coalesced local edit', async () => {
    const inspected = await review();
    cache.applyOfflineMutationAtomically(
      'contacts',
      'update',
      { id: server.id, name: 'New local' },
      'base',
    );
    expect(
      await request({ action: 'resolve', token: inspected.token, resolution: 'server' }),
    ).toMatchObject({ ok: false });
    expect(pending.getAll()[0]?.data.name).toBe('New local');
  });
  it('keeps a reviewed edit and its exact fingerprint durable when server rejects the commit', async () => {
    const inspected = await review();
    send.mockRejectedValue({ status: 409 });
    expect(
      await request({
        action: 'resolve',
        token: inspected.token,
        resolution: 'retry',
        edits: { name: 'Merged' },
      }),
    ).toMatchObject({
      ok: true,
      resolved: false,
      remainingChanges: [{ collection: 'contacts', action: 'update', record: { name: 'Merged' } }],
    });
    expect(pending.getAll()[0]).toMatchObject({
      data: { name: 'Merged' },
      expectedFingerprint: expect.any(String),
      syncError: 'Server conflict',
    });
    expect(getOne).toHaveBeenCalledTimes(1);
    expect(cache.readCollection('contacts')[0]?.name).toBe('Merged');
  });
  it('does not apply a token to another server client', async () => {
    const inspected = await review();
    sync = new SyncManager({} as PocketBase);
    expect(
      await request({ action: 'resolve', token: inspected.token, resolution: 'server' }),
    ).toMatchObject({ ok: false });
    expect(pending.count()).toBe(1);
  });
  it('distinguishes missing record from unavailable server and keeps local data', async () => {
    getOne.mockRejectedValueOnce({ status: 404 });
    expect(await review()).toMatchObject({ serverState: 'deleted', server: null });
    getOne.mockRejectedValueOnce({ status: 500, message: 'private transport detail' });
    const result = await review();
    expect(result.serverState).toBe('unavailable');
    expect(result.token).toBeUndefined();
    expect(pending.count()).toBe(1);
  });
  it('denies untrusted callers and oversized or unknown requests', async () => {
    trusted.value = false;
    expect(await request({ action: 'list' })).toMatchObject({ ok: false });
    trusted.value = true;
    expect(await request({ action: 'list', afterId: -1 })).toMatchObject({ ok: false });
    expect(await request({ action: 'list', extra: true })).toMatchObject({ ok: false });
    expect(
      await request({ action: 'resolve', token: 'x'.repeat(300000), resolution: 'server' }),
    ).toMatchObject({ ok: false });
  });
  it('old successful replay cannot erase an edit queued during the request', async () => {
    getOne.mockImplementation(async () => {
      cache.applyOfflineMutationAtomically(
        'contacts',
        'update',
        { id: server.id, name: 'New intent' },
        'base',
      );
      return { ...server, updated: '2025-01-01T00:00:00Z' };
    });
    await handlers.get(IPC_CHANNELS.SYNC_PENDING)!({});
    expect(pending.getAll()[0]?.data.name).toBe('New intent');
  });
  it('accepts fresh server values rather than a review that became outdated', async () => {
    const inspected = await review();
    getOne.mockResolvedValue({ ...server, name: 'Newest server' });
    await request({ action: 'resolve', token: inspected.token, resolution: 'server' });
    expect(cache.readCollection('contacts')[0]?.name).toBe('Newest server');
  });

  it('keeps the queue when a server switch occurs while reading review details', async () => {
    getOne.mockImplementation(async () => {
      sync = new SyncManager({} as PocketBase);
      return server;
    });
    expect(await request({ action: 'review', id: pending.getAll()[0]!.id })).toMatchObject({
      ok: false,
    });
    expect(pending.count()).toBe(1);
  });

  it('resolves a create collision only with an explicitly reviewed update', async () => {
    pending.clear();
    cache.applyOfflineMutationAtomically(
      'contacts',
      'create',
      { id: server.id, name: 'Local create' },
      '',
    );
    const inspected = await review();
    expect(
      await request({
        action: 'resolve',
        token: inspected.token,
        resolution: 'retry',
        edits: { name: 'Merged create' },
      }),
    ).toEqual({ ok: true, resolved: true, remainingChanges: [] });
    expect(send).toHaveBeenCalledWith(
      '/api/relay/offline/replay',
      expect.objectContaining({
        body: expect.objectContaining({ action: 'update', data: { name: 'Merged create' } }),
      }),
    );
    expect(pending.count()).toBe(0);
  });

  it('does not recreate a deleted server record via reviewed retry', async () => {
    getOne.mockRejectedValue({ status: 404 });
    const inspected = await review();
    expect(
      await request({ action: 'resolve', token: inspected.token, resolution: 'retry' }),
    ).toMatchObject({ ok: false });
    expect(send).not.toHaveBeenCalled();
    expect(pending.count()).toBe(1);
  });
  it('returns sync-shaped results when reconnect joins a pending resolution', async () => {
    const inspected = await review();
    let finish!: (value: typeof server) => void;
    getOne.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const resolving = request({ action: 'resolve', token: inspected.token, resolution: 'server' });
    const syncing = handlers.get(IPC_CHANNELS.SYNC_PENDING)!({});
    finish(server);
    await resolving;
    expect(await syncing).toMatchObject({ total: 0, conflicts: 0, errors: [] });
  });
  it('rejects an edited record whose combined data exceeds the bound', async () => {
    cache.applyOfflineMutationAtomically(
      'contacts',
      'update',
      { id: server.id, name: 'x'.repeat(180000), other: '' },
      'base',
    );
    const inspected = await review();
    expect(
      await request({
        action: 'resolve',
        token: inspected.token,
        resolution: 'retry',
        edits: { other: 'y'.repeat(180000) },
      }),
    ).toMatchObject({ ok: false });
    expect(pending.getAll()[0]?.data.other).toBe('');
  });
  it.each(['standalone', 'atomic'] as const)(
    'eventually deletes a record deleted during a successful deferred create via %s writer',
    async (writer) => {
      pending.clear();
      const created = { ...server, name: 'New create' };
      let remote: Record<string, unknown> | null = null;
      let finishCreate!: () => void;
      const create = vi.fn(
        () =>
          new Promise((resolve) => {
            finishCreate = () => {
              remote = created;
              resolve(created);
            };
          }),
      );
      getOne.mockImplementation(async () => {
        if (!remote) throw { status: 404 };
        return remote;
      });
      send.mockImplementation(async () => {
        remote = null;
        return { applied: true };
      });
      sync = new SyncManager({
        authStore: { isValid: true },
        collection: () => ({ create, getOne }),
        send,
      } as unknown as PocketBase);
      cache.applyOfflineMutationAtomically(
        'contacts',
        'create',
        { id: server.id, name: 'New create' },
        '',
      );
      const replaying = handlers.get(IPC_CHANNELS.SYNC_PENDING)!({});
      await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      if (writer === 'standalone') {
        pending.enqueueCoalesced('contacts', 'delete', { id: server.id });
        cache.updateRecord('contacts', 'delete', { id: server.id });
      } else cache.applyOfflineMutationAtomically('contacts', 'delete', { id: server.id }, '');
      expect(pending.getAll()[0]?.action).toBe('delete');
      finishCreate();
      await replaying;
      expect(pending.getAll()[0]).toMatchObject({
        action: 'delete',
        expectedFingerprint: expect.any(String),
      });
      await handlers.get(IPC_CHANNELS.SYNC_PENDING)!({});
      expect(remote).toBeNull();
      expect(pending.count()).toBe(0);
      expect(cache.readCollection('contacts')).toEqual([]);
    },
  );

  it('does not blindly delete a colliding server record after an attempted create', async () => {
    pending.clear();
    const create = vi.fn(async () => {
      throw { status: 409 };
    });
    sync = new SyncManager({
      authStore: { isValid: true },
      collection: () => ({ create, getOne }),
      send,
    } as unknown as PocketBase);
    cache.applyOfflineMutationAtomically(
      'contacts',
      'create',
      { id: server.id, name: 'Unrelated local create' },
      '',
    );
    await handlers.get(IPC_CHANNELS.SYNC_PENDING)!({});
    cache.applyOfflineMutationAtomically('contacts', 'delete', { id: server.id }, '');
    await handlers.get(IPC_CHANNELS.SYNC_PENDING)!({});
    expect(pending.getAll()[0]).toMatchObject({ action: 'delete', syncError: 'Server conflict' });
    expect(send).not.toHaveBeenCalled();
  });

  it.each(['standalone', 'atomic'] as const)(
    'retains an ambiguous create cancellation after restart even if the server currently reports missing via %s',
    async (writer) => {
      pending.clear();
      const create = vi.fn(async () => {
        throw Object.assign(new Error('Connection lost'), { status: 0 });
      });
      getOne.mockRejectedValue({ status: 404 });
      sync = new SyncManager({
        authStore: { isValid: true },
        collection: () => ({ create, getOne }),
        send,
      } as unknown as PocketBase);
      cache.applyOfflineMutationAtomically(
        'contacts',
        'create',
        { id: server.id, name: 'Uncertain create' },
        '',
      );
      await handlers.get(IPC_CHANNELS.SYNC_PENDING)!({});
      pending.close();
      pending = new PendingChanges(join(dir, 'cache.db'));
      if (writer === 'standalone')
        pending.enqueueCoalesced('contacts', 'delete', { id: server.id });
      else cache.applyOfflineMutationAtomically('contacts', 'delete', { id: server.id }, '');
      await handlers.get(IPC_CHANNELS.SYNC_PENDING)!({});
      expect(pending.getAll()[0]).toMatchObject({
        action: 'delete',
        createAttempt: expect.any(String),
        syncError: 'Server conflict',
      });
      expect(send).not.toHaveBeenCalled();
    },
  );
});
