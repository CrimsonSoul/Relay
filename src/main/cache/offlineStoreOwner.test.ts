import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OfflineCache } from './OfflineCache';
import { PendingChanges } from './PendingChanges';
import { AppConfig } from '../config/AppConfig';
import { prepareClientOfflineStore, readOfflineStoreOwner } from './offlineStoreOwner';
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'relay-store-owner-'));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
const client = (serverUrl: string) => ({
  mode: 'client' as const,
  serverUrl,
  secret: 'fixture-passphrase',
});
it('preserves the outgoing identity and queue through clear, restart, and same-target save', () => {
  const config = new AppConfig(directory);
  config.save(client('https://server-a.test'));
  prepareClientOfflineStore(directory, 'https://server-a.test');
  writeFileSync(join(directory, 'cache.db'), 'queued edits');
  expect(config.clear()).toBe(true);
  const restarted = new AppConfig(directory);
  expect(restarted.getOfflineServerUrl()).toBe('https://server-a.test');
  restarted.save(client('https://server-a.test'));
  prepareClientOfflineStore(directory, 'https://server-a.test');
  expect(readFileSync(join(directory, 'cache.db'), 'utf8')).toBe('queued edits');
});
it('quarantines unopened old-server stores before a different target can open them', () => {
  const config = new AppConfig(directory);
  config.save(client('https://server-a.test'));
  writeFileSync(join(directory, 'cache.db'), 'old queue');
  writeFileSync(join(directory, 'cache.db-wal'), 'old WAL');
  expect(config.clear()).toBe(true);
  new AppConfig(directory).save(client('https://server-b.test'));
  prepareClientOfflineStore(directory, 'https://server-b.test');
  expect(existsSync(join(directory, 'cache.db'))).toBe(false);
  const quarantine = readdirSync(directory).find((name) => name.startsWith('offline-quarantine-'))!;
  expect(readFileSync(join(directory, quarantine, 'cache.db'), 'utf8')).toBe('old queue');
  expect(readFileSync(join(directory, quarantine, 'cache.db-wal'), 'utf8')).toBe('old WAL');
  expect(readOfflineStoreOwner(directory)).toBe('https://server-b.test');
});
it('quarantines a queue with no surviving config instead of attributing it to a new server', () => {
  writeFileSync(join(directory, 'cache.db'), 'unowned queue');
  new AppConfig(directory).save(client('https://server-b.test'));
  prepareClientOfflineStore(directory, 'https://server-b.test');
  expect(existsSync(join(directory, 'cache.db'))).toBe(false);
});
it('fails closed on malformed ownership rather than opening old data under a new server', () => {
  writeFileSync(join(directory, 'offline-store-owner.json'), '{broken');
  writeFileSync(join(directory, 'cache.db'), 'retained');
  expect(() => prepareClientOfflineStore(directory, 'https://server-b.test')).toThrow();
  expect(readFileSync(join(directory, 'cache.db'), 'utf8')).toBe('retained');
});

it('opens a fresh SQLite queue after cross-restart retarget and preserves the old queued record locally', () => {
  const config = new AppConfig(directory);
  config.save(client('https://server-a.test'));
  prepareClientOfflineStore(directory, 'https://server-a.test');
  const cache = new OfflineCache(join(directory, 'cache.db'));
  const oldQueue = new PendingChanges(join(directory, 'cache.db'));
  oldQueue.enqueue('contacts', 'create', { id: 'oldserverrecord', name: 'Server A only' });
  oldQueue.close();
  cache.close();
  expect(config.clear()).toBe(true);
  new AppConfig(directory).save(client('https://server-b.test'));
  prepareClientOfflineStore(directory, 'https://server-b.test');
  const newCache = new OfflineCache(join(directory, 'cache.db'));
  const newQueue = new PendingChanges(join(directory, 'cache.db'));
  expect(newQueue.getAllStrict()).toEqual([]);
  newQueue.close();
  newCache.close();
  const quarantine = readdirSync(directory).find((name) => name.startsWith('offline-quarantine-'))!;
  const preservedQueue = new PendingChanges(join(directory, quarantine, 'cache.db'));
  expect(preservedQueue.getAllStrict()).toMatchObject([{ data: { name: 'Server A only' } }]);
  preservedQueue.close();
});
