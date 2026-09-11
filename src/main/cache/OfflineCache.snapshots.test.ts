import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { OfflineCache } from './OfflineCache';
import { collectionRevisionSignature } from '@shared/cacheSnapshot';
vi.mock('../logger', () => ({ loggers: { sync: { error: vi.fn(), warn: vi.fn() } } }));
let dir: string;
let cache: OfflineCache;
const owner = 'server-a:window-1';
function begin(records: Record<string, unknown>[], sender = owner) {
  return cache.beginSnapshot('contacts', sender, {
    count: records.length,
    bytes: records.reduce((sum, record) => sum + Buffer.byteLength(JSON.stringify(record)), 0),
    signature: collectionRevisionSignature(records as { id: string }[]),
  });
}
function save(records: Record<string, unknown>[]) {
  const started = begin(records);
  expect(started.ok).toBe(true);
  if (!started.ok) throw new Error('begin rejected');
  for (let offset = 0; offset < records.length; offset += 256) {
    expect(
      cache.appendSnapshot(
        owner,
        started.generation,
        offset / 256,
        records.slice(offset, offset + 256),
      ).ok,
    ).toBe(true);
  }
  return cache.commitSnapshot(owner, started.generation);
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'relay-snapshot-'));
  cache = new OfflineCache(join(dir, 'cache.db'));
});
afterEach(() => {
  cache.close();
  rmSync(dir, { recursive: true, force: true });
});
describe('durable atomic snapshots', () => {
  it('commits 12000 contacts over 10 MiB and reopens all content', () => {
    const rows = Array.from({ length: 12000 }, (_, i) => ({
      id: `contact-${i}`,
      name: `Person ${i}`,
      notes: 'x'.repeat(1000),
    }));
    expect(Buffer.byteLength(JSON.stringify(rows))).toBeGreaterThan(10 * 1024 * 1024);
    expect(save(rows)).toMatchObject({ ok: true, persisted: true });
    cache.close();
    cache = new OfflineCache(join(dir, 'cache.db'));
    expect(cache.readCollection('contacts')).toHaveLength(12000);
    expect(cache.readCollection('contacts').find((r) => r.id === 'contact-11999')).toEqual(
      rows[11999],
    );
    expect(cache.snapshotStatus('contacts')).toMatchObject({ complete: true });
  });
  it('preserves previous complete rows across interruption and removes abandoned staging on restart', () => {
    save([{ id: 'old' }]);
    const started = begin([{ id: 'new' }]);
    if (!started.ok) throw new Error('begin');
    cache.appendSnapshot(owner, started.generation, 0, [{ id: 'new' }]);
    cache.close();
    cache = new OfflineCache(join(dir, 'cache.db'));
    expect(cache.readCollection('contacts')).toEqual([{ id: 'old' }]);
    expect(cache.commitSnapshot(owner, started.generation).ok).toBe(false);
  });
  it('rejects wrong sender, stale generations, order, duplicate IDs, oversized records and incomplete commit', () => {
    save([{ id: 'old' }]);
    const a = begin([{ id: 'new' }]);
    const b = begin([{ id: 'new' }]);
    if (!a.ok || !b.ok) throw new Error('begin');
    expect(cache.commitSnapshot(owner, a.generation).ok).toBe(false);
    expect(cache.appendSnapshot('other', b.generation, 0, [{ id: 'new' }]).ok).toBe(false);
    expect(cache.appendSnapshot(owner, b.generation, 1, [{ id: 'new' }]).ok).toBe(false);
    expect(
      cache.appendSnapshot(owner, b.generation, 0, [{ id: 'new', notes: 'x'.repeat(262144) }]).ok,
    ).toBe(false);
    expect(cache.commitSnapshot(owner, b.generation).ok).toBe(false);
    const duplicate = begin([{ id: 'x' }, { id: 'x' }]);
    if (!duplicate.ok) throw new Error('begin');
    expect(
      cache.appendSnapshot(owner, duplicate.generation, 0, [{ id: 'x' }, { id: 'x' }]).ok,
    ).toBe(false);
    expect(cache.readCollection('contacts')).toEqual([{ id: 'old' }]);
  });
  it('merges realtime updates, deletes and durable pending overlays during transfer', () => {
    const rows = [
      { id: 'update', value: 'old' },
      { id: 'delete' },
      { id: 'pending', value: 'old' },
    ];
    save(rows);
    cache.applyOfflineMutationAtomically('contacts', 'update', { id: 'pending', value: 'local' });
    const started = begin(rows);
    if (!started.ok) throw new Error('begin');
    cache.appendSnapshot(owner, started.generation, 0, rows);
    cache.updateRecord('contacts', 'update', { id: 'update', value: 'new' });
    cache.updateRecord('contacts', 'delete', { id: 'delete' });
    cache.applyOfflineMutationAtomically('contacts', 'create', { id: 'created', value: 'local' });
    expect(cache.commitSnapshot(owner, started.generation).ok).toBe(true);
    expect(cache.readCollection('contacts')).toEqual(
      expect.arrayContaining([
        { id: 'update', value: 'new' },
        { id: 'pending', value: 'local' },
        { id: 'created', value: 'local' },
      ]),
    );
    expect(cache.readCollection('contacts')).toHaveLength(3);
  });
  it('rolls back a failed commit and allows a fresh retry, including empty snapshots', () => {
    save([{ id: 'old' }]);
    const started = begin([{ id: 'new' }]);
    if (!started.ok) throw new Error('begin');
    cache.appendSnapshot(owner, started.generation, 0, [{ id: 'new' }]);
    const db = new Database(join(dir, 'cache.db'));
    db.exec(
      "CREATE TRIGGER fail_snapshot BEFORE DELETE ON cache BEGIN SELECT RAISE(FAIL, 'disk failure'); END",
    );
    expect(cache.commitSnapshot(owner, started.generation)).toMatchObject({
      ok: false,
      persisted: false,
    });
    expect(cache.readCollection('contacts')).toEqual([{ id: 'old' }]);
    db.exec('DROP TRIGGER fail_snapshot');
    db.close();
    expect(save([])).toMatchObject({ ok: true, persisted: true });
    expect(cache.readCollection('contacts')).toEqual([]);
  });
});

it('journals a realtime tombstone even when the fetched row was absent from the previous cache', () => {
  save([{ id: 'old' }]);
  const rows = [{ id: 'new' }];
  const started = begin(rows);
  if (!started.ok) throw new Error('begin');
  cache.updateRecord('contacts', 'delete', { id: 'new' });
  cache.appendSnapshot(owner, started.generation, 0, rows);
  expect(cache.commitSnapshot(owner, started.generation).ok).toBe(true);
  expect(cache.readCollection('contacts')).toEqual([]);
});
it('rejects inconsistent signatures, expired generations and chunks above 512 rows or 2 MiB', () => {
  save([{ id: 'old' }]);
  const rows = Array.from({ length: 513 }, (_, i) => ({ id: `${i}` }));
  const stage = begin(rows);
  if (!stage.ok) throw new Error('begin');
  expect(cache.appendSnapshot(owner, stage.generation, 0, rows).ok).toBe(false);
  const large = Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, text: 'x'.repeat(220000) }));
  const oversized = begin(large);
  if (!oversized.ok) throw new Error('begin');
  expect(cache.appendSnapshot(owner, oversized.generation, 0, large).ok).toBe(false);
  const signature = cache.beginSnapshot('contacts', owner, {
    count: 1,
    bytes: 10,
    signature: '1:0000000000000000',
  });
  if (!signature.ok) throw new Error('begin');
  expect(cache.appendSnapshot(owner, signature.generation, 0, [{ id: 'x' }]).ok).toBe(true);
  expect(cache.commitSnapshot(owner, signature.generation).ok).toBe(false);
  const expired = begin([{ id: 'new' }]);
  if (!expired.ok) throw new Error('begin');
  const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60 * 1000);
  expect(cache.appendSnapshot(owner, expired.generation, 0, [{ id: 'new' }]).ok).toBe(false);
  now.mockRestore();
  expect(cache.readCollection('contacts')).toEqual([{ id: 'old' }]);
});
it('refuses misleading query membership and invalidates staged completion on failed realtime persistence', () => {
  save([{ id: 'old' }]);
  expect(
    cache.writeQueryMembership('contacts', '0123456789abcdef', {
      recordIds: ['missing'],
      totalItems: 1,
      complete: true,
    }),
  ).toBe(false);
  const stage = begin([{ id: 'new' }]);
  if (!stage.ok) throw new Error('begin');
  cache.appendSnapshot(owner, stage.generation, 0, [{ id: 'new' }]);
  const db = new Database(join(dir, 'cache.db'));
  db.exec(
    "CREATE TRIGGER fail_realtime BEFORE INSERT ON cache BEGIN SELECT RAISE(FAIL, 'disk failure'); END",
  );
  expect(cache.updateRecord('contacts', 'update', { id: 'new', value: 'newer' })).toBe(false);
  expect(cache.snapshotStatus('contacts').complete).toBe(false);
  expect(cache.commitSnapshot(owner, stage.generation).ok).toBe(false);
  db.close();
});
it('invalidates a generation on clear without touching the durable queue', () => {
  cache.applyOfflineMutationAtomically('contacts', 'create', { id: 'queued' });
  const stage = begin([{ id: 'new' }]);
  if (!stage.ok) throw new Error('begin');
  cache.clear();
  expect(cache.appendSnapshot(owner, stage.generation, 0, [{ id: 'new' }]).ok).toBe(false);
  const db = new Database(join(dir, 'cache.db'));
  expect(db.prepare('SELECT COUNT(*) AS count FROM pending_changes').get()).toEqual({ count: 1 });
  db.close();
});

it('supersedes an active generation when another full writer replaces the collection', () => {
  save([{ id: 'old' }]);
  const stage = begin([{ id: 'absent-from-old' }]);
  if (!stage.ok) throw new Error('begin');
  cache.appendSnapshot(owner, stage.generation, 0, [{ id: 'absent-from-old' }]);
  expect(cache.writeCollection('contacts', [{ id: 'replacement' }])).toBe(true);
  expect(cache.commitSnapshot(owner, stage.generation).ok).toBe(false);
  expect(cache.readCollection('contacts')).toEqual([{ id: 'replacement' }]);
  expect(cache.snapshotStatus('contacts').complete).toBe(false);
});

it('retains the saved oncall revision and separate queue time in pending snapshot overlays', () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1234000);
  cache.applyOfflineMutationAtomically(
    'oncall',
    'update',
    { id: 'coverage', name: 'Queued' },
    '2026-01-01',
  );
  now.mockRestore();
  const rows = [{ id: 'coverage', name: 'Server', updated: '2026-01-01' }];
  const stage = cache.beginSnapshot('oncall', owner, {
    count: 1,
    bytes: Buffer.byteLength(JSON.stringify(rows[0])),
    signature: collectionRevisionSignature(rows),
  });
  if (!stage.ok) throw new Error('begin');
  cache.appendSnapshot(owner, stage.generation, 0, rows);
  expect(cache.commitSnapshot(owner, stage.generation).ok).toBe(true);
  expect(cache.readCollection('oncall')).toEqual([
    { id: 'coverage', name: 'Queued', updated: '2026-01-01', queuedAt: '1970-01-01T00:20:34.000Z' },
  ]);
});

it('supersedes staging even when a newer legacy full writer matches its saved revision', () => {
  cache.writeCollection('contacts', '1:0123456789abcdef', [{ id: 'old' }]);
  const stage = begin([{ id: 'absent-from-old' }]);
  if (!stage.ok) throw new Error('begin');
  cache.appendSnapshot(owner, stage.generation, 0, [{ id: 'absent-from-old' }]);
  cache.writeCollection('contacts', '1:0123456789abcdef', [{ id: 'old' }]);
  expect(cache.commitSnapshot(owner, stage.generation).ok).toBe(false);
  expect(cache.readCollection('contacts')).toEqual([{ id: 'old' }]);
});
