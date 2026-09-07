import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { SyncManager } from './SyncManager';
import { PendingChanges, type PendingChange } from './PendingChanges';

/** Index into an array, failing loudly rather than silently yielding `undefined`. */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Expected an element at index ${index} (length ${items.length})`);
  }
  return item;
}

type ReplayRequest = {
  collection: string;
  action: 'update' | 'delete';
  recordId: string;
  expectedUpdated: string;
  expectedFingerprint: string;
  data?: Record<string, unknown>;
};

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonKeys);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort((left, right) => {
          if (left === right) return 0;
          return left < right ? -1 : 1;
        })
        .map((key) => [key, sortJsonKeys(record[key])]),
    );
  }
  return value;
}

function createFakePb(
  options: {
    records?: Map<string, Record<string, unknown>>;
    authValid?: boolean;
  } = {},
) {
  const records = options.records ?? new Map();
  const authValid = options.authValid ?? true;
  const calls: Array<{ method: string; collection: string; id?: string; data?: unknown }> = [];

  return {
    calls,
    authStore: {
      get isValid() {
        return authValid;
      },
      token: authValid ? 'fake-token' : '',
    },
    async send(url: string, options: { method: string; body: ReplayRequest; requestKey: null }) {
      if (url !== '/api/relay/offline/replay' || options.method !== 'POST') {
        throw Object.assign(new Error('Route not found'), { status: 404 });
      }
      const { collection, action, recordId, expectedUpdated, expectedFingerprint, data } =
        options.body;
      calls.push({ method: `replay-${action}`, collection, id: recordId, data });
      const existing = records.get(recordId);
      if (
        !existing ||
        existing.updated !== expectedUpdated ||
        createHash('sha256')
          .update(JSON.stringify(sortJsonKeys(existing)))
          .digest('hex') !== expectedFingerprint
      ) {
        throw Object.assign(new Error('Revision changed'), { status: 409 });
      }
      if (action === 'delete') {
        records.delete(recordId);
      } else {
        records.set(recordId, { ...existing, ...data, updated: new Date().toISOString() });
      }
      return { applied: true };
    },
    collection(name: string) {
      return {
        async create(data: Record<string, unknown>) {
          calls.push({ method: 'create', collection: name, data });
          // Use a counter-based suffix to avoid triggering pseudo-random lint rules
          const id = `rec_${Date.now()}_${String(calls.length).padStart(4, '0')}`;
          records.set(id, {
            ...data,
            id,
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
          });
          return records.get(id);
        },
        async update(id: string, data: Record<string, unknown>) {
          calls.push({ method: 'update', collection: name, id, data });
          const existing = records.get(id);
          if (!existing) {
            const err = new Error('Not found');
            (err as unknown as { status: number }).status = 404;
            throw err;
          }
          records.set(id, { ...existing, ...data, updated: new Date().toISOString() });
          return records.get(id);
        },
        async delete(id: string) {
          calls.push({ method: 'delete', collection: name, id });
          if (!records.has(id)) {
            const err = new Error('Not found');
            (err as unknown as { status: number }).status = 404;
            throw err;
          }
          records.delete(id);
        },
        async getOne(id: string) {
          calls.push({ method: 'getOne', collection: name, id });
          const rec = records.get(id);
          if (!rec) {
            const err = new Error('Not found');
            (err as unknown as { status: number }).status = 404;
            throw err;
          }
          return rec;
        },
      };
    },
  };
}

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-test-'));
  return path.join(dir, 'pending.db');
}

describe('SyncManager integration tests', () => {
  let dbPath: string;
  let pendingChanges: PendingChanges;

  beforeEach(() => {
    dbPath = makeTempDbPath();
    pendingChanges = new PendingChanges(dbPath);
  });

  afterEach(() => {
    pendingChanges.close();
    // Clean up temp db directory
    const dir = path.dirname(dbPath);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('mixed batch: create + update + delete, no errors, then drain queue', async () => {
    // Pre-seed a record so the update can find it
    const existingId = 'rec_existing_001';
    const serverRecords = new Map<string, Record<string, unknown>>();
    serverRecords.set(existingId, {
      id: existingId,
      name: 'Old Name',
      created: new Date(Date.now() - 60_000).toISOString(),
      updated: new Date(Date.now() - 60_000).toISOString(),
    });

    // Pre-seed a record to delete
    const deleteId = 'rec_delete_001';
    serverRecords.set(deleteId, {
      id: deleteId,
      name: 'To Delete',
      created: new Date(Date.now() - 60_000).toISOString(),
      updated: new Date(Date.now() - 60_000).toISOString(),
    });

    const fakePb = createFakePb({ records: serverRecords });
    const manager = new SyncManager(fakePb as never);

    // Enqueue all three changes
    pendingChanges.enqueue('notes', 'create', { title: 'New Note', content: 'Hello' });
    pendingChanges.enqueue('notes', 'update', {
      id: existingId,
      name: 'Updated Name',
    });
    pendingChanges.enqueue('notes', 'delete', { id: deleteId });

    const changes = pendingChanges.getAll();
    expect(changes).toHaveLength(3);

    const result = await manager.syncAll(changes);

    expect(result.total).toBe(3);
    expect(result.conflicts).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.synced).toEqual([1, 2, 3]);
    expect(serverRecords.get(existingId)).toMatchObject({ name: 'Updated Name' });
    expect(serverRecords.has(deleteId)).toBe(false);

    // Verify PB methods were called for each action
    const methods = fakePb.calls.map((c) => c.method);
    expect(methods).toContain('create');
    expect(methods).toContain('getOne'); // update and delete read their expected revision first
    expect(methods).toContain('replay-update');
    expect(methods).toContain('replay-delete');
    expect(methods).not.toContain('update');
    expect(methods).not.toContain('delete');

    // Drain only acknowledged changes from the queue.
    for (const changeId of result.synced) {
      pendingChanges.remove(changeId);
    }
    expect(pendingChanges.getAll()).toHaveLength(0);
  });

  it.each([
    { action: 'update', updated: '2026-03-20T10:00:00Z' },
    { action: 'delete', updated: '2026-03-20T10:00:00Z' },
    { action: 'update', updated: '2026-03-20T10:01:00Z' },
    { action: 'delete', updated: '2026-03-20T10:01:00Z' },
  ] as const)(
    'retains the queued $action and concurrent server edit at $updated',
    async ({ action, updated }) => {
      const recordId = 'rec_concurrent_001';
      const baseUpdated = '2026-03-20T10:00:00Z';
      const serverRecords = new Map<string, Record<string, unknown>>([
        [recordId, { id: recordId, name: 'Original', updated: baseUpdated }],
      ]);
      const fakePb = createFakePb({ records: serverRecords });
      const concurrentEdit = {
        id: recordId,
        name: 'Concurrent server edit',
        updated,
      };
      const manager = new SyncManager({
        ...fakePb,
        send: async (...args: Parameters<typeof fakePb.send>) => {
          serverRecords.set(recordId, concurrentEdit);
          return fakePb.send(...args);
        },
      } as never);
      const changeId = pendingChanges.enqueue(
        'notes',
        action,
        { id: recordId, name: 'Offline version' },
        baseUpdated,
      );

      const result = await manager.syncAll(pendingChanges.getAll());
      for (const syncedId of result.synced) pendingChanges.remove(syncedId);

      expect(result.synced).toEqual([]);
      expect(result.conflicts).toBe(1);
      expect(result.conflicted).toEqual([changeId]);
      expect(result.errors).toEqual([]);
      expect(serverRecords.get(recordId)).toEqual(concurrentEdit);
      expect(pendingChanges.getAll()).toMatchObject([
        { id: changeId, action, data: { id: recordId, name: 'Offline version' }, baseUpdated },
      ]);
    },
  );

  it('conflict detection: older client timestamp triggers conflict_log create', async () => {
    const recordId = 'rec_conflict_001';
    const serverRecords = new Map<string, Record<string, unknown>>();
    // Server record was updated AFTER the client's change
    const serverUpdatedTime = Date.now();
    serverRecords.set(recordId, {
      id: recordId,
      name: 'Server Version',
      created: new Date(serverUpdatedTime - 10_000).toISOString(),
      updated: new Date(serverUpdatedTime).toISOString(),
    });

    const fakePb = createFakePb({ records: serverRecords });
    const manager = new SyncManager(fakePb as never);

    // Client change has an older timestamp than the server record
    const clientTimestamp = serverUpdatedTime - 5_000;
    const change: PendingChange = {
      id: 1,
      collection: 'notes',
      action: 'update',
      data: { id: recordId, name: 'Client Version' },
      timestamp: clientTimestamp,
    };

    const result = await manager.syncAll([change]);

    expect(result.conflicts).toBe(1);
    expect(result.errors).toHaveLength(0);

    // conflict_log.create should have been called
    const conflictLogCalls = fakePb.calls.filter(
      (c) => c.method === 'create' && c.collection === 'conflict_log',
    );
    expect(conflictLogCalls).toHaveLength(1);
    expect(at(conflictLogCalls, 0).data).toMatchObject({
      collection: 'notes',
      recordId,
      overwrittenBy: 'client',
    });
  });

  it('fallback to create when update target record does not exist (404)', async () => {
    const fakePb = createFakePb({ records: new Map() });
    const manager = new SyncManager(fakePb as never);

    const missingId = 'rec_missing_001';
    const change: PendingChange = {
      id: 1,
      collection: 'contacts',
      action: 'update',
      data: { id: missingId, name: 'Fallback Created' },
      timestamp: Date.now(),
    };

    const result = await manager.syncAll([change]);

    expect(result.conflicts).toBe(0);
    expect(result.errors).toHaveLength(0);

    // getOne should have been tried and failed, then create should have been called
    const getOneCalls = fakePb.calls.filter(
      (c) => c.method === 'getOne' && c.collection === 'contacts',
    );
    expect(getOneCalls).toHaveLength(1);

    const createCalls = fakePb.calls.filter(
      (c) => c.method === 'create' && c.collection === 'contacts',
    );
    expect(createCalls).toHaveLength(1);
    expect((at(createCalls, 0).data as Record<string, unknown>).id).toBe('rec_missing_001');
  });

  it('progress callback: called once per change with correct counts', async () => {
    const fakePb = createFakePb();
    const manager = new SyncManager(fakePb as never);

    const changes: PendingChange[] = [
      { id: 1, collection: 'c', action: 'create', data: { title: 'A' }, timestamp: Date.now() },
      { id: 2, collection: 'c', action: 'create', data: { title: 'B' }, timestamp: Date.now() },
      { id: 3, collection: 'c', action: 'create', data: { title: 'C' }, timestamp: Date.now() },
    ];

    const progressCalls: Array<[number, number]> = [];
    await manager.syncAll(changes, (processed, total) => {
      progressCalls.push([processed, total]);
    });

    expect(progressCalls).toHaveLength(3);
    expect(progressCalls[0]).toEqual([1, 3]);
    expect(progressCalls[1]).toEqual([2, 3]);
    expect(progressCalls[2]).toEqual([3, 3]);
  });

  it('delete already-deleted record: 404 is swallowed, no error', async () => {
    const fakePb = createFakePb({ records: new Map() }); // empty — record does not exist
    const manager = new SyncManager(fakePb as never);

    const change: PendingChange = {
      id: 1,
      collection: 'items',
      action: 'delete',
      data: { id: 'rec_gone_001' },
      timestamp: Date.now(),
    };

    const result = await manager.syncAll([change]);

    expect(result.total).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(result.conflicts).toBe(0);
    expect(result.synced).toEqual([1]);
    expect(fakePb.calls.map((call) => call.method)).toEqual(['getOne']);
  });

  it('error accumulation: failing create is recorded but other changes still process', async () => {
    const serverRecords = new Map<string, Record<string, unknown>>();
    const fakePb = createFakePb({ records: serverRecords });

    // Override one collection's create to throw
    const originalCollection = fakePb.collection.bind(fakePb);
    let callCount = 0;
    const patchedPb = {
      ...fakePb,
      collection(name: string) {
        const col = originalCollection(name);
        if (name === 'broken') {
          return {
            ...col,
            async create(_data: Record<string, unknown>) {
              callCount++;
              throw new Error('DB write failed');
            },
          };
        }
        return col;
      },
    };

    const syncManager = new SyncManager(patchedPb as never);

    const changes: PendingChange[] = [
      {
        id: 1,
        collection: 'broken',
        action: 'create',
        data: { title: 'Will fail' },
        timestamp: Date.now(),
      },
      {
        id: 2,
        collection: 'good',
        action: 'create',
        data: { title: 'Will succeed' },
        timestamp: Date.now(),
      },
      {
        id: 3,
        collection: 'good',
        action: 'create',
        data: { title: 'Also succeeds' },
        timestamp: Date.now(),
      },
    ];

    const result = await syncManager.syncAll(changes);

    expect(result.total).toBe(3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('broken');

    // The two good creates should have been processed
    const goodCalls = fakePb.calls.filter((c) => c.method === 'create' && c.collection === 'good');
    expect(goodCalls).toHaveLength(2);
    expect(callCount).toBe(1); // broken was attempted once
  });

  it('isAuthenticated: reflects authStore.isValid', () => {
    const authenticatedPb = createFakePb({ authValid: true });
    const unauthenticatedPb = createFakePb({ authValid: false });

    const authenticatedManager = new SyncManager(authenticatedPb as never);
    const unauthenticatedManager = new SyncManager(unauthenticatedPb as never);

    expect(authenticatedManager.isAuthenticated()).toBe(true);
    expect(unauthenticatedManager.isAuthenticated()).toBe(false);
  });
});
