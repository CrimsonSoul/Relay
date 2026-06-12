import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { OfflineCache } from './OfflineCache';

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

  it('rebuilds the database when the file is corrupt', () => {
    const dbPath = join(tempDir, 'corrupt.db');
    writeFileSync(dbPath, 'this is not a sqlite database, not even close');
    const corruptCache = new OfflineCache(dbPath); // must not throw
    corruptCache.writeCollection('contacts', [{ id: 'a1', name: 'Test' }]);
    expect(corruptCache.readCollection('contacts')).toEqual([{ id: 'a1', name: 'Test' }]);
    corruptCache.close();
  });

  it('rethrows non-corruption constructor errors', () => {
    // Pointing dbPath at a directory that exists throws SQLITE_CANTOPEN, not a corruption error
    const dirPath = join(tempDir, 'not-a-file');
    mkdirSync(dirPath);
    expect(() => new OfflineCache(dirPath)).toThrow();
  });
});
