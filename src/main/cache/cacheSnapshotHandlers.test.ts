import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OfflineCache } from './OfflineCache';
import { setupCacheHandlers } from '../handlers/cacheHandlers';
import { collectionRevisionSignature } from '@shared/cacheSnapshot';
import { IPC_CHANNELS as C } from '@shared/ipc';
const state = vi.hoisted(() => ({
  trusted: true,
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      state.handlers.set(channel, handler),
  },
  BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock('../logger', () => ({
  loggers: { cache: { error: vi.fn() }, sync: { error: vi.fn(), warn: vi.fn() } },
}));
vi.mock('../utils/trustedSender', () => ({ assertTrustedIpcSender: () => state.trusted }));
let dir: string;
let cache: OfflineCache;
let server = 'server-a';
let mode = 'client';
const sender = { sender: { id: 1, on: vi.fn() }, senderFrame: { processId: 10, routingId: 20 } };
const rows = [{ id: 'saved' }];
const manifest = {
  count: 1,
  bytes: Buffer.byteLength(JSON.stringify(rows[0])),
  signature: collectionRevisionSignature(rows),
};
function call(channel: string, ...args: unknown[]) {
  return state.handlers.get(channel)!(sender, ...args) as {
    ok: boolean;
    generation: string;
    unsupported?: boolean;
  };
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'relay-ipc-snapshot-'));
  cache = new OfflineCache(join(dir, 'cache.db'));
  state.trusted = true;
  server = 'server-a';
  mode = 'client';
  setupCacheHandlers(
    () => cache,
    undefined,
    undefined,
    () => ({ load: () => ({ mode, serverUrl: server }) }) as never,
  );
});
afterEach(() => {
  cache.close();
  rmSync(dir, { recursive: true, force: true });
});
it('enforces trusted sender, collection allowlist and generation owner/server isolation', () => {
  state.trusted = false;
  expect(call(C.CACHE_SNAPSHOT_BEGIN, 'contacts', manifest).ok).toBe(false);
  state.trusted = true;
  expect(call(C.CACHE_SNAPSHOT_BEGIN, '_superusers', manifest).ok).toBe(false);
  const stage = call(C.CACHE_SNAPSHOT_BEGIN, 'contacts', manifest);
  expect(stage.ok).toBe(true);
  const other = { ...sender, sender: { id: 2, on: vi.fn() } };
  expect(
    state.handlers.get(C.CACHE_SNAPSHOT_APPEND)!(other, stage.generation, 0, rows),
  ).toMatchObject({ ok: false });
  server = 'server-b';
  expect(call(C.CACHE_SNAPSHOT_APPEND, stage.generation, 0, rows).ok).toBe(false);
  server = 'server-a';
  expect(call(C.CACHE_SNAPSHOT_APPEND, stage.generation, 0, rows).ok).toBe(false);
  const fresh = call(C.CACHE_SNAPSHOT_BEGIN, 'contacts', manifest);
  expect(call(C.CACHE_SNAPSHOT_APPEND, fresh.generation, 0, rows).ok).toBe(true);
  expect(call(C.CACHE_SNAPSHOT_COMMIT, fresh.generation)).toMatchObject({
    ok: true,
    persisted: true,
  });
  expect(cache.readCollection('contacts')).toEqual(rows);
});
it('reports unsupported server-mode storage separately and rejects an oversized realtime write', () => {
  mode = 'server';
  expect(call(C.CACHE_SNAPSHOT_BEGIN, 'contacts', manifest)).toMatchObject({
    ok: false,
    unsupported: true,
  });
  expect(call(C.CACHE_SNAPSHOT_STATUS, 'contacts')).toMatchObject({
    complete: false,
    supported: false,
  });
  mode = 'client';
  const stage = call(C.CACHE_SNAPSHOT_BEGIN, 'contacts', manifest);
  call(C.CACHE_SNAPSHOT_APPEND, stage.generation, 0, rows);
  call(C.CACHE_SNAPSHOT_COMMIT, stage.generation);
  expect(
    call(C.CACHE_WRITE, 'contacts', 'update', { id: 'saved', text: 'x'.repeat(262144) }),
  ).toMatchObject({ ok: false, persisted: false });
  expect(cache.snapshotStatus('contacts').complete).toBe(false);
  expect(cache.readCollection('contacts')).toEqual(rows);
});

it('revokes a prior renderer document generation on main-frame navigation', () => {
  const stage = call(C.CACHE_SNAPSHOT_BEGIN, 'contacts', manifest);
  const callback = sender.sender.on.mock.calls.at(-1)?.[1] as (...args: unknown[]) => void;
  callback({}, 'file:///renderer/index.html', false, true);
  expect(call(C.CACHE_SNAPSHOT_APPEND, stage.generation, 0, rows).ok).toBe(false);
});
