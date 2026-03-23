import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { PendingChanges } from './PendingChanges';

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
    expect(all[0].collection).toBe('contacts');
    expect(all[0].action).toBe('create');
    expect(all[2].collection).toBe('servers');
  });

  it('removes a specific change after processing', () => {
    pending.enqueue('contacts', 'create', { id: '1', name: 'Alice' });
    pending.enqueue('contacts', 'update', { id: '1', name: 'Alice B' });

    const all = pending.getAll();
    pending.remove(all[0].id);

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
    expect(all[0].data).toEqual({ id: '1', name: 'Updated', email: 'a@b.com' });
  });

  // --- New tests ---

  it('enqueue create stores correct action and collection', () => {
    pending.enqueue('contacts', 'create', { id: '10', name: 'Carol' });
    const all = pending.getAll();
    expect(all[0].action).toBe('create');
    expect(all[0].collection).toBe('contacts');
  });

  it('enqueue update stores correct action', () => {
    pending.enqueue('servers', 'update', { id: 'srv1', host: 'web-01' });
    expect(pending.getAll()[0].action).toBe('update');
  });

  it('enqueue delete stores correct action', () => {
    pending.enqueue('oncall', 'delete', { id: 'oc-1' });
    expect(pending.getAll()[0].action).toBe('delete');
  });

  it('getAll returns changes ordered by id (insertion order)', () => {
    pending.enqueue('a', 'create', { id: '1' });
    pending.enqueue('b', 'create', { id: '2' });
    pending.enqueue('c', 'create', { id: '3' });

    const all = pending.getAll();
    expect(all[0].collection).toBe('a');
    expect(all[1].collection).toBe('b');
    expect(all[2].collection).toBe('c');
    // IDs must be ascending
    expect(all[0].id).toBeLessThan(all[1].id);
    expect(all[1].id).toBeLessThan(all[2].id);
  });

  it('remove only deletes the targeted id, leaving others intact', () => {
    pending.enqueue('contacts', 'create', { id: '1' });
    pending.enqueue('contacts', 'create', { id: '2' });
    pending.enqueue('contacts', 'create', { id: '3' });

    const all = pending.getAll();
    pending.remove(all[1].id); // remove middle

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
    expect(all[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(all[0].timestamp).toBeLessThanOrEqual(after);
  });

  it('queue ordering is by timestamp (ascending id reflects insertion time)', () => {
    // Verify that later-inserted items sort after earlier ones
    pending.enqueue('a', 'create', { id: '1' });
    pending.enqueue('b', 'update', { id: '2' });

    const all = pending.getAll();
    // Second item timestamp should be >= first
    expect(all[1].timestamp).toBeGreaterThanOrEqual(all[0].timestamp);
  });

  it('DB file is created on disk (WAL mode initialisation)', () => {
    const dbPath = join(tempDir, 'pending.db');
    expect(existsSync(dbPath)).toBe(true);
  });

  it('each record has a numeric autoincrement id', () => {
    pending.enqueue('contacts', 'create', { id: '1' });
    pending.enqueue('contacts', 'create', { id: '2' });
    const all = pending.getAll();
    expect(typeof all[0].id).toBe('number');
    expect(typeof all[1].id).toBe('number');
    expect(all[1].id).toBe(all[0].id + 1);
  });

  it('enqueue preserves nested data structures', () => {
    const data = { id: 'x', meta: { tags: ['a', 'b'], active: true }, count: 42 };
    pending.enqueue('misc', 'create', data);
    expect(pending.getAll()[0].data).toEqual(data);
  });

  it('timestamp uses Date.now — mock confirms it calls the real clock', () => {
    const spy = vi.spyOn(Date, 'now').mockReturnValue(1234567890000);
    pending.enqueue('contacts', 'create', { id: '1' });
    spy.mockRestore();
    const all = pending.getAll();
    expect(all[0].timestamp).toBe(1234567890000);
  });
});
