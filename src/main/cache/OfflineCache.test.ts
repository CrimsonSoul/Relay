import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
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
});
