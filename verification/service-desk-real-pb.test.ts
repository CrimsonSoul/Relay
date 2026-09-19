import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { ensureCollections } from '../src/main/pocketbase/CollectionBootstrap';
import { getPocketBaseBinaryPath } from '../src/main/pocketbase/binaryPath';
const PASSWORD = 'disposable-synthetic-ticket-test';
let root = '';
let child: ChildProcess | undefined;
let admin: PocketBase;
let account: PocketBase;
async function availablePort(): Promise<number> {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('No test port allocated');
  await new Promise<void>((resolve, reject) => {
    listener.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'relay-demo-tickets-'));
  const binary = getPocketBaseBinaryPath({
    isPackaged: false,
    appRoot: process.cwd(),
    resourcesPath: '',
    platform: process.platform,
    arch: process.arch,
  });
  const dataDir = join(root, 'pb_data');
  const created = spawnSync(
    binary,
    ['superuser', 'upsert', 'admin@ticket.test', PASSWORD, `--dir=${dataDir}`],
    { encoding: 'utf8' },
  );
  if (created.status !== 0) throw new Error(created.stderr);
  const url = `http://127.0.0.1:${await availablePort()}`;
  child = spawn(
    binary,
    [
      'serve',
      `--http=${new URL(url).host}`,
      `--dir=${dataDir}`,
      `--migrationsDir=${join(root, 'pb_migrations')}`,
    ],
    { stdio: 'ignore' },
  );
  admin = new PocketBase(url);
  await vi.waitFor(() => admin.health.check(), { timeout: 10000, interval: 50 });
  await admin.collection('_superusers').authWithPassword('admin@ticket.test', PASSWORD);
  await ensureCollections(admin);
  await admin.collections.create({ name: 'test_users', type: 'auth' });
  await admin
    .collection('test_users')
    .create({ email: 'demo@ticket.test', password: PASSWORD, passwordConfirm: PASSWORD });
  account = new PocketBase(url);
  account.autoCancellation(false);
  await account.collection('test_users').authWithPassword('demo@ticket.test', PASSWORD);
});
afterAll(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  if (root) await rm(root, { recursive: true, force: true });
});
it('stores shared live ticket references without adding ticket content fields', async () => {
  const collection = 'relay_sdp_links';
  const input = {
    ticketId: '123456',
    ticketNumber: '810129',
    problemId: 'P-TEST',
    environment: 'https://example.live.dynatrace.com',
  };
  const saved = await account.collection(collection).create(input);
  expect(saved.ticketId).toBe(input.ticketId);
  const schema = await admin.collections.getOne(collection);
  expect(schema.fields.map((field) => field.name)).not.toContain('subject');
  expect(schema.fields.map((field) => field.name)).not.toContain('description');
  await expect(account.collection(collection).create(input)).rejects.toThrow();
  await expect(
    account.collection(collection).update(saved.id, { ticketId: '888' }),
  ).rejects.toThrow();
  await expect(
    account.collection(collection).create({ ...input, ticketId: 'arbitrary content' }),
  ).rejects.toThrow();
  await account.collection(collection).delete(saved.id);
});
