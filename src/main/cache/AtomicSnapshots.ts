import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  CACHE_SNAPSHOT_LIMITS as LIMITS,
  collectionRevisionSignature,
  type CacheSnapshotManifest,
  type CacheSnapshotBeginAck,
  type CacheWriteAck,
} from '@shared/cacheSnapshot';

const FAILED = {
  ok: false,
  persisted: false,
  error: 'The offline copy could not be saved. Retry when connected.',
} as const;
const SAVED = { ok: true, persisted: true } as const;
const TTL_MS = 10 * 60 * 1000;
interface Stage extends CacheSnapshotManifest {
  generation: string;
  collection: string;
  owner: string;
  sequence: number;
  accepted: number;
  accepted_bytes: number;
  expires: number;
  failed: number;
}

/** Each chunk is its own transaction; only final promotion replaces visible rows. */
export class AtomicSnapshots {
  constructor(private readonly db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cache_snapshot_stage (
        collection TEXT PRIMARY KEY, generation TEXT UNIQUE NOT NULL, owner TEXT NOT NULL,
        count INTEGER NOT NULL, bytes INTEGER NOT NULL, signature TEXT NOT NULL,
        sequence INTEGER NOT NULL DEFAULT 0, accepted INTEGER NOT NULL DEFAULT 0,
        accepted_bytes INTEGER NOT NULL DEFAULT 0, expires INTEGER NOT NULL, failed INTEGER NOT NULL DEFAULT 0, mutation_count INTEGER NOT NULL DEFAULT 0, mutation_bytes INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS cache_snapshot_rows (
        generation TEXT NOT NULL, record_id TEXT NOT NULL, data TEXT NOT NULL,
        ordinal INTEGER NOT NULL, PRIMARY KEY (generation, record_id)
      );
      CREATE TABLE IF NOT EXISTS cache_snapshot_mutations (
        collection TEXT NOT NULL, record_id TEXT NOT NULL, data TEXT,
        PRIMARY KEY(collection, record_id)
      );
      CREATE TABLE IF NOT EXISTS cache_snapshot_complete (collection TEXT PRIMARY KEY);
      CREATE TRIGGER IF NOT EXISTS cache_snapshot_insert AFTER INSERT ON cache
      WHEN EXISTS(SELECT 1 FROM cache_snapshot_stage WHERE collection = NEW.collection AND failed = 0)
      BEGIN INSERT INTO cache_snapshot_mutations VALUES (NEW.collection, NEW.record_id, NEW.data) ON CONFLICT(collection, record_id) DO UPDATE SET data = excluded.data; END;
      CREATE TRIGGER IF NOT EXISTS cache_snapshot_update AFTER UPDATE ON cache
      WHEN EXISTS(SELECT 1 FROM cache_snapshot_stage WHERE collection = NEW.collection AND failed = 0)
      BEGIN INSERT INTO cache_snapshot_mutations VALUES (NEW.collection, NEW.record_id, NEW.data) ON CONFLICT(collection, record_id) DO UPDATE SET data = excluded.data; END;
      CREATE TRIGGER IF NOT EXISTS cache_snapshot_delete AFTER DELETE ON cache
      WHEN EXISTS(SELECT 1 FROM cache_snapshot_stage WHERE collection = OLD.collection AND failed = 0)
      BEGIN INSERT INTO cache_snapshot_mutations VALUES (OLD.collection, OLD.record_id, NULL) ON CONFLICT(collection, record_id) DO UPDATE SET data = NULL; END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS cache_snapshot_mutation_insert AFTER INSERT ON cache_snapshot_mutations
      BEGIN
        UPDATE cache_snapshot_stage SET mutation_count = mutation_count + 1,
          mutation_bytes = mutation_bytes + COALESCE(length(CAST(NEW.data AS BLOB)), 0)
          WHERE collection = NEW.collection;
        UPDATE cache_snapshot_stage SET failed = 1 WHERE collection = NEW.collection
          AND (mutation_count > ${LIMITS.records} OR bytes + mutation_bytes > ${LIMITS.bytes});
        DELETE FROM cache_snapshot_rows WHERE generation IN (SELECT generation FROM cache_snapshot_stage WHERE collection = NEW.collection AND failed = 1);
        DELETE FROM cache_snapshot_mutations WHERE collection = NEW.collection AND EXISTS(SELECT 1 FROM cache_snapshot_stage WHERE collection = NEW.collection AND failed = 1);
      END;
      CREATE TRIGGER IF NOT EXISTS cache_snapshot_mutation_update AFTER UPDATE ON cache_snapshot_mutations
      BEGIN
        UPDATE cache_snapshot_stage SET mutation_bytes = mutation_bytes + COALESCE(length(CAST(NEW.data AS BLOB)), 0) - COALESCE(length(CAST(OLD.data AS BLOB)), 0)
          WHERE collection = NEW.collection;
        UPDATE cache_snapshot_stage SET failed = 1 WHERE collection = NEW.collection AND bytes + mutation_bytes > ${LIMITS.bytes};
        DELETE FROM cache_snapshot_rows WHERE generation IN (SELECT generation FROM cache_snapshot_stage WHERE collection = NEW.collection AND failed = 1);
        DELETE FROM cache_snapshot_mutations WHERE collection = NEW.collection AND EXISTS(SELECT 1 FROM cache_snapshot_stage WHERE collection = NEW.collection AND failed = 1);
      END;
    `);
    this.invalidate();
  }

  invalidate(): void {
    this.db.exec(
      'DELETE FROM cache_snapshot_stage; DELETE FROM cache_snapshot_rows; DELETE FROM cache_snapshot_mutations',
    );
  }

  supersede(collection: string): void {
    const stage = this.db
      .prepare('SELECT generation, collection FROM cache_snapshot_stage WHERE collection = ?')
      .get(collection) as Stage | undefined;
    if (stage) this.remove(stage);
    this.db.prepare('DELETE FROM cache_snapshot_complete WHERE collection = ?').run(collection);
  }

  private remove(stage: Pick<Stage, 'generation' | 'collection'>): void {
    this.db.prepare('DELETE FROM cache_snapshot_stage WHERE generation = ?').run(stage.generation);
    this.db.prepare('DELETE FROM cache_snapshot_rows WHERE generation = ?').run(stage.generation);
    this.db
      .prepare('DELETE FROM cache_snapshot_mutations WHERE collection = ?')
      .run(stage.collection);
  }

  begin(collection: string, owner: string, manifest: CacheSnapshotManifest): CacheSnapshotBeginAck {
    try {
      if (
        !manifest ||
        !Number.isSafeInteger(manifest.count) ||
        manifest.count < 0 ||
        manifest.count > LIMITS.records ||
        !Number.isSafeInteger(manifest.bytes) ||
        manifest.bytes < 0 ||
        manifest.bytes > LIMITS.bytes ||
        typeof manifest.signature !== 'string' ||
        !/^\d{1,6}:[0-9a-f]{16}$/.test(manifest.signature) ||
        Number(manifest.signature.split(':')[0]) !== manifest.count
      )
        return FAILED;
      const generation = randomUUID();
      this.db.transaction(() => {
        const old = this.db
          .prepare(
            'SELECT generation, collection FROM cache_snapshot_stage WHERE collection = ? OR expires < ?',
          )
          .all(collection, Date.now()) as Stage[];
        for (const stage of old) this.remove(stage);
        this.db
          .prepare(
            'INSERT INTO cache_snapshot_stage (collection, generation, owner, count, bytes, signature, expires) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            collection,
            generation,
            owner,
            manifest.count,
            manifest.bytes,
            manifest.signature,
            Date.now() + TTL_MS,
          );
      })();
      return { ok: true, generation };
    } catch {
      return FAILED;
    }
  }

  private stage(owner: string, generation: string): Stage | undefined {
    return this.db
      .prepare(
        'SELECT * FROM cache_snapshot_stage WHERE generation = ? AND owner = ? AND expires >= ?',
      )
      .get(generation, owner, Date.now()) as Stage | undefined;
  }

  append(
    owner: string,
    generation: string,
    sequence: number,
    records: Record<string, unknown>[],
  ): CacheWriteAck {
    try {
      const stage = this.stage(owner, generation);
      if (
        !stage ||
        stage.failed ||
        stage.sequence !== sequence ||
        !Array.isArray(records) ||
        records.length === 0 ||
        records.length > LIMITS.chunkRecords
      )
        return FAILED;
      const rows = records.map((record) => {
        if (
          !record ||
          typeof record !== 'object' ||
          Array.isArray(record) ||
          typeof record.id !== 'string' ||
          !record.id.trim() ||
          Buffer.byteLength(record.id) > 512
        )
          throw new Error('Invalid record');
        const data = JSON.stringify(record);
        if (Buffer.byteLength(data) > LIMITS.recordBytes) throw new Error('Oversized record');
        return { id: record.id, data };
      });
      const bytes = rows.reduce((sum, row) => sum + Buffer.byteLength(row.data), 0);
      // Account for array punctuation in the IPC chunk ceiling as well.
      if (
        bytes + rows.length + 1 > LIMITS.chunkBytes ||
        stage.accepted + rows.length > stage.count ||
        stage.accepted_bytes + bytes > stage.bytes
      )
        return FAILED;
      this.db.transaction(() => {
        const insert = this.db.prepare('INSERT INTO cache_snapshot_rows VALUES (?, ?, ?, ?)');
        rows.forEach((row, index) =>
          insert.run(generation, row.id, row.data, stage.accepted + index),
        );
        this.db
          .prepare(
            'UPDATE cache_snapshot_stage SET sequence = sequence + 1, accepted = accepted + ?, accepted_bytes = accepted_bytes + ? WHERE generation = ?',
          )
          .run(rows.length, bytes, generation);
      })();
      return SAVED;
    } catch {
      return FAILED;
    }
  }

  commit(owner: string, generation: string): CacheWriteAck {
    try {
      const stage = this.stage(owner, generation);
      if (
        !stage ||
        stage.failed ||
        stage.accepted !== stage.count ||
        stage.accepted_bytes !== stage.bytes
      )
        return FAILED;
      this.db.transaction(() => {
        const rows = this.db
          .prepare('SELECT data FROM cache_snapshot_rows WHERE generation = ? ORDER BY ordinal')
          .all(generation) as { data: string }[];
        const records = rows.map((row) => JSON.parse(row.data) as { id: string });
        if (
          records.length !== stage.count ||
          collectionRevisionSignature(records) !== stage.signature
        )
          throw new Error('Invalid signature');
        const mutations = this.db
          .prepare('SELECT record_id, data FROM cache_snapshot_mutations WHERE collection = ?')
          .all(stage.collection) as { record_id: string; data: string | null }[];
        this.remove(stage);
        this.db.prepare('DELETE FROM cache WHERE collection = ?').run(stage.collection);
        const insert = this.db.prepare('INSERT OR REPLACE INTO cache VALUES (?, ?, ?)');
        rows.forEach((row) =>
          insert.run(stage.collection, (JSON.parse(row.data) as { id: string }).id, row.data),
        );
        const remove = this.db.prepare('DELETE FROM cache WHERE collection = ? AND record_id = ?');
        for (const mutation of mutations) {
          if (mutation.data === null) remove.run(stage.collection, mutation.record_id);
          else insert.run(stage.collection, mutation.record_id, mutation.data);
        }
        this.applyPending(stage.collection);
        const size = this.db
          .prepare(
            'SELECT COUNT(*) AS count, COALESCE(SUM(length(CAST(data AS BLOB))), 0) AS bytes FROM cache WHERE collection = ?',
          )
          .get(stage.collection) as { count: number; bytes: number };
        if (size.count > LIMITS.records || size.bytes > LIMITS.bytes)
          throw new Error('Merged snapshot exceeds limits');
        this.db
          .prepare('DELETE FROM offline_query_membership WHERE collection = ?')
          .run(stage.collection);
        this.db.prepare('DELETE FROM cache_meta WHERE collection = ?').run(stage.collection);
        this.db
          .prepare('INSERT OR REPLACE INTO cache_snapshot_complete VALUES (?)')
          .run(stage.collection);
      })();
      return SAVED;
    } catch {
      return FAILED;
    }
  }

  private applyPending(collection: string): void {
    const pending = this.db
      .prepare(
        'SELECT action, data, base_updated, timestamp FROM pending_changes WHERE collection = ? ORDER BY id',
      )
      .all(collection) as {
      action: string;
      data: string;
      base_updated: string;
      timestamp: number;
    }[];
    for (const row of pending) {
      const record = JSON.parse(row.data) as Record<string, unknown>;
      if (row.action === 'delete')
        this.db
          .prepare('DELETE FROM cache WHERE collection = ? AND record_id = ?')
          .run(collection, record.id);
      else {
        if (collection === 'oncall') {
          record.updated = row.base_updated;
          record.queuedAt = new Date(row.timestamp).toISOString();
        }
        this.db
          .prepare('INSERT OR REPLACE INTO cache VALUES (?, ?, ?)')
          .run(collection, record.id, JSON.stringify(record));
      }
    }
  }

  markIncomplete(collection: string): void {
    try {
      this.db.transaction(() => {
        this.db.prepare('DELETE FROM cache_snapshot_complete WHERE collection = ?').run(collection);
        this.db
          .prepare('UPDATE cache_snapshot_stage SET failed = 1 WHERE collection = ?')
          .run(collection);
      })();
    } catch {
      /* A database-wide failure is still returned to the caller. */
    }
  }

  status(collection: string): { complete: boolean } {
    try {
      return {
        complete: Boolean(
          this.db
            .prepare('SELECT 1 FROM cache_snapshot_complete WHERE collection = ?')
            .get(collection),
        ),
      };
    } catch {
      return { complete: false };
    }
  }
}
