import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID, generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ensureCollections,
  ensureKnowledgeBatchApi,
  redactCompletedPrivilegedPayloads,
} from '../src/main/pocketbase/CollectionBootstrap';
import { getPocketBaseBinaryPath } from '../src/main/pocketbase/binaryPath';
import { installMainProcessEventSource } from '../src/main/pocketbase/mainProcessEventSource';
import {
  PrivilegedCommandProcessor,
  PrivilegedCommandConflictError,
  PrivilegedCommandSafeError,
} from '../src/main/privileged/PrivilegedCommandProcessor';
import { PrivilegedPocketBaseClient } from '../src/main/privileged/PrivilegedPocketBaseClient';
import {
  canonicalPrivilegedSigningBytes,
  canonicalizePrivilegedValue,
  type SignedPrivilegedCommandEnvelope,
} from '../src/shared/privilegedCommands';
import {
  PocketBasePrivilegedRepository,
  PrivilegedServerQueue,
  PrivilegedPocketBaseClientTransport,
} from '../src/main/privileged/PrivilegedPocketBaseTransport';
const PASSWORD = 'disposable-replay-test-password';
let root = '';
let child: ChildProcess | undefined;
let admin: PocketBase;
let account: PocketBase;
let accountId: string;
const signingKey = generateKeyPairSync('ec', { namedCurve: 'P-256' });
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
  installMainProcessEventSource();
  root = await mkdtemp(join(tmpdir(), 'relay-security-admin-'));
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
    ['superuser', 'upsert', 'admin@replay.test', PASSWORD, `--dir=${dataDir}`],
    { encoding: 'utf8' },
  );
  if (created.status !== 0) throw new Error(`Test server setup failed: ${created.stderr}`);
  const url = `http://127.0.0.1:${await availablePort()}`;
  child = spawn(
    binary,
    [
      'serve',
      `--http=${new URL(url).host}`,
      `--dir=${dataDir}`,
      `--migrationsDir=${join(root, 'pb_migrations')}`,
      `--hooksDir=${join(process.cwd(), 'resources/pocketbase/hooks')}`,
      '--hooksWatch=false',
    ],
    { stdio: 'ignore' },
  );
  admin = new PocketBase(url);
  await vi.waitFor(() => admin.health.check(), { timeout: 10_000, interval: 50 });
  await admin.collection('_superusers').authWithPassword('admin@replay.test', PASSWORD);
  await ensureCollections(admin);
  await ensureKnowledgeBatchApi(admin);
  const owner = await admin
    .collection('relay_privileged_accounts')
    .getFirstListItem('username="ryan"');
  accountId = owner.id;
  await admin.collection('relay_privileged_accounts').update(owner.id, {
    active: true,
    password: PASSWORD,
    passwordConfirm: PASSWORD,
    mustChangePassword: false,
  });
  await admin.collection('relay_privileged_devices').create({
    accountId,
    deviceId: 'device-fixture',
    hostnameSnapshot: 'Test',
    label: 'Test',
    publicKey: JSON.stringify(signingKey.publicKey.export({ format: 'jwk' })),
    fingerprint: createHash('sha256')
      .update(signingKey.publicKey.export({ format: 'der', type: 'spki' }))
      .digest('hex'),
    state: 'active',
    pairedAt: new Date().toISOString(),
  });
  account = new PocketBase(url);
  await account.collection('relay_privileged_accounts').authWithPassword('ryan', PASSWORD);
}, 30_000);

afterAll(async () => {
  await account?.realtime.unsubscribe();
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  if (root) await rm(root, { recursive: true, force: true });
});

const SECRET = 'synthetic-upstream-secret';
function commandData(state = 'pending') {
  const now = new Date().toISOString();
  return {
    requestId: randomUUID(),
    accountId,
    deviceId: 'device-fixture',
    displayNameSnapshot: 'Ryan',
    roleClaim: 'owner',
    command: 'administration.setting.replace',
    issuedAt: now,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    payload: {
      setting: 'dynatrace.platform-token',
      value: { apiToken: SECRET },
      expectedRevision: 0,
    },
    bodyHash: 'a'.repeat(64),
    signature: 's'.repeat(86),
    state,
  };
}

describe('protected command payload storage', () => {
  it('hides transient payloads from account create/get/list/projection and realtime, while workers can read them', async () => {
    const events: unknown[] = [];
    await account
      .collection('relay_privileged_commands')
      .subscribe('*', (event) => events.push(event.record));
    const data = commandData();
    const created = await account.collection('relay_privileged_commands').create(data);
    expect(created).not.toHaveProperty('payload');
    const read = await account.collection('relay_privileged_commands').getOne(created.id);
    const projected = await account
      .collection('relay_privileged_commands')
      .getOne(created.id, { fields: 'id,payload,payload.value.apiToken' });
    const list = await account.collection('relay_privileged_commands').getList(1, 20);
    expect(JSON.stringify([read, projected, list])).not.toContain(SECRET);
    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));
    expect(JSON.stringify(events)).not.toContain(SECRET);
    expect(
      (await admin.collection('relay_privileged_commands').getOne(created.id)).payload,
    ).toEqual(data.payload);
    await expect(
      account
        .collection('relay_privileged_commands')
        .getList(1, 20, { filter: 'payload.value.apiToken = "synthetic-upstream-secret"' }),
    ).rejects.toMatchObject({ status: 400 });
    await account.collection('relay_privileged_commands').unsubscribe('*');
    const repository = new PocketBasePrivilegedRepository(admin);
    await repository.completeCommand(data.requestId, {
      state: 'succeeded',
      result: { configured: true },
      safeError: null,
      completedAt: new Date().toISOString(),
    });
    const terminal = await admin.collection('relay_privileged_commands').getOne(created.id);
    expect(terminal.payload).toEqual({});
    expect(terminal.bodyHash).toBe(data.bodyHash);
    expect(terminal.result).toEqual({ configured: true });
  });
  it('scrubs retained terminal payloads while preserving pending bodies needed for signature verification', async () => {
    const completed = await admin
      .collection('relay_privileged_commands')
      .create(commandData('failed'));
    const pending = await admin.collection('relay_privileged_commands').create(commandData());
    await redactCompletedPrivilegedPayloads(admin);
    expect(
      (await admin.collection('relay_privileged_commands').getOne(completed.id)).payload,
    ).toEqual({});
    expect(
      (await admin.collection('relay_privileged_commands').getOne(pending.id)).payload,
    ).toHaveProperty('value.apiToken', SECRET);
  });
});

describe('direct upload chunk boundary', () => {
  let batchId: string;
  beforeAll(async () => {
    const now = new Date().toISOString();
    const batch = await admin.collection('knowledge_upload_batches').create({
      requestId: randomUUID(),
      accountId,
      deviceId: 'device-fixture',
      fileCount: 20,
      totalBytes: 10000000,
      state: 'active',
      createdAt: now,
      lastActivityAt: now,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    batchId = batch.id;
  });
  async function upload(byteSize = 12) {
    return admin.collection('knowledge_uploads').create({
      requestId: randomUUID(),
      batchId,
      accountId,
      deviceId: 'device-fixture',
      fileName: 'test.pdf',
      checksum: 'a'.repeat(64),
      byteSize,
      chunkSize: 4 * 1024 * 1024,
      chunkCount: Math.ceil(byteSize / (4 * 1024 * 1024)),
      state: 'uploading',
      lastActivityAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
  }
  function chunk(uploadId: string, index: number, size = 12, declaredSize = size) {
    const data = new FormData();
    for (const [key, value] of Object.entries({
      uploadId,
      batchId,
      accountId,
      deviceId: 'device-fixture',
      index,
      byteSize: declaredSize,
      checksum: createHash('sha256').update(Buffer.alloc(size)).digest('hex'),
    }))
      data.set(key, String(value));
    data.set('chunk', new Blob([Buffer.alloc(size)]), 'chunk.bin');
    return data;
  }
  it.each([-1, 1.5, 1, 999, Number.MAX_SAFE_INTEGER + 1])(
    'rejects non-admitted index %s before storing a row',
    async (index) => {
      const manifest = await upload();
      await expect(
        account.collection('knowledge_upload_chunks').create(chunk(manifest.id, index)),
      ).rejects.toMatchObject({ status: 400 });
      expect(
        (
          await admin
            .collection('knowledge_upload_chunks')
            .getList(1, 20, { filter: `uploadId="${manifest.id}"` })
        ).totalItems,
      ).toBe(0);
    },
  );
  it.each([
    [11, 12],
    [13, 12],
    [12, 11],
    [4 * 1024 * 1024, 12],
  ])('rejects actual/declared sizes %s/%s', async (actual, declared) => {
    const manifest = await upload();
    await expect(
      account.collection('knowledge_upload_chunks').create(chunk(manifest.id, 0, actual, declared)),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('accepts the exact admitted bytes and last remainder, and rejects duplicate indexes and batch bypass', async () => {
    const manifest = await upload();
    await expect(
      account.collection('knowledge_upload_chunks').create(chunk(manifest.id, 0)),
    ).resolves.toHaveProperty('index', 0);
    await expect(
      account.collection('knowledge_upload_chunks').create(chunk(manifest.id, 0)),
    ).rejects.toMatchObject({ status: 400 });
    const remainder = await upload(4 * 1024 * 1024 + 7);
    await expect(
      account.collection('knowledge_upload_chunks').create(chunk(remainder.id, 1, 7)),
    ).resolves.toHaveProperty('index', 1);
    const batch = account.createBatch();
    batch.collection('knowledge_upload_chunks').create(chunk(remainder.id, 999));
    await expect(batch.send()).rejects.toMatchObject({ status: 400 });
  });
});

function signedEnvelope(
  command: SignedPrivilegedCommandEnvelope['command'] = 'privileged.status.read',
  payload: SignedPrivilegedCommandEnvelope['payload'] = { clientVersion: '1' },
): SignedPrivilegedCommandEnvelope {
  const envelope: SignedPrivilegedCommandEnvelope = {
    version: 1,
    requestId: randomUUID(),
    accountId,
    deviceId: 'device-fixture',
    roleClaim: 'owner',
    displayNameSnapshot: 'Ryan Bledsoe',
    command,
    payload,
    payloadHash: createHash('sha256').update(canonicalizePrivilegedValue(payload)).digest('hex'),
    expectedRevision: null,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    signature: '',
  };
  envelope.signature = sign(
    'sha256',
    canonicalPrivilegedSigningBytes(envelope),
    signingKey.privateKey,
  ).toString('base64url');
  return envelope;
}

describe('processor, queue, and paired client round trips', () => {
  it.each(['rate-limited', 'insufficient-storage', 'duplicate-file-name', 'conflict'] as const)(
    'preserves %s and bounded details through real command persistence',
    async (error) => {
      const repository = new PocketBasePrivilegedRepository(admin);
      const processor = new PrivilegedCommandProcessor({
        repository,
        ...(error === 'rate-limited'
          ? { commandLimiter: { tryConsume: () => ({ allowed: false }) } as never }
          : {}),
        statusHandler: async () => {
          if (error === 'conflict') throw new PrivilegedCommandConflictError(7);
          throw new PrivilegedCommandSafeError(
            error === 'rate-limited' ? 'invalid-request' : error,
            'Safe actionable explanation.',
          );
        },
      });
      const queue = new PrivilegedServerQueue({
        pb: admin,
        commandProcessor: processor,
        pairingService: { completePairing: vi.fn() },
      });
      const transport = new PrivilegedPocketBaseClientTransport({
        client: {
          createRecord: (name, data) => account.collection(name).create(data),
          getRecord: (name, id) => account.collection(name).getOne(id),
        },
        wait: () => queue.drain(),
        maxAttempts: 3,
      });
      const envelope = signedEnvelope();
      try {
        const result = await transport.submitCommand(
          envelope,
          createHash('sha256').update(canonicalPrivilegedSigningBytes(envelope)).digest('hex'),
        );
        expect(result).toMatchObject({
          ok: false,
          error,
          ...(error === 'conflict' ? { currentRevision: 7, refresh: true } : {}),
        });
        if (error !== 'rate-limited' && error !== 'conflict')
          expect(result).toHaveProperty('message', 'Safe actionable explanation.');
        const stored = await admin
          .collection('relay_privileged_commands')
          .getFirstListItem(`requestId="${envelope.requestId}"`);
        expect(stored.payload).toEqual({});
      } finally {
        transport.dispose();
        await queue.dispose();
      }
    },
  );
  it('polls a committed ownership command after its shared authentication was cleared', async () => {
    const authClient = new PrivilegedPocketBaseClient({
      serverUrl: admin.baseURL,
      allowInsecureHttp: true,
    });
    await authClient.authenticate('ryan', PASSWORD);
    const repository = new PocketBasePrivilegedRepository(admin);
    const processor = new PrivilegedCommandProcessor({ repository });
    processor.registerCommand('ownership.transfer', 'ownership.transfer', async () => {
      authClient.clear();
      return { transferred: true };
    });
    const queue = new PrivilegedServerQueue({
      pb: admin,
      commandProcessor: processor,
      pairingService: { completePairing: vi.fn() },
    });
    const transport = new PrivilegedPocketBaseClientTransport({
      client: authClient,
      wait: () => queue.drain(),
      maxAttempts: 3,
    });
    const envelope = signedEnvelope('ownership.transfer', {
      accountId: 'other-account',
      expectedStateRevision: 1,
      reauthRequestId: 'test-proof',
    });
    try {
      await expect(
        transport.submitCommand(
          envelope,
          createHash('sha256').update(canonicalPrivilegedSigningBytes(envelope)).digest('hex'),
        ),
      ).resolves.toMatchObject({ ok: true, value: { transferred: true } });
      expect(authClient.getAccount()).toBe(null);
    } finally {
      transport.dispose();
      authClient.clear();
      await queue.dispose();
    }
  });
});
