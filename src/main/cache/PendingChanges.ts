import Database from 'better-sqlite3';

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

  enqueue(
    collection: string,
    action: 'create' | 'update' | 'delete',
    data: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        'INSERT INTO pending_changes (collection, action, data, timestamp) VALUES (?, ?, ?, ?)',
      )
      .run(collection, action, JSON.stringify(data), Date.now());
  }

  getAll(): PendingChange[] {
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
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM pending_changes WHERE id = ?').run(id);
  }

  clear(): void {
    this.db.exec('DELETE FROM pending_changes');
  }

  close(): void {
    this.db.close();
  }
}
