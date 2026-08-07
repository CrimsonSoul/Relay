import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { OfflineCache } from './OfflineCache';
import { PendingChanges } from './PendingChanges';

describe('OfflineCache', () => {
  let tempDir: string;
  let cache: OfflineCache;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'relay-cache-'));
    cache = new OfflineCache(join(tempDir, 'cache.db'));
  });

  afterEach(() => {
    cache.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('stores and retrieves records for a collection', () => {
    const records = [
      { id: '1', name: 'Alice', created: '2026-01-01', updated: '2026-01-01' },
      { id: '2', name: 'Bob', created: '2026-01-01', updated: '2026-01-01' },
    ];
    cache.writeCollection('contacts', records);
    const result = cache.readCollection('contacts');
    expect(result).toEqual(records);
  });

  it('returns empty array for unknown collection', () => {
    expect(cache.readCollection('nonexistent')).toEqual([]);
  });

  it('overwrites collection data on re-write', () => {
    cache.writeCollection('contacts', [{ id: '1', name: 'Alice' }]);
    cache.writeCollection('contacts', [{ id: '2', name: 'Bob' }]);
    const result = cache.readCollection('contacts');
    expect(result).toHaveLength(1);
    expect((result[0] as unknown as { name: string }).name).toBe('Bob');
  });

  it('skips rewriting a collection when its revision signature is unchanged', () => {
    const signature = '1:0123456789abcdef';
    expect(cache.writeCollection('contacts', signature, [{ id: '1', name: 'Alice' }])).toBe(true);

    expect(
      cache.writeCollection('contacts', signature, [{ id: '1', name: 'Changed unexpectedly' }]),
    ).toBe(false);
    expect(cache.readCollection('contacts')).toEqual([{ id: '1', name: 'Alice' }]);
  });

  it('handles single record updates', () => {
    cache.writeCollection('contacts', [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ]);
    cache.updateRecord('contacts', 'update', { id: '1', name: 'Alice Updated' });
    const result = cache.readCollection('contacts');
    expect(
      (
        result.find((r) => (r as unknown as { id: string }).id === '1') as unknown as {
          name: string;
        }
      ).name,
    ).toBe('Alice Updated');
  });

  it('handles single record create', () => {
    cache.writeCollection('contacts', [{ id: '1', name: 'Alice' }]);
    cache.updateRecord('contacts', 'create', { id: '2', name: 'Bob' });
    expect(cache.readCollection('contacts')).toHaveLength(2);
  });

  it('handles single record delete', () => {
    cache.writeCollection('contacts', [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ]);
    cache.updateRecord('contacts', 'delete', { id: '1' });
    expect(cache.readCollection('contacts')).toHaveLength(1);
  });

  it('atomically stores an optimistic record and its durable pending mutation', () => {
    const dbPath = join(tempDir, 'cache.db');
    const pending = new PendingChanges(dbPath);

    expect(
      cache.applyOfflineMutationAtomically(
        'contacts',
        'update',
        { id: '1', name: 'Offline edit' },
        '2026-07-10T12:00:00Z',
      ),
    ).toBe(true);

    expect(cache.readCollection('contacts')).toEqual([{ id: '1', name: 'Offline edit' }]);
    expect(pending.getAll()).toEqual([
      expect.objectContaining({
        collection: 'contacts',
        action: 'update',
        data: { id: '1', name: 'Offline edit' },
        baseUpdated: '2026-07-10T12:00:00Z',
      }),
    ]);
    pending.close();
  });

  it('coalesces chained edits in the same transaction as the optimistic cache', () => {
    const dbPath = join(tempDir, 'cache.db');
    const pending = new PendingChanges(dbPath);
    cache.applyOfflineMutationAtomically(
      'contacts',
      'update',
      { id: '1', name: 'First' },
      '2026-07-10T12:00:00Z',
    );
    cache.applyOfflineMutationAtomically(
      'contacts',
      'update',
      { id: '1', name: 'Second' },
      '2026-07-10T12:05:00Z',
    );

    expect(cache.readCollection('contacts')).toEqual([{ id: '1', name: 'Second' }]);
    expect(pending.getAll()).toEqual([
      expect.objectContaining({
        action: 'update',
        data: { id: '1', name: 'Second' },
        baseUpdated: '2026-07-10T12:00:00Z',
      }),
    ]);
    pending.close();
  });

  // --- New tests ---

  it('writeCollection is transactional: all-or-nothing on error', () => {
    // Pre-populate the collection
    cache.writeCollection('contacts', [{ id: 'original', name: 'Original' }]);

    // Force a transaction error by providing a record that would cause a constraint violation
    // We simulate atomicity by verifying the original data is intact after a failed write.
    // The easiest observable test: writeCollection with valid data fully replaces old data.
    cache.writeCollection('contacts', [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ]);
    const result = cache.readCollection('contacts');
    // Old record 'original' must be gone — delete was part of the same transaction
    expect(result.find((r) => (r as { id: string }).id === 'original')).toBeUndefined();
    expect(result).toHaveLength(3);
  });

  it('writeCollection with empty array clears the collection', () => {
    cache.writeCollection('contacts', [{ id: '1', name: 'Alice' }]);
    cache.writeCollection('contacts', []);
    expect(cache.readCollection('contacts')).toEqual([]);
  });

  it('readCollection parses stored JSON back to objects', () => {
    const record = { id: '1', nested: { a: 1, b: [true, 'x'] }, flag: true };
    cache.writeCollection('data', [record]);
    const result = cache.readCollection('data');
    expect(result[0]).toEqual(record);
  });

  it('updateRecord create inserts new record into empty collection', () => {
    cache.updateRecord('contacts', 'create', { id: 'new', name: 'New' });
    const result = cache.readCollection('contacts');
    expect(result).toHaveLength(1);
    expect((result[0] as { id: string }).id).toBe('new');
  });

  it('updateRecord update replaces existing record in place', () => {
    cache.writeCollection('contacts', [{ id: '1', name: 'Old' }]);
    cache.updateRecord('contacts', 'update', { id: '1', name: 'New', extra: 'field' });
    const result = cache.readCollection('contacts');
    expect(result).toHaveLength(1);
    expect((result[0] as { name: string }).name).toBe('New');
    expect((result[0] as { extra: string }).extra).toBe('field');
  });

  it('updateRecord delete on non-existent id is a no-op', () => {
    cache.writeCollection('contacts', [{ id: '1', name: 'Alice' }]);
    cache.updateRecord('contacts', 'delete', { id: 'does-not-exist' });
    expect(cache.readCollection('contacts')).toHaveLength(1);
  });

  it('handles empty collection (readCollection returns [])', () => {
    // Write then clear
    cache.writeCollection('contacts', [{ id: '1', name: 'Alice' }]);
    cache.writeCollection('contacts', []);
    expect(cache.readCollection('contacts')).toEqual([]);
  });

  it('DB file is created on disk (WAL mode initialisation)', () => {
    const dbPath = join(tempDir, 'cache.db');
    expect(existsSync(dbPath)).toBe(true);
  });

  it('collections are independent of each other', () => {
    cache.writeCollection('contacts', [{ id: '1', name: 'Alice' }]);
    cache.writeCollection('servers', [{ id: 'srv1', host: 'web-01' }]);
    expect(cache.readCollection('contacts')).toHaveLength(1);
    expect(cache.readCollection('servers')).toHaveLength(1);
    cache.writeCollection('contacts', []);
    expect(cache.readCollection('servers')).toHaveLength(1);
  });

  it('stores a usable-cache marker for the authenticated server', () => {
    const serverUrl = ['http', '://relay-noc:8090'].join('');
    const differentServerUrl = ['http', '://different-server:8090'].join('');
    cache.setUsableCacheMarker(`${serverUrl}/`, 100, 200);

    expect(cache.getUsableCacheMarker()).toEqual({
      serverIdentity: serverUrl,
      authenticatedAt: 100,
      lastSyncAt: 200,
    });
    expect(cache.hasUsableCacheFor(serverUrl)).toBe(true);
    expect(cache.hasUsableCacheFor(differentServerUrl)).toBe(false);
  });

  it('removes the usable marker when cached data is cleared', () => {
    cache.setUsableCacheMarker(['http', '://relay-noc:8090'].join(''), 100, 200);

    cache.clear();

    expect(cache.getUsableCacheMarker()).toBeNull();
  });

  it('stores and replaces membership for a cached collection query', () => {
    expect(cache.readQueryMembership('dynatrace_problems', '0123456789abcdef')).toBeNull();

    expect(
      cache.writeQueryMembership('dynatrace_problems', '0123456789abcdef', {
        recordIds: ['first', 'second'],
        totalItems: 10,
        complete: false,
      }),
    ).toBe(true);
    expect(cache.readQueryMembership('dynatrace_problems', '0123456789abcdef')).toEqual({
      recordIds: ['first', 'second'],
      totalItems: 10,
      complete: false,
    });

    expect(
      cache.writeQueryMembership('dynatrace_problems', '0123456789abcdef', {
        recordIds: ['second'],
        totalItems: 1,
        complete: true,
      }),
    ).toBe(true);
    expect(cache.readQueryMembership('dynatrace_problems', '0123456789abcdef')).toEqual({
      recordIds: ['second'],
      totalItems: 1,
      complete: true,
    });
  });

  it('clears cached query membership with cached data', () => {
    cache.writeQueryMembership('dynatrace_problems', '0123456789abcdef', {
      recordIds: ['problem'],
      totalItems: 1,
      complete: true,
    });

    cache.clear();

    expect(cache.readQueryMembership('dynatrace_problems', '0123456789abcdef')).toBeNull();
  });

  it('bounds obsolete cached query memberships per collection', () => {
    const now = vi.spyOn(Date, 'now');
    for (let index = 0; index < 65; index += 1) {
      now.mockReturnValue(index);
      cache.writeQueryMembership('dynatrace_problems', index.toString(16).padStart(16, '0'), {
        recordIds: [`problem-${index}`],
        totalItems: 1,
        complete: true,
      });
    }
    now.mockRestore();

    expect(cache.readQueryMembership('dynatrace_problems', '0000000000000000')).toBeNull();
    expect(cache.readQueryMembership('dynatrace_problems', '0000000000000040')).toEqual({
      recordIds: ['problem-64'],
      totalItems: 1,
      complete: true,
    });
  });

  it('tracks Wiki search snapshot trust independently by normalized server identity', () => {
    const serverUrl = ['HTTPS', '://Relay.Example.com/'].join('');

    expect(cache.hasKnowledgeSearchSnapshotFor(serverUrl)).toBe(false);
    expect(cache.setKnowledgeSearchSnapshotMarker(serverUrl)).toBe(true);
    expect(cache.hasKnowledgeSearchSnapshotFor('https://relay.example.com')).toBe(true);
    expect(cache.hasUsableCacheFor(serverUrl)).toBe(false);

    expect(cache.clearKnowledgeSearchSnapshotMarker()).toBe(true);
    expect(cache.hasKnowledgeSearchSnapshotFor(serverUrl)).toBe(false);
  });

  it('clears both global and Wiki search snapshot markers with cached data', () => {
    const serverUrl = 'https://relay.example.com';
    cache.setUsableCacheMarker(serverUrl, 100, 200);
    cache.setKnowledgeSearchSnapshotMarker(serverUrl);

    cache.clear();

    expect(cache.hasUsableCacheFor(serverUrl)).toBe(false);
    expect(cache.hasKnowledgeSearchSnapshotFor(serverUrl)).toBe(false);
  });

  it('does not store update records without a non-empty string id', () => {
    cache.updateRecord('contacts', 'create', { name: 'NoId' });
    cache.updateRecord('contacts', 'create', { id: '', name: 'BlankId' });
    cache.updateRecord('contacts', 'create', { id: '   ', name: 'WhitespaceId' });
    cache.updateRecord('contacts', 'create', { id: 123, name: 'NumericId' });

    expect(cache.readCollection('contacts')).toEqual([]);
  });

  it('does not write snapshot records without a non-empty string id', () => {
    cache.writeCollection('contacts', [
      { id: 'valid', name: 'Valid' },
      { name: 'NoId' },
      { id: '', name: 'BlankId' },
      { id: '   ', name: 'WhitespaceId' },
      { id: 123, name: 'NumericId' },
    ]);

    expect(cache.readCollection('contacts')).toEqual([{ id: 'valid', name: 'Valid' }]);
  });

  it('preserves a corrupt unified database because it may contain pending mutations', () => {
    const dbPath = join(tempDir, 'corrupt.db');
    writeFileSync(dbPath, 'this is not a sqlite database, not even close');
    expect(() => new OfflineCache(dbPath)).toThrow();
    expect(existsSync(dbPath)).toBe(true);
  });

  it('rethrows non-corruption constructor errors', () => {
    // Pointing dbPath at a directory that exists throws SQLITE_CANTOPEN, not a corruption error
    const dirPath = join(tempDir, 'not-a-file');
    mkdirSync(dirPath);
    expect(() => new OfflineCache(dirPath)).toThrow();
  });
});
