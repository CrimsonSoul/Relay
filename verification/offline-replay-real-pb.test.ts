import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import PocketBase, { type RecordModel } from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SyncManager, fingerprintRecord } from '../src/main/cache/SyncManager';
import { getPocketBaseBinaryPath } from '../src/main/pocketbase/binaryPath';
import { installMainProcessEventSource } from '../src/main/pocketbase/mainProcessEventSource';

const REPLAY_ROUTE = '/api/relay/offline/replay';
const PASSWORD = 'disposable-replay-test-password';
let root = '';
let child: ChildProcess | undefined;
let admin: PocketBase;
let operator: PocketBase;
let peer: PocketBase;

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
  root = await mkdtemp(join(tmpdir(), 'relay-offline-replay-'));
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
  await admin.collections.create({ name: 'operators', type: 'auth' });
  for (const email of ['operator@replay.test', 'peer@replay.test']) {
    await admin
      .collection('operators')
      .create({ email, password: PASSWORD, passwordConfirm: PASSWORD });
  }
  operator = new PocketBase(url);
  peer = new PocketBase(url);
  await operator.collection('operators').authWithPassword('operator@replay.test', PASSWORD);
  await peer.collection('operators').authWithPassword('peer@replay.test', PASSWORD);
  for (const name of ['contacts', 'notes', 'unrelated', 'servers']) {
    await admin.collections.create({
      name,
      type: 'base',
      listRule: '@request.auth.id != ""',
      viewRule: '@request.auth.id != ""',
      createRule: '@request.auth.id != ""',
      updateRule: name === 'notes' ? null : '@request.auth.id != ""',
      deleteRule: name === 'notes' ? null : '@request.auth.id != ""',
      fields: [
        { type: 'text', name: 'name', required: true },
        { type: 'text', name: 'internal', hidden: true },
        { type: 'number', name: 'count' },
        { type: 'json', name: 'details' },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
      ],
    });
  }
  await admin.collections.create({
    name: 'alert_history',
    type: 'base',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
    fields: [
      { type: 'bool', name: 'pinned' },
      { type: 'date', name: 'created' },
    ],
  });
}, 30_000);

afterAll(async () => {
  if (child && child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  if (root) await rm(root, { recursive: true, force: true });
});

function replayBody(record: RecordModel, action = 'update', collection = 'contacts') {
  const canonical = JSON.stringify(record, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => {
            if (a === b) return 0;
            return a < b ? -1 : 1;
          }),
        )
      : value,
  );
  return {
    collection,
    action,
    recordId: record.id,
    expectedUpdated: record.updated,
    expectedFingerprint: createHash('sha256').update(canonical).digest('hex'),
    ...(action === 'update' ? { data: { name: 'Offline edit' } } : {}),
  };
}

describe('offline replay against an isolated PocketBase server', () => {
  it.each(['update', 'delete'] as const)(
    'preserves a peer edit made between the client read and offline %s',
    async (action) => {
      const record = await operator.collection('contacts').create({ name: 'Original' });
      let concurrentEdit = false;
      operator.beforeSend = async (url, options) => {
        if (
          !concurrentEdit &&
          (options.method === 'PATCH' || options.method === 'DELETE' || url.endsWith(REPLAY_ROUTE))
        ) {
          concurrentEdit = true;
          // PocketBase timestamps have millisecond precision; create a distinct revision.
          await delay(5);
          await peer.collection('contacts').update(record.id, { name: 'Peer edit' });
        }
        return { url, options };
      };
      try {
        const result = await new SyncManager(operator).applyChange({
          id: 1,
          collection: 'contacts',
          action,
          data: { id: record.id, name: 'Offline edit' },
          baseUpdated: record.updated,
          timestamp: Date.now(),
        });
        expect(concurrentEdit).toBe(true);
        expect(result).toMatchObject({ conflict: true, applied: false });
        expect((await peer.collection('contacts').getOne(record.id)).name).toBe('Peer edit');
      } finally {
        operator.beforeSend = undefined;
      }
    },
  );

  it.each(['before request', 'during commit'] as const)(
    'keeps the exact reviewed revision when a peer edits %s',
    async (timing) => {
      const record = await operator.collection('contacts').create({ name: 'Reviewed' });
      const expectedFingerprint = fingerprintRecord(record);
      if (timing === 'before request')
        await peer.collection('contacts').update(record.id, { name: 'Newer peer' });
      operator.beforeSend = async (url, options) => {
        if (timing === 'during commit' && url.endsWith(REPLAY_ROUTE)) {
          await peer.collection('contacts').update(record.id, { name: 'Newer peer' });
        }
        return { url, options };
      };
      try {
        const result = await new SyncManager(operator).applyChange({
          id: 1,
          collection: 'contacts',
          action: 'update',
          data: { id: record.id, name: 'Reviewed local edit' },
          timestamp: Date.now(),
          baseUpdated: record.updated,
          expectedFingerprint,
        });
        expect(result).toEqual({ conflict: true, applied: false });
        expect((await peer.collection('contacts').getOne(record.id)).name).toBe('Newer peer');
      } finally {
        operator.beforeSend = undefined;
      }
    },
  );

  it('uses a confirmed create response to guard its subsequent cancellation', async () => {
    const manager = new SyncManager(operator);
    const created = await manager.applyChange({
      id: 1,
      collection: 'contacts',
      action: 'create',
      data: { name: 'Cancelled create' },
      timestamp: Date.now(),
      createAttempt: 'test-attempt',
    });
    expect(created.createdRecord).toBeDefined();
    const record = created.createdRecord!;
    expect(
      await manager.applyChange({
        id: 1,
        collection: 'contacts',
        action: 'delete',
        data: { id: record.id },
        timestamp: Date.now(),
        createAttempt: 'test-attempt',
        baseUpdated: String(record.updated),
        expectedFingerprint: fingerprintRecord(record),
      }),
    ).toEqual({ applied: true, conflict: false });
    await expect(operator.collection('contacts').getOne(String(record.id))).rejects.toMatchObject({
      status: 404,
    });
  });

  it('allows an unchanged revision to update and then delete', async () => {
    const record = await operator.collection('contacts').create({ name: 'Original' });
    expect(await operator.send(REPLAY_ROUTE, { method: 'POST', body: replayBody(record) })).toEqual(
      { applied: true },
    );
    const updated = await operator.collection('contacts').getOne(record.id);
    expect(updated.name).toBe('Offline edit');
    expect(
      await operator.send(REPLAY_ROUTE, { method: 'POST', body: replayBody(updated, 'delete') }),
    ).toEqual({ applied: true });
    await expect(operator.collection('contacts').getOne(record.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('keeps the ordinary CRUD used by older clients working', async () => {
    const record = await operator.collection('contacts').create({ name: 'Original' });
    await operator.collection('contacts').update(record.id, { name: 'Legacy client edit' });
    expect((await peer.collection('contacts').getOne(record.id)).name).toBe('Legacy client edit');
    await operator.collection('contacts').delete(record.id);
  });

  it('delivers replay updates and deletes to existing realtime subscribers', async () => {
    const record = await operator.collection('contacts').create({ name: 'Original' });
    const events: string[] = [];
    const unsubscribe = await peer.collection('contacts').subscribe(record.id, (event) => {
      events.push(event.action);
    });
    try {
      await operator.send(REPLAY_ROUTE, { method: 'POST', body: replayBody(record) });
      await vi.waitFor(() => expect(events).toContain('update'));
      const updated = await peer.collection('contacts').getOne(record.id);
      await operator.send(REPLAY_ROUTE, { method: 'POST', body: replayBody(updated, 'delete') });
      await vi.waitFor(() => expect(events).toContain('delete'));
    } finally {
      await unsubscribe();
    }
  });

  it.each([null, {}, [], { z: [3, { b: 'x', a: 'y' }], a: 2 }])(
    'matches unchanged JSON fields %j across the server and SDK',
    async (details) => {
      const record = await operator.collection('contacts').create({ name: 'Original', details });
      const result = await new SyncManager(operator).applyChange({
        id: 1,
        collection: 'contacts',
        action: 'update',
        data: { id: record.id, name: 'Changed' },
        timestamp: Date.now(),
        baseUpdated: record.updated,
      });
      expect(result).toEqual({ conflict: false, applied: true });
      expect((await operator.collection('contacts').getOne(record.id)).details).toEqual(details);
    },
  );

  it('allows only one concurrent replay of the same revision', async () => {
    const record = await operator.collection('contacts').create({ name: 'Original' });
    await delay(5);
    const results = await Promise.allSettled(
      [operator, peer].map((client, index) =>
        client.send(REPLAY_ROUTE, {
          method: 'POST',
          body: { ...replayBody(record), data: { name: `Edit ${index}` } },
          requestKey: null,
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { status: 409 },
    });
  });

  it.each(['update', 'delete'] as const)(
    'rejects a concurrent %s even when timestamps are identical',
    async (action) => {
      const collection = await admin.collections.getOne('contacts');
      // Deterministically model two writes inside the same timestamp tick.
      await admin.collections.update(collection.id, {
        fields: collection.fields.map((field) =>
          field.name === 'updated' ? { ...field, onUpdate: false } : field,
        ),
      });
      try {
        const record = await operator
          .collection('contacts')
          .create({ name: 'Original', details: { nested: ['a', { value: 1 }] } });
        operator.beforeSend = async (url, options) => {
          if (url.endsWith(REPLAY_ROUTE)) {
            const edited = await peer
              .collection('contacts')
              .update(record.id, { details: { nested: ['a', { value: 2 }] } });
            expect(edited.updated).toBe(record.updated);
          }
          return { url, options };
        };
        const result = await new SyncManager(operator).applyChange({
          id: 1,
          collection: 'contacts',
          action,
          data: { id: record.id, name: 'Offline edit' },
          timestamp: Date.now(),
          baseUpdated: record.updated,
        });
        expect(result).toEqual({ conflict: true, applied: false });
        expect((await peer.collection('contacts').getOne(record.id)).details).toEqual({
          nested: ['a', { value: 2 }],
        });
      } finally {
        operator.beforeSend = undefined;
        await admin.collections.update(collection.id, { fields: collection.fields });
      }
    },
  );

  it('keeps a deleted update target missing and makes repeated deletion idempotent', async () => {
    const record = await operator.collection('contacts').create({ name: 'Original' });
    await peer.collection('contacts').delete(record.id);
    await expect(
      operator.send(REPLAY_ROUTE, {
        method: 'POST',
        body: replayBody(record),
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      await operator.send(REPLAY_ROUTE, {
        method: 'POST',
        body: replayBody(record, 'delete'),
      }),
    ).toEqual({ applied: true });
  });

  it('evaluates conditional rules against the caller and the proposed record body', async () => {
    const collection = await admin.collections.getOne('contacts');
    await admin.collections.update(collection.id, {
      updateRule: `@request.auth.id = '${operator.authStore.record?.id}' && @request.body.name = 'Allowed'`,
    });
    try {
      const record = await operator.collection('contacts').create({ name: 'Original' });
      const allowed = { ...replayBody(record), data: { name: 'Allowed' } };
      await expect(
        peer.send(REPLAY_ROUTE, {
          method: 'POST',
          body: allowed,
        }),
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        operator.send(REPLAY_ROUTE, {
          method: 'POST',
          body: replayBody(record),
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect((await operator.collection('contacts').getOne(record.id)).name).toBe('Original');
      expect(
        await operator.send(REPLAY_ROUTE, {
          method: 'POST',
          body: allowed,
        }),
      ).toEqual({ applied: true });
    } finally {
      await admin.collections.update(collection.id, { updateRule: collection.updateRule });
    }
  });

  it('retains PocketBase field validation and rolls back invalid updates', async () => {
    const record = await operator.collection('contacts').create({ name: 'Original' });
    await expect(
      operator.send(REPLAY_ROUTE, {
        method: 'POST',
        body: { ...replayBody(record), data: { name: '' } },
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect((await peer.collection('contacts').getOne(record.id)).name).toBe('Original');
  });

  it('ignores hidden fields just like ordinary PocketBase updates', async () => {
    const created = await admin
      .collection('contacts')
      .create({ name: 'Original', internal: 'Private' });
    const record = await operator.collection('contacts').getOne(created.id);
    await operator.send(REPLAY_ROUTE, {
      method: 'POST',
      body: { ...replayBody(record), data: { name: 'Changed', internal: 'Overwritten' } },
    });
    expect((await admin.collection('contacts').getOne(record.id)).internal).toBe('Private');
  });

  it('resolves modifiers before applying update rules', async () => {
    const collection = await admin.collections.getOne('contacts');
    await admin.collections.update(collection.id, { updateRule: '@request.body.count <= 2' });
    try {
      const record = await operator.collection('contacts').create({ name: 'Original', count: 1 });
      await expect(
        operator.send(REPLAY_ROUTE, {
          method: 'POST',
          body: { ...replayBody(record), data: { 'count+': 2 } },
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await operator.send(REPLAY_ROUTE, {
          method: 'POST',
          body: { ...replayBody(record), data: { 'count+': 1 } },
        }),
      ).toEqual({ applied: true });
      expect((await operator.collection('contacts').getOne(record.id)).count).toBe(2);
    } finally {
      await admin.collections.update(collection.id, { updateRule: collection.updateRule });
    }
  });

  it('cannot bypass a protected field rule with a modifier', async () => {
    const collection = await admin.collections.getOne('contacts');
    await admin.collections.update(collection.id, {
      updateRule: '@request.body.count:changed = false',
    });
    try {
      const record = await operator.collection('contacts').create({ name: 'Original', count: 1 });
      await expect(
        operator.send(REPLAY_ROUTE, {
          method: 'POST',
          body: { ...replayBody(record), data: { 'count+': 1 } },
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect((await operator.collection('contacts').getOne(record.id)).count).toBe(1);
    } finally {
      await admin.collections.update(collection.id, { updateRule: collection.updateRule });
    }
  });

  it.each(['update', 'delete'])('preserves a locked collection %s rule', async (action) => {
    const record = await operator.collection('notes').create({ name: 'Read only' });
    await expect(
      operator.send(REPLAY_ROUTE, {
        method: 'POST',
        body: replayBody(record, action, 'notes'),
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect((await operator.collection('notes').getOne(record.id)).name).toBe('Read only');
  });

  it('rejects replay for collections outside the offline allowlist', async () => {
    const record = await operator.collection('unrelated').create({ name: 'Untouched' });
    await expect(
      operator.send(REPLAY_ROUTE, {
        method: 'POST',
        body: replayBody(record, 'update', 'unrelated'),
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect((await operator.collection('unrelated').getOne(record.id)).name).toBe('Untouched');
  });

  it('requires authentication before accepting replay', async () => {
    const record = await operator.collection('contacts').create({ name: 'Original' });
    await expect(
      new PocketBase(operator.baseURL).send(REPLAY_ROUTE, {
        method: 'POST',
        body: replayBody(record),
      }),
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe('guarded Servers sync against isolated PocketBase', () => {
  const route = '/api/relay/servers/sync';
  const send = (client: PocketBase, operations: Record<string, unknown>[]) =>
    client.send<{ status: number; body: RecordModel | null }[]>(route, {
      method: 'POST',
      body: { operations },
      requestKey: null,
    });

  it('creates, updates and removes with ordinary permissions and confirmed records', async () => {
    const created = await send(operator, [{ action: 'create', data: { name: 'New server' } }]);
    const record = created[0]!.body!;
    expect(record.id).toHaveLength(15);
    expect(record.updated).toBeTruthy();
    const updated = await send(operator, [
      { action: 'update', recordId: record.id, expected: record, data: { name: 'Updated server' } },
    ]);
    expect(updated[0]!.body!.name).toBe('Updated server');
    await send(operator, [{ action: 'delete', recordId: record.id, expected: updated[0]!.body }]);
    await expect(operator.collection('servers').getOne(record.id)).rejects.toMatchObject({
      status: 404,
    });
  });

  it.each(['update', 'delete'])(
    'preserves an edit made after the reviewed read and before %s',
    async (action) => {
      const record = await operator.collection('servers').create({ name: 'Reviewed' });
      await peer.collection('servers').update(record.id, { name: 'Peer renamed server' });
      await expect(
        send(operator, [
          {
            action,
            recordId: record.id,
            expected: record,
            ...(action === 'update' ? { data: { name: 'Import' } } : {}),
          },
        ]),
      ).rejects.toMatchObject({ status: 409 });
      expect((await operator.collection('servers').getOne(record.id)).name).toBe(
        'Peer renamed server',
      );
    },
  );

  it('rolls back earlier batch writes when a later target changed', async () => {
    const first = await operator.collection('servers').create({ name: 'First' });
    const second = await operator.collection('servers').create({ name: 'Second' });
    await peer.collection('servers').update(second.id, { name: 'Peer second' });
    await expect(
      send(operator, [
        {
          action: 'update',
          recordId: first.id,
          expected: first,
          data: { name: 'Should roll back' },
        },
        { action: 'delete', recordId: second.id, expected: second },
      ]),
    ).rejects.toMatchObject({ status: 409 });
    expect((await peer.collection('servers').getOne(first.id)).name).toBe('First');
    expect((await peer.collection('servers').getOne(second.id)).name).toBe('Peer second');
  });

  it('compares full content when the revision timestamp is unchanged', async () => {
    const collection = await admin.collections.getOne('servers');
    await admin.collections.update(collection.id, {
      fields: collection.fields.map((field) =>
        field.name === 'updated' ? { ...field, onUpdate: false } : field,
      ),
    });
    try {
      const record = await operator
        .collection('servers')
        .create({ name: 'Same tick', details: { a: 1, expand: 'Reviewed nested JSON' } });
      const changed = await peer
        .collection('servers')
        .update(record.id, { details: { a: 1, expand: 'Peer nested JSON' } });
      expect(changed.updated).toBe(record.updated);
      await expect(
        send(operator, [{ action: 'delete', recordId: record.id, expected: record }]),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      await admin.collections.update(collection.id, { fields: collection.fields });
    }
  });

  it('enforces caller/body rules, field validation and hidden-field protection', async () => {
    const created = await admin
      .collection('servers')
      .create({ name: 'Original', internal: 'Private', count: 1 });
    const record = await operator.collection('servers').getOne(created.id);
    const collection = await admin.collections.getOne('servers');
    await admin.collections.update(collection.id, {
      updateRule: `@request.auth.id = '${operator.authStore.record?.id}' && @request.body.count <= 2`,
    });
    const operation = {
      action: 'update',
      recordId: record.id,
      expected: record,
      data: { name: 'Valid', internal: 'Leaked overwrite', 'count+': 1 },
    };
    try {
      await expect(send(peer, [operation])).rejects.toMatchObject({ status: 403 });
      await expect(send(operator, [{ ...operation, data: { 'count+': 2 } }])).rejects.toMatchObject(
        { status: 403 },
      );
      await expect(
        send(operator, [{ ...operation, data: { name: '', count: 2 } }]),
      ).rejects.toMatchObject({ status: 400 });
      await send(operator, [operation]);
      expect((await admin.collection('servers').getOne(record.id)).internal).toBe('Private');
    } finally {
      await admin.collections.update(collection.id, { updateRule: collection.updateRule });
    }
  });

  it('requires authentication and rejects oversized batches', async () => {
    await expect(
      send(new PocketBase(operator.baseURL), [
        { action: 'create', data: { name: 'Unauthorized' } },
      ]),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      send(
        operator,
        Array.from({ length: 101 }, () => ({ action: 'create', data: { name: 'Too many' } })),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('atomic alert retention against isolated PocketBase', () => {
  const route = '/api/relay/retention/alert-history';
  it('preserves a pin acknowledged after the candidate read but before pruning', async () => {
    const alert = await operator
      .collection('alert_history')
      .create({ pinned: false, created: '2020-01-01 00:00:00.000Z' });
    const selected = await admin
      .collection('alert_history')
      .getFullList({ filter: 'pinned=false' });
    expect(selected.map((row) => row.id)).toContain(alert.id);
    admin.beforeSend = async (url, options) => {
      if (url.endsWith(route))
        await peer.collection('alert_history').update(alert.id, { pinned: true });
      return { url, options };
    };
    try {
      expect(await admin.send(route, { method: 'POST' })).toEqual({ deleted: 0 });
      expect((await operator.collection('alert_history').getOne(alert.id)).pinned).toBe(true);
    } finally {
      admin.beforeSend = undefined;
      await admin.collection('alert_history').delete(alert.id);
    }
  });

  it('retains the newest 50 unpinned and 100 pinned, applying expiry only to unpinned', async () => {
    const now = Date.now();
    for (const pinned of [false, true]) {
      const count = pinned ? 102 : 55;
      for (let index = 0; index < count; index++) {
        await admin
          .collection('alert_history')
          .create({ pinned, created: new Date(now - index * 1000).toISOString() });
      }
    }
    for (let index = 0; index < 2; index++)
      await admin
        .collection('alert_history')
        .create({ pinned: false, created: '2020-01-01 00:00:00.000Z' });
    expect(await admin.send(route, { method: 'POST' })).toEqual({ deleted: 9 });
    const remaining = await admin.collection('alert_history').getFullList({ sort: '-created,-id' });
    expect(remaining.filter((row) => row.pinned)).toHaveLength(100);
    expect(remaining.filter((row) => !row.pinned)).toHaveLength(50);
    expect(remaining.some((row) => row.created.startsWith('2020'))).toBe(false);
    expect(await admin.send(route, { method: 'POST' })).toEqual({ deleted: 0 });
  });

  it('rejects unauthenticated and ordinary callers', async () => {
    await expect(
      new PocketBase(admin.baseURL).send(route, { method: 'POST' }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(operator.send(route, { method: 'POST' })).rejects.toMatchObject({ status: 403 });
  });
});
