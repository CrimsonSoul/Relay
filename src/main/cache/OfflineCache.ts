import Database from 'better-sqlite3';
import { loggers } from '../logger';

const logger = loggers.sync;

export class OfflineCache {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        collection TEXT NOT NULL,
        record_id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (collection, record_id)
      )
    `);
  }

  writeCollection(collection: string, records: Record<string, unknown>[]): void {
    try {
      const deleteStmt = this.db.prepare('DELETE FROM cache WHERE collection = ?');
      const insertStmt = this.db.prepare(
        'INSERT INTO cache (collection, record_id, data) VALUES (?, ?, ?)',
      );

      const transaction = this.db.transaction(() => {
        deleteStmt.run(collection);
        for (const record of records) {
          const id = (record as { id?: string }).id || '';
          insertStmt.run(collection, id, JSON.stringify(record));
        }
      });

      transaction();
    } catch (err) {
      logger.error('Failed to write collection to cache', { collection, error: err });
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
    action: 'create' | 'update' | 'delete',
    record: Record<string, unknown>,
  ): void {
    try {
      const id = (record as { id?: string }).id || '';

      switch (action) {
        case 'create':
        case 'update':
          this.db
            .prepare('INSERT OR REPLACE INTO cache (collection, record_id, data) VALUES (?, ?, ?)')
            .run(collection, id, JSON.stringify(record));
          break;
        case 'delete':
          this.db
            .prepare('DELETE FROM cache WHERE collection = ? AND record_id = ?')
            .run(collection, id);
          break;
      }
    } catch (err) {
      logger.error('Failed to update record in cache', { collection, action, error: err });
    }
  }

  clear(): void {
    try {
      this.db.exec('DELETE FROM cache');
    } catch (err) {
      logger.error('Failed to clear offline cache', { error: err });
    }
  }

  close(): void {
    this.db.close();
  }
}
