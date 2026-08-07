import Database from 'better-sqlite3';
import type { CachedQueryMembership } from '@shared/ipc';
import { loggers } from '../logger';

const logger = loggers.sync;
const KNOWLEDGE_SEARCH_SNAPSHOT_MARKER_KEY = 'knowledge-search-snapshot';
const MAX_QUERY_MEMBERSHIPS_PER_COLLECTION = 64;
type CacheMutationAction = 'create' | 'update' | 'delete';

export interface UsableCacheMarker {
  serverIdentity: string;
  authenticatedAt: number;
  lastSyncAt: number;
}

export function normalizeServerIdentity(serverUrl: string): string {
  let normalized = serverUrl.trim().toLowerCase();
  while (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
}

function isCorruptionError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB';
}

export class OfflineCache {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    try {
      this.db = OfflineCache.open(dbPath);
    } catch (err) {
      if (isCorruptionError(err)) {
        // This database also contains the durable offline mutation queue. Keep
        // it untouched for recovery instead of treating it as disposable.
        logger.error('Offline database corrupt — preserving it for recovery', {
          dbPath,
          error: err,
        });
      }
      throw err;
    }
  }

  private static open(dbPath: string): Database.Database {
    const db = new Database(dbPath);
    try {
      db.pragma('journal_mode = WAL');
      db.pragma('busy_timeout = 5000');
      db.exec(`
        CREATE TABLE IF NOT EXISTS cache (
          collection TEXT NOT NULL,
          record_id TEXT NOT NULL,
          data TEXT NOT NULL,
          PRIMARY KEY (collection, record_id)
        );
        CREATE TABLE IF NOT EXISTS cache_meta (
          collection TEXT PRIMARY KEY,
          signature TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS offline_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS offline_query_membership (
          collection TEXT NOT NULL,
          query_key TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (collection, query_key)
        );
        CREATE TABLE IF NOT EXISTS pending_changes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          collection TEXT NOT NULL,
          action TEXT NOT NULL,
          data TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          base_updated TEXT NOT NULL DEFAULT ''
          ,sync_error TEXT NOT NULL DEFAULT ''
        )
      `);
    } catch (err) {
      db.close();
      throw err;
    }
    return db;
  }

  private getRecordId(record: Record<string, unknown>): string | null {
    const id = record.id;
    return typeof id === 'string' && id.trim().length > 0 ? id : null;
  }

  writeCollection(collection: string, records: Record<string, unknown>[]): boolean;
  writeCollection(
    collection: string,
    signature: string,
    records: Record<string, unknown>[],
  ): boolean;
  writeCollection(
    collection: string,
    signatureOrRecords: string | Record<string, unknown>[],
    snapshotRecords?: Record<string, unknown>[],
  ): boolean {
    try {
      const signature = typeof signatureOrRecords === 'string' ? signatureOrRecords : null;
      const records =
        typeof signatureOrRecords === 'string' ? (snapshotRecords ?? []) : signatureOrRecords;
      if (signature) {
        const existing = this.db
          .prepare('SELECT signature FROM cache_meta WHERE collection = ?')
          .get(collection) as { signature: string } | undefined;
        if (existing?.signature === signature) return false;
      }

      const deleteStmt = this.db.prepare('DELETE FROM cache WHERE collection = ?');
      const insertStmt = this.db.prepare(
        'INSERT INTO cache (collection, record_id, data) VALUES (?, ?, ?)',
      );
      const deleteMetaStmt = this.db.prepare('DELETE FROM cache_meta WHERE collection = ?');
      const upsertMetaStmt = this.db.prepare(
        'INSERT OR REPLACE INTO cache_meta (collection, signature) VALUES (?, ?)',
      );

      const transaction = this.db.transaction(() => {
        deleteStmt.run(collection);
        for (const record of records) {
          const id = this.getRecordId(record);
          if (!id) {
            logger.warn('Skipping cache record without valid id', { collection });
            continue;
          }
          insertStmt.run(collection, id, JSON.stringify(record));
        }
        if (signature) upsertMetaStmt.run(collection, signature);
        else deleteMetaStmt.run(collection);
      });

      transaction();
      return true;
    } catch (err) {
      logger.error('Failed to write collection to cache', { collection, error: err });
      return false;
    }
  }

  readCollection(collection: string): Record<string, unknown>[] {
    try {
      const stmt = this.db.prepare('SELECT data FROM cache WHERE collection = ?');
      const rows = stmt.all(collection) as { data: string }[];
      return rows.flatMap((row) => {
        try {
          return [JSON.parse(row.data)];
        } catch {
          logger.warn('Corrupt cache row skipped', { collection });
          return [];
        }
      });
    } catch (err) {
      logger.error('Failed to read collection from cache', { collection, error: err });
      return [];
    }
  }

  updateRecord(
    collection: string,
    action: CacheMutationAction,
    record: Record<string, unknown>,
  ): boolean {
    try {
      const id = this.getRecordId(record);
      if (!id) {
        logger.warn('Skipping cache update without valid id', { collection, action });
        return false;
      }

      const transaction = this.db.transaction(() => {
        this.db.prepare('DELETE FROM cache_meta WHERE collection = ?').run(collection);
        switch (action) {
          case 'create':
          case 'update':
            this.db
              .prepare(
                'INSERT OR REPLACE INTO cache (collection, record_id, data) VALUES (?, ?, ?)',
              )
              .run(collection, id, JSON.stringify(record));
            break;
          case 'delete':
            this.db
              .prepare('DELETE FROM cache WHERE collection = ? AND record_id = ?')
              .run(collection, id);
            break;
        }
      });
      transaction();
      return true;
    } catch (err) {
      logger.error('Failed to update record in cache', { collection, action, error: err });
      return false;
    }
  }

  applyOfflineMutationAtomically(
    collection: string,
    action: CacheMutationAction,
    record: Record<string, unknown>,
    baseUpdated = '',
  ): boolean {
    try {
      const id = this.getRecordId(record);
      if (!id) return false;
      this.db.transaction(() => {
        this.coalescePendingMutation(collection, action, record, baseUpdated, id);
        this.writeCachedMutation(collection, action, record, id);
      })();
      return true;
    } catch (error) {
      logger.error('Failed to atomically persist offline mutation', {
        collection,
        action,
        error,
      });
      return false;
    }
  }

  private coalescePendingMutation(
    collection: string,
    action: CacheMutationAction,
    record: Record<string, unknown>,
    baseUpdated: string,
    recordId: string,
  ): void {
    const rows = this.db
      .prepare('SELECT id, action, data FROM pending_changes WHERE collection = ? ORDER BY id ASC')
      .all(collection) as Array<{
      id: number;
      action: 'create' | 'update' | 'delete';
      data: string;
    }>;
    const matching = rows.filter((row) => {
      try {
        return (JSON.parse(row.data) as { id?: unknown }).id === recordId;
      } catch {
        return false;
      }
    });
    const existing = matching[0];
    if (!existing) {
      this.db
        .prepare(
          'INSERT INTO pending_changes (collection, action, data, timestamp, base_updated) VALUES (?, ?, ?, ?, ?)',
        )
        .run(collection, action, JSON.stringify(record), Date.now(), baseUpdated);
      return;
    }
    if (existing.action === 'create' && action === 'delete') {
      this.deletePendingRows(matching);
      return;
    }
    const nextAction = existing.action === 'create' ? 'create' : action;
    const nextData = nextAction === 'delete' ? { id: recordId } : record;
    this.db
      .prepare("UPDATE pending_changes SET action = ?, data = ?, sync_error = '' WHERE id = ?")
      .run(nextAction, JSON.stringify(nextData), existing.id);
    this.deletePendingRows(matching.slice(1));
  }

  private deletePendingRows(rows: Array<{ id: number }>): void {
    const statement = this.db.prepare('DELETE FROM pending_changes WHERE id = ?');
    for (const row of rows) statement.run(row.id);
  }

  private writeCachedMutation(
    collection: string,
    action: CacheMutationAction,
    record: Record<string, unknown>,
    recordId: string,
  ): void {
    this.db.prepare('DELETE FROM cache_meta WHERE collection = ?').run(collection);
    if (action === 'delete') {
      this.db
        .prepare('DELETE FROM cache WHERE collection = ? AND record_id = ?')
        .run(collection, recordId);
      return;
    }
    this.db
      .prepare('INSERT OR REPLACE INTO cache (collection, record_id, data) VALUES (?, ?, ?)')
      .run(collection, recordId, JSON.stringify(record));
  }

  setUsableCacheMarker(
    serverIdentity: string,
    authenticatedAt = Date.now(),
    lastSyncAt = authenticatedAt,
  ): void {
    const marker: UsableCacheMarker = {
      serverIdentity: normalizeServerIdentity(serverIdentity),
      authenticatedAt,
      lastSyncAt,
    };
    this.db
      .prepare('INSERT OR REPLACE INTO offline_meta (key, value) VALUES (?, ?)')
      .run('usable-cache', JSON.stringify(marker));
  }

  getUsableCacheMarker(): UsableCacheMarker | null {
    try {
      const row = this.db
        .prepare('SELECT value FROM offline_meta WHERE key = ?')
        .get('usable-cache') as { value: string } | undefined;
      if (!row) return null;
      const marker = JSON.parse(row.value) as Partial<UsableCacheMarker>;
      if (
        typeof marker.serverIdentity !== 'string' ||
        typeof marker.authenticatedAt !== 'number' ||
        typeof marker.lastSyncAt !== 'number'
      ) {
        return null;
      }
      return marker as UsableCacheMarker;
    } catch (error) {
      logger.warn('Failed to read usable cache marker', { error });
      return null;
    }
  }

  hasUsableCacheFor(serverUrl: string): boolean {
    return this.getUsableCacheMarker()?.serverIdentity === normalizeServerIdentity(serverUrl);
  }

  setKnowledgeSearchSnapshotMarker(serverIdentity: string): boolean {
    try {
      this.db
        .prepare('INSERT OR REPLACE INTO offline_meta (key, value) VALUES (?, ?)')
        .run(KNOWLEDGE_SEARCH_SNAPSHOT_MARKER_KEY, normalizeServerIdentity(serverIdentity));
      return true;
    } catch (error) {
      logger.error('Failed to set Wiki search snapshot marker', { error });
      return false;
    }
  }

  clearKnowledgeSearchSnapshotMarker(): boolean {
    try {
      this.db
        .prepare('DELETE FROM offline_meta WHERE key = ?')
        .run(KNOWLEDGE_SEARCH_SNAPSHOT_MARKER_KEY);
      return true;
    } catch (error) {
      logger.error('Failed to clear Wiki search snapshot marker', { error });
      return false;
    }
  }

  hasKnowledgeSearchSnapshotFor(serverIdentity: string): boolean {
    try {
      const row = this.db
        .prepare('SELECT value FROM offline_meta WHERE key = ?')
        .get(KNOWLEDGE_SEARCH_SNAPSHOT_MARKER_KEY) as { value: string } | undefined;
      return row?.value === normalizeServerIdentity(serverIdentity);
    } catch (error) {
      logger.warn('Failed to read Wiki search snapshot marker', { error });
      return false;
    }
  }

  writeQueryMembership(
    collection: string,
    queryKey: string,
    membership: CachedQueryMembership,
  ): boolean {
    try {
      const transaction = this.db.transaction(() => {
        this.db
          .prepare(
            `INSERT OR REPLACE INTO offline_query_membership
              (collection, query_key, value, updated_at) VALUES (?, ?, ?, ?)`,
          )
          .run(collection, queryKey, JSON.stringify(membership), Date.now());
        this.db
          .prepare(
            `DELETE FROM offline_query_membership
             WHERE collection = ? AND query_key <> ? AND query_key NOT IN (
               SELECT query_key FROM offline_query_membership
               WHERE collection = ? AND query_key <> ?
               ORDER BY updated_at DESC, query_key DESC
               LIMIT ?
             )`,
          )
          .run(
            collection,
            queryKey,
            collection,
            queryKey,
            MAX_QUERY_MEMBERSHIPS_PER_COLLECTION - 1,
          );
      });
      transaction();
      return true;
    } catch (error) {
      logger.error('Failed to write cached query membership', { collection, error });
      return false;
    }
  }

  readQueryMembership(collection: string, queryKey: string): CachedQueryMembership | null {
    try {
      const row = this.db
        .prepare(
          'SELECT value FROM offline_query_membership WHERE collection = ? AND query_key = ?',
        )
        .get(collection, queryKey) as { value: string } | undefined;
      if (!row) return null;
      const membership = JSON.parse(row.value) as Partial<CachedQueryMembership>;
      return Array.isArray(membership.recordIds) &&
        membership.recordIds.every((id) => typeof id === 'string') &&
        typeof membership.totalItems === 'number' &&
        Number.isSafeInteger(membership.totalItems) &&
        membership.totalItems >= membership.recordIds.length &&
        typeof membership.complete === 'boolean'
        ? (membership as CachedQueryMembership)
        : null;
    } catch (error) {
      logger.warn('Failed to read cached query membership', { collection, error });
      return null;
    }
  }

  clear(): void {
    try {
      this.db.exec(
        'DELETE FROM cache; DELETE FROM cache_meta; DELETE FROM offline_meta; DELETE FROM offline_query_membership',
      );
    } catch (err) {
      logger.error('Failed to clear offline cache', { error: err });
    }
  }

  close(): void {
    this.db.close();
  }
}
