import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import PocketBase, { type RecordModel } from 'pocketbase';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncManager } from '../src/main/cache/SyncManager';
import { ensureCollections } from '../src/main/pocketbase/CollectionBootstrap';
import { getPocketBaseBinaryPath } from '../src/main/pocketbase/binaryPath';

// This opt-in accepts an executable only. It never accepts an existing data directory.
const PREVIOUS_BINARY = process.env.RELAY_VERIFY_PREVIOUS_POCKETBASE;
const CURRENT_BINARY = getPocketBaseBinaryPath({
  isPackaged: false,
  appRoot: process.cwd(),
  resourcesPath: '',
  platform: process.platform,
  arch: process.arch,
});
const EMAIL = 'upgrade@relay.test';
const PASSWORD = 'disposable-upgrade-password-1234';
const AUTH_COLLECTION = 'upgrade_fixture_accounts';
const UNKNOWN_COLLECTION = 'upgrade_fixture_unknown';
const RELATION_COLLECTION = 'upgrade_fixture_relations';
const ATTACHMENT_CONTENT = 'Relay upgrade attachment — preserved 日本語\n';

type Server = { child: ChildProcess; pb: PocketBase; exited: Promise<unknown> };
type Fixture = {
  root: string;
  account: RecordModel;
  record: RecordModel;
  relation: RecordModel;
  collectionIds: string[];
  previousToken: string;
};
const servers = new Set<Server>();
const roots = new Set<string>();

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

function directoryArgs(
  root: string,
  hooksDir = join(process.cwd(), 'resources/pocketbase/hooks'),
): string[] {
  return [
    `--dir=${join(root, 'pb_data')}`,
    `--migrationsDir=${join(root, 'pb_migrations')}`,
    `--hooksDir=${hooksDir}`,
    '--hooksWatch=false',
  ];
}

async function startServer(binary: string, root: string, hooksDir?: string): Promise<Server> {
  const url = `http://127.0.0.1:${await availablePort()}`;
  const child = spawn(
    binary,
    ['serve', `--http=${new URL(url).host}`, ...directoryArgs(root, hooksDir)],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '';
  const capture = (chunk: Buffer): void => {
    output = (output + chunk.toString()).slice(-8_192);
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  const exited = new Promise<void>((resolve) => child.once('close', () => resolve()));
  let startupError: Error | undefined;
  child.on('error', (error) => {
    startupError = error;
  });
  const server = { child, pb: new PocketBase(url), exited };
  servers.add(server);
  await vi.waitFor(
    async () => {
      if (startupError) throw startupError;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Disposable PocketBase exited before health check: ${output}`);
      }
      await server.pb.health.check({ signal: AbortSignal.timeout(1_000) });
    },
    { timeout: 15_000, interval: 50 },
  );
  await server.pb.collection('_superusers').authWithPassword(EMAIL, PASSWORD);
  return server;
}

async function stopServer(server: Server): Promise<void> {
  if (server.child.exitCode === null && server.child.signalCode === null) {
    server.child.kill('SIGTERM');
    const stopped = await Promise.race([
      server.exited.then(() => true),
      delay(5_000, false, { ref: false }),
    ]);
    if (!stopped) server.child.kill('SIGKILL');
  }
  await server.exited;
  servers.delete(server);
}

afterEach(async () => {
  for (const server of servers) await stopServer(server);
  for (const root of roots) {
    await rm(root, { recursive: true, force: true });
    roots.delete(root);
  }
});

async function seedPreviousVersion(): Promise<Fixture> {
  if (!PREVIOUS_BINARY) throw new Error('RELAY_VERIFY_PREVIOUS_POCKETBASE is not set');
  const root = await mkdtemp(join(tmpdir(), 'relay-pocketbase-upgrade-'));
  roots.add(root);
  await mkdir(join(root, 'pb_data'));
  await mkdir(join(root, 'pb_migrations'));
  const created = spawnSync(
    PREVIOUS_BINARY,
    ['superuser', 'upsert', EMAIL, PASSWORD, ...directoryArgs(root)],
    { encoding: 'utf8', timeout: 15_000 },
  );
  if (created.status !== 0) {
    throw new Error(`Disposable superuser setup failed: ${created.error ?? created.stderr}`);
  }
  const server = await startServer(PREVIOUS_BINARY, root);
  const { pb } = server;
  await ensureCollections(pb);
  const auth = await pb.collections.create({ name: AUTH_COLLECTION, type: 'auth' });
  const unknown = await pb.collections.create({
    name: UNKNOWN_COLLECTION,
    type: 'base',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    fields: [
      { name: 'label', type: 'text', required: true },
      { name: 'payload', type: 'json' },
      { name: 'attachment', type: 'file', maxSelect: 1, maxSize: 1_024, protected: true },
    ],
  });
  const links = await pb.collections.create({
    name: RELATION_COLLECTION,
    type: 'base',
    fields: [
      { name: 'target', type: 'relation', collectionId: unknown.id, required: true, maxSelect: 1 },
      { name: 'owner', type: 'relation', collectionId: auth.id, required: true, maxSelect: 1 },
    ],
  });
  const account = await pb.collection(AUTH_COLLECTION).create({
    email: EMAIL,
    password: PASSWORD,
    passwordConfirm: PASSWORD,
  });
  const record = await pb.collection(UNKNOWN_COLLECTION).create({
    label: 'Preserve this record',
    attachment: new File([ATTACHMENT_CONTENT], 'upgrade-attachment.txt', { type: 'text/plain' }),
    payload: {
      unicode: 'Résumé 日本語 🚦',
      escaped: 'quotes " and backslash \\ and newline\n',
      nested: { array: [null, false, 0, '', { value: 'original' }], empty: {} },
      largeInteger: Number.MAX_SAFE_INTEGER,
      decimal: 12.125,
    },
  });
  const relation = await pb.collection(RELATION_COLLECTION).create({
    target: record.id,
    owner: account.id,
  });
  const operator = new PocketBase(pb.baseURL);
  await operator.collection(AUTH_COLLECTION).authWithPassword(EMAIL, PASSWORD);
  const previousToken = operator.authStore.token;
  expect(await operator.collection(UNKNOWN_COLLECTION).getOne(record.id)).toEqual(record);
  await stopServer(server);
  return {
    root,
    account,
    record,
    relation,
    collectionIds: [auth.id, unknown.id, links.id],
    previousToken,
  };
}

async function assertPreserved(pb: PocketBase, fixture: Fixture): Promise<void> {
  for (const [index, name] of [
    AUTH_COLLECTION,
    UNKNOWN_COLLECTION,
    RELATION_COLLECTION,
  ].entries()) {
    expect((await pb.collections.getOne(name)).id).toBe(fixture.collectionIds[index]);
  }
  expect(await pb.collection(UNKNOWN_COLLECTION).getOne(fixture.record.id)).toEqual(fixture.record);
  expect(await pb.collection(RELATION_COLLECTION).getOne(fixture.relation.id)).toEqual(
    fixture.relation,
  );
  const expanded = await pb.collection(RELATION_COLLECTION).getOne(fixture.relation.id, {
    expand: 'target,owner',
  });
  expect(expanded.expand?.target).toEqual(fixture.record);
  expect(expanded.expand?.owner.id).toBe(fixture.account.id);
  const operator = new PocketBase(pb.baseURL);
  operator.authStore.save(fixture.previousToken, fixture.account);
  expect(await operator.collection(UNKNOWN_COLLECTION).getOne(fixture.record.id)).toEqual(
    fixture.record,
  );
  operator.authStore.clear();
  const authenticated = await operator
    .collection(AUTH_COLLECTION)
    .authWithPassword(EMAIL, PASSWORD);
  expect(authenticated.record.id).toBe(fixture.account.id);
  expect(await operator.collection(UNKNOWN_COLLECTION).getOne(fixture.record.id)).toEqual(
    fixture.record,
  );
  const attachmentUrl = operator.files.getURL(fixture.record, fixture.record.attachment, {
    token: await operator.files.getToken(),
  });
  const attachment = await fetch(attachmentUrl, { signal: AbortSignal.timeout(5_000) });
  expect(attachment.status).toBe(200);
  expect(await attachment.text()).toBe(ATTACHMENT_CONTENT);
}

describe.skipIf(!PREVIOUS_BINARY)('PocketBase executable upgrade with disposable data', () => {
  it.each(['update', 'delete'] as const)(
    'retains an offline %s when the previous server lacks atomic replay, while online CRUD works',
    async (action) => {
      const fixture = await seedPreviousVersion();
      const oldHooks = join(fixture.root, 'server-without-replay-hooks');
      await mkdir(oldHooks);
      if (!PREVIOUS_BINARY) throw new Error('Previous executable is required');
      const { pb } = await startServer(PREVIOUS_BINARY, fixture.root, oldHooks);
      const contact = await pb.collection('contacts').create({ name: 'Before server upgrade' });
      const result = await new SyncManager(pb).syncAll([
        {
          id: 1,
          collection: 'contacts',
          action,
          data: { id: contact.id, name: 'Queued edit' },
          baseUpdated: contact.updated,
          timestamp: Date.now(),
        },
      ]);
      expect(result.synced).toEqual([]);
      expect(result.conflicted).toEqual([]);
      expect(result.failed).toEqual([
        { changeId: 1, error: expect.stringContaining('Update the Relay server') },
      ]);
      expect(await pb.collection('contacts').getOne(contact.id)).toEqual(contact);
      const updated = await pb.collection('contacts').update(contact.id, { name: 'Online edit' });
      expect(updated).toMatchObject({ id: contact.id, name: 'Online edit' });
      expect(await pb.collection('contacts').delete(contact.id)).toBe(true);
      await expect(pb.collection('contacts').getOne(contact.id)).rejects.toMatchObject({
        status: 404,
      });
    },
  );

  it('preserves auth, JSON, relations and unknown collections through upgrade and repeated startup', async () => {
    const fixture = await seedPreviousVersion();
    const upgraded = await startServer(CURRENT_BINARY, fixture.root);
    await assertPreserved(upgraded.pb, fixture);
    await ensureCollections(upgraded.pb);
    await assertPreserved(upgraded.pb, fixture);
    const firstSchema = await upgraded.pb.collections.getFullList({ sort: 'name' });
    await stopServer(upgraded);
    const restarted = await startServer(CURRENT_BINARY, fixture.root);
    await ensureCollections(restarted.pb);
    expect(await restarted.pb.collections.getFullList({ sort: 'name' })).toEqual(firstSchema);
    await assertPreserved(restarted.pb, fixture);
  });

  it('recovers the previous executable and complete data snapshot after a failed rollout', async () => {
    const fixture = await seedPreviousVersion();
    const backupRoot = await mkdtemp(join(tmpdir(), 'relay-pre-upgrade-backup-'));
    roots.add(backupRoot);
    const snapshot = join(backupRoot, 'snapshot');
    // seedPreviousVersion has stopped the process: copy the whole consistent fixture,
    // including SQLite auxiliary data, uploaded files, and generated migrations.
    await cp(fixture.root, snapshot, { recursive: true });
    const upgraded = await startServer(CURRENT_BINARY, fixture.root);
    await ensureCollections(upgraded.pb);
    await upgraded.pb.collection(UNKNOWN_COLLECTION).update(fixture.record.id, {
      label: 'Written by the upgraded server',
      attachment: new File(['Replacement attachment'], 'replacement.txt', { type: 'text/plain' }),
    });
    expect((await upgraded.pb.collection(UNKNOWN_COLLECTION).getOne(fixture.record.id)).label).toBe(
      'Written by the upgraded server',
    );
    await stopServer(upgraded);

    // Revert application and data together. This never runs an older executable
    // against the upgraded database or accepts an external data path.
    await rm(fixture.root, { recursive: true });
    await cp(snapshot, fixture.root, { recursive: true });
    if (!PREVIOUS_BINARY) throw new Error('Previous executable is required');
    const restored = await startServer(PREVIOUS_BINARY, fixture.root);
    await assertPreserved(restored.pb, fixture);
    await ensureCollections(restored.pb);
    await assertPreserved(restored.pb, fixture);
  });

  // PocketBase's official restore endpoint explicitly does not support Windows.
  // Relay's Windows backup/restore implementation requires its own platform tests.
  it.skipIf(process.platform === 'win32')(
    'restores an upgraded disposable database through the backup API',
    async () => {
      const fixture = await seedPreviousVersion();
      const { pb } = await startServer(CURRENT_BINARY, fixture.root);
      const backupName = 'relay-upgrade-verification.zip';
      await pb.backups.create(backupName);
      await vi.waitFor(async () => {
        const backup = (await pb.backups.getFullList()).find(({ key }) => key === backupName);
        expect(backup?.size).toBeGreaterThan(0);
      });
      await pb.collection(UNKNOWN_COLLECTION).update(fixture.record.id, {
        label: 'Changed after backup',
        payload: { replaced: true },
      });
      expect((await pb.collection(UNKNOWN_COLLECTION).getOne(fixture.record.id)).label).toBe(
        'Changed after backup',
      );
      await pb.backups.restore(backupName);
      // restore() acknowledges scheduling; only the restored record proves completion.
      await vi.waitFor(
        async () => {
          await pb.collection('_superusers').authWithPassword(EMAIL, PASSWORD);
          expect(await pb.collection(UNKNOWN_COLLECTION).getOne(fixture.record.id)).toEqual(
            fixture.record,
          );
        },
        { timeout: 20_000, interval: 100 },
      );
      await assertPreserved(pb, fixture);
    },
  );
});
