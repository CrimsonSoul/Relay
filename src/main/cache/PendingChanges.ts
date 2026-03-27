import Database from 'better-sqlite3';
import { loggers } from '../logger';

const logger = loggers.sync;

export interface PendingChange {
  id: number;
  collection: string;
  action: 'create' | 'update' | 'delete';
  data: Record<string, unknown>;
  timestamp: number;
}

export class PendingChanges {
  private db: Database.Database;

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
        timestamp INTEGER NOT NULL
      )
    `);
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
  ): void {
    try {
      this.db
        .prepare(
          'INSERT INTO pending_changes (collection, action, data, timestamp) VALUES (?, ?, ?, ?)',
        )
        .run(collection, action, JSON.stringify(data), Date.now());
    } catch (err) {
      logger.error('Failed to enqueue pending change', { collection, action, error: err });
    }
  }

  getAll(): PendingChange[] {
    try {
      const rows = this.db.prepare('SELECT * FROM pending_changes ORDER BY id ASC').all() as Array<{
        id: number;
        collection: string;
        action: string;
        data: string;
        timestamp: number;
      }>;

      return rows.map((row) => ({
        id: row.id,
        collection: row.collection,
        action: row.action as PendingChange['action'],
        data: JSON.parse(row.data),
        timestamp: row.timestamp,
      }));
    } catch (err) {
      logger.error('Failed to read pending changes', { error: err });
      return [];
    }
  }

  remove(id: number): void {
    try {
      this.db.prepare('DELETE FROM pending_changes WHERE id = ?').run(id);
    } catch (err) {
      logger.error('Failed to remove pending change', { id, error: err });
    }
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
