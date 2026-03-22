import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
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
});
