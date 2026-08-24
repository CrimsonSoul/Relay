import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { PendingChanges } from './PendingChanges';
import Database from 'better-sqlite3';

/** Index into an array, failing loudly rather than silently yielding `undefined`. */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Expected an element at index ${index} (length ${items.length})`);
  }
  return item;
}

describe('PendingChanges', () => {
  let tempDir: string;
  let pending: PendingChanges;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'relay-pending-'));
    pending = new PendingChanges(join(tempDir, 'pending.db'));
  });

  afterEach(() => {
    pending.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('starts with empty queue', () => {
    expect(pending.getAll()).toEqual([]);
  });

  it('enqueues and retrieves changes in order', () => {
    pending.enqueue('contacts', 'create', { id: '1', name: 'Alice' });
    pending.enqueue('contacts', 'update', { id: '1', name: 'Alice B' });
    pending.enqueue('servers', 'create', { id: '2', name: 'srv1' });

    const all = pending.getAll();
    expect(all).toHaveLength(3);
    expect(at(all, 0).collection).toBe('contacts');
    expect(at(all, 0).action).toBe('create');
    expect(at(all, 2).collection).toBe('servers');
  });

  it('removes a specific change after processing', () => {
    pending.enqueue('contacts', 'create', { id: '1', name: 'Alice' });
    pending.enqueue('contacts', 'update', { id: '1', name: 'Alice B' });

    const all = pending.getAll();
    pending.remove(at(all, 0).id);

    expect(pending.getAll()).toHaveLength(1);
  });

  it('clears all pending changes', () => {
    pending.enqueue('contacts', 'create', { id: '1', name: 'Alice' });
    pending.enqueue('servers', 'create', { id: '2', name: 'srv1' });

    pending.clear();
    expect(pending.getAll()).toEqual([]);
  });

  it('stores the snapshot of the record at time of change', () => {
    pending.enqueue('contacts', 'update', { id: '1', name: 'Updated', email: 'a@b.com' });
    const all = pending.getAll();
    expect(at(all, 0).data).toEqual({ id: '1', name: 'Updated', email: 'a@b.com' });
  });

  it('persists the server revision used as the base of an offline edit', () => {
    pending.enqueue('contacts', 'update', { id: '1', name: 'Updated' }, '2026-07-10T12:34:56.000Z');

    expect(at(pending.getAll(), 0).baseUpdated).toBe('2026-07-10T12:34:56.000Z');
  });

  it('persists sync failures so reconnect issues remain visible after restart', () => {
    const id = pending.enqueue('contacts', 'update', { id: '1', name: 'Updated' });
    pending.markFailure(id, 'Server conflict');

    expect(at(pending.getAll(), 0).syncError).toBe('Server conflict');
  });

  it('fails strict migration reads instead of treating malformed rows as an empty queue', () => {
    const dbPath = join(tempDir, 'pending.db');
    pending.close();
    const raw = new Database(dbPath);
    raw
      .prepare(
        'INSERT INTO pending_changes (collection, action, data, timestamp) VALUES (?, ?, ?, ?)',
      )
      .run('contacts', 'update', '{malformed-json', Date.now());
    raw.close();
    pending = new PendingChanges(dbPath);

    expect(() => pending.getAllStrict()).toThrow();
  });

  it('coalesces repeated offline updates and preserves the original base revision', () => {
    pending.enqueueCoalesced(
      'contacts',
      'update',
      { id: '1', name: 'First edit' },
      '2026-07-10T12:00:00.000Z',
    );
    pending.enqueueCoalesced(
      'contacts',
      'update',
      { id: '1', name: 'Second edit' },
      '2026-07-10T12:05:00.000Z',
    );

    expect(pending.getAll()).toEqual([
      expect.objectContaining({
        action: 'update',
        data: { id: '1', name: 'Second edit' },
        baseUpdated: '2026-07-10T12:00:00.000Z',
      }),
    ]);
  });

  it('folds an update after an offline create into the queued create', () => {
    pending.enqueueCoalesced('contacts', 'create', { id: '1', name: 'Draft' });
    pending.enqueueCoalesced('contacts', 'update', { id: '1', name: 'Final' });

    expect(pending.getAll()).toEqual([
      expect.objectContaining({ action: 'create', data: { id: '1', name: 'Final' } }),
    ]);
  });

  it('cancels a create that is deleted before reconnect', () => {
    pending.enqueueCoalesced('contacts', 'create', { id: '1', name: 'Draft' });
    const result = pending.enqueueCoalesced('contacts', 'delete', { id: '1' });

    expect(result.id).toBeNull();
    expect(pending.getAll()).toEqual([]);
  });

  // --- New tests ---

  it('enqueue create stores correct action and collection', () => {
    pending.enqueue('contacts', 'create', { id: '10', name: 'Carol' });
    const all = pending.getAll();
    expect(at(all, 0).action).toBe('create');
    expect(at(all, 0).collection).toBe('contacts');
  });

  it('enqueue update stores correct action', () => {
    pending.enqueue('servers', 'update', { id: 'srv1', host: 'web-01' });
    expect(at(pending.getAll(), 0).action).toBe('update');
  });

  it('enqueue delete stores correct action', () => {
    pending.enqueue('oncall', 'delete', { id: 'oc-1' });
    expect(at(pending.getAll(), 0).action).toBe('delete');
  });

  it('getAll returns changes ordered by id (insertion order)', () => {
    pending.enqueue('a', 'create', { id: '1' });
    pending.enqueue('b', 'create', { id: '2' });
    pending.enqueue('c', 'create', { id: '3' });

    const all = pending.getAll();
    expect(at(all, 0).collection).toBe('a');
    expect(at(all, 1).collection).toBe('b');
    expect(at(all, 2).collection).toBe('c');
    // IDs must be ascending
    expect(at(all, 0).id).toBeLessThan(at(all, 1).id);
    expect(at(all, 1).id).toBeLessThan(at(all, 2).id);
  });

  it('remove only deletes the targeted id, leaving others intact', () => {
    pending.enqueue('contacts', 'create', { id: '1' });
    pending.enqueue('contacts', 'create', { id: '2' });
    pending.enqueue('contacts', 'create', { id: '3' });

    const all = pending.getAll();
    pending.remove(at(all, 1).id); // remove middle

    const remaining = pending.getAll();
    expect(remaining).toHaveLength(2);
    expect(remaining.map((r) => r.data)).toEqual([{ id: '1' }, { id: '3' }]);
  });

  it('remove with non-existent id is a no-op', () => {
    pending.enqueue('contacts', 'create', { id: '1' });
    pending.remove(999999);
    expect(pending.getAll()).toHaveLength(1);
  });

  it('clear on empty queue does not throw', () => {
    expect(() => pending.clear()).not.toThrow();
    expect(pending.getAll()).toEqual([]);
  });

  it('each enqueued change has a numeric timestamp', () => {
    const before = Date.now();
    pending.enqueue('contacts', 'create', { id: '1' });
    const after = Date.now();

    const all = pending.getAll();
    expect(at(all, 0).timestamp).toBeGreaterThanOrEqual(before);
    expect(at(all, 0).timestamp).toBeLessThanOrEqual(after);
  });

  it('queue ordering is by timestamp (ascending id reflects insertion time)', () => {
    // Verify that later-inserted items sort after earlier ones
    pending.enqueue('a', 'create', { id: '1' });
    pending.enqueue('b', 'update', { id: '2' });

    const all = pending.getAll();
    // Second item timestamp should be >= first
    expect(at(all, 1).timestamp).toBeGreaterThanOrEqual(at(all, 0).timestamp);
  });

  it('DB file is created on disk (WAL mode initialisation)', () => {
    const dbPath = join(tempDir, 'pending.db');
    expect(existsSync(dbPath)).toBe(true);
  });

  it('checkpoints queued mutations before a recovery handoff', () => {
    pending.enqueue('contacts', 'update', { id: 'contact-1', name: 'Queued' });

    expect(pending.checkpoint()).toBe(true);
  });

  it('each record has a numeric autoincrement id', () => {
    pending.enqueue('contacts', 'create', { id: '1' });
    pending.enqueue('contacts', 'create', { id: '2' });
    const all = pending.getAll();
    expect(typeof at(all, 0).id).toBe('number');
    expect(typeof at(all, 1).id).toBe('number');
    expect(at(all, 1).id).toBe(at(all, 0).id + 1);
  });

  it('enqueue preserves nested data structures', () => {
    const data = { id: 'x', meta: { tags: ['a', 'b'], active: true }, count: 42 };
    pending.enqueue('misc', 'create', data);
    expect(at(pending.getAll(), 0).data).toEqual(data);
  });

  it('timestamp uses Date.now — mock confirms it calls the real clock', () => {
    const spy = vi.spyOn(Date, 'now').mockReturnValue(1234567890000);
    pending.enqueue('contacts', 'create', { id: '1' });
    spy.mockRestore();
    const all = pending.getAll();
    expect(at(all, 0).timestamp).toBe(1234567890000);
  });

  it('enqueue throws when the insert fails', () => {
    const failingPending = new PendingChanges(join(tempDir, 'failing.db'));
    failingPending.close(); // closed db -> insert throws
    expect(() => failingPending.enqueue('contacts', 'create', { id: 'x' })).toThrow();
  });
});
