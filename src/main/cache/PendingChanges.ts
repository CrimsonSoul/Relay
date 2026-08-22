import Database from 'better-sqlite3';
import { loggers } from '../logger';

const logger = loggers.sync;

export interface PendingChange {
  id: number;
  collection: string;
  action: 'create' | 'update' | 'delete';
  data: Record<string, unknown>;
  timestamp: number;
  baseUpdated?: string;
  syncError?: string;
}

export type CoalescedPendingChange = { id: number | null; action: PendingChange['action'] };

export class PendingChanges {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.init();
  }

  private init(): void {
    this.db.exec(`
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
    const columns = this.db.prepare('PRAGMA table_info(pending_changes)').all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === 'base_updated')) {
      this.db.exec("ALTER TABLE pending_changes ADD COLUMN base_updated TEXT NOT NULL DEFAULT ''");
    }
    if (!columns.some((column) => column.name === 'sync_error')) {
      this.db.exec("ALTER TABLE pending_changes ADD COLUMN sync_error TEXT NOT NULL DEFAULT ''");
    }
  }

  /**
   * Enqueue a pending change for future sync.
   * NOTE: This is infrastructure prepared for future offline-write support.
   * Currently no production code path calls enqueue() — it will be wired up
   * when offline mutation queueing is implemented.
   */
  enqueue(
    collection: string,
    action: 'create' | 'update' | 'delete',
    data: Record<string, unknown>,
    baseUpdated = '',
  ): number {
    try {
      const result = this.db
        .prepare(
          'INSERT INTO pending_changes (collection, action, data, timestamp, base_updated) VALUES (?, ?, ?, ?, ?)',
        )
        .run(collection, action, JSON.stringify(data), Date.now(), baseUpdated);
      return Number(result.lastInsertRowid);
    } catch (err) {
      logger.error('Failed to enqueue pending change', { collection, action, error: err });
      throw err; // a durability queue must fail loudly, not drop the user's edit
    }
  }

  /**
   * Collapse a chain of offline edits for one record into the single server
   * operation that represents the user's latest intent. This also preserves
   * the original authenticated server revision for conflict detection.
   */
  enqueueCoalesced(
    collection: string,
    action: PendingChange['action'],
    data: Record<string, unknown>,
    baseUpdated = '',
  ): CoalescedPendingChange {
    const recordId = typeof data.id === 'string' ? data.id : '';
    if (!recordId) return { id: this.enqueue(collection, action, data, baseUpdated), action };

    try {
      return this.db.transaction(() => {
        const existing = this.getAll().find(
          (change) => change.collection === collection && change.data.id === recordId,
        );
        if (!existing) {
          return { id: this.enqueue(collection, action, data, baseUpdated), action };
        }

        if (existing.action === 'create' && action === 'delete') {
          this.removeRecordChain(collection, recordId);
          return { id: null, action: 'delete' as const };
        }

        const coalescedAction = existing.action === 'create' ? 'create' : action;
        const coalescedData = coalescedAction === 'delete' ? { id: recordId } : data;
        this.db
          .prepare("UPDATE pending_changes SET action = ?, data = ?, sync_error = '' WHERE id = ?")
          .run(coalescedAction, JSON.stringify(coalescedData), existing.id);
        this.removeRecordChain(collection, recordId, existing.id);
        return { id: existing.id, action: coalescedAction };
      })();
    } catch (err) {
      logger.error('Failed to coalesce pending change', {
        collection,
        action,
        recordId,
        error: err,
      });
      throw err;
    }
  }

  private removeRecordChain(collection: string, recordId: string, exceptId?: number): void {
    for (const change of this.getAll()) {
      if (
        change.collection === collection &&
        change.data.id === recordId &&
        change.id !== exceptId
      ) {
        this.db.prepare('DELETE FROM pending_changes WHERE id = ?').run(change.id);
      }
    }
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM pending_changes').get() as {
      count: number;
    };
    return row.count;
  }

  getAll(): PendingChange[] {
    try {
      return this.getAllStrict();
    } catch (err) {
      logger.error('Failed to read pending changes', { error: err });
      return [];
    }
  }

  /** Migration/recovery reads fail loudly so unread queue data is never erased. */
  getAllStrict(): PendingChange[] {
    const rows = this.db.prepare('SELECT * FROM pending_changes ORDER BY id ASC').all() as Array<{
      id: number;
      collection: string;
      action: string;
      data: string;
      timestamp: number;
      base_updated: string;
      sync_error: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      collection: row.collection,
      action: row.action as PendingChange['action'],
      data: JSON.parse(row.data),
      timestamp: row.timestamp,
      ...(row.base_updated ? { baseUpdated: row.base_updated } : {}),
      ...(row.sync_error ? { syncError: row.sync_error } : {}),
    }));
  }

  remove(id: number): void {
    try {
      this.db.prepare('DELETE FROM pending_changes WHERE id = ?').run(id);
    } catch (err) {
      logger.error('Failed to remove pending change', { id, error: err });
    }
  }

  markFailure(id: number, error: string): void {
    this.db.prepare('UPDATE pending_changes SET sync_error = ? WHERE id = ?').run(error, id);
  }

  clear(): void {
    try {
      this.db.exec('DELETE FROM pending_changes');
    } catch (err) {
      logger.error('Failed to clear pending changes', { error: err });
    }
  }

  close(): void {
    this.db.close();
  }
}
