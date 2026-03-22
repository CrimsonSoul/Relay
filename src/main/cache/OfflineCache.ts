import Database from 'better-sqlite3';

export class OfflineCache {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
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
  }

  readCollection(collection: string): Record<string, unknown>[] {
    const stmt = this.db.prepare('SELECT data FROM cache WHERE collection = ?');
    const rows = stmt.all(collection) as { data: string }[];
    return rows.map((row) => JSON.parse(row.data));
  }

  updateRecord(
    collection: string,
    action: 'create' | 'update' | 'delete',
    record: Record<string, unknown>,
  ): void {
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
  }

  close(): void {
    this.db.close();
  }
}
