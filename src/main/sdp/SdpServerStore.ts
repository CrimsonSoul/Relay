import Database from 'better-sqlite3';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import {
  SdpClientSchema,
  SdpDetailSchema,
  type SdpDetail,
  type SdpClient,
  type SdpQueuePage,
  SdpQueuePageSchema,
  type SdpTestTicket,
} from '@shared/sdpAccount';

export type SdpDetailSnapshot = { detail: SdpDetail; fetchedAt: number; expiresAt: number };
export type SdpSettings = { client: SdpClient; cacheMinutes: number; revision: string };
export type SdpQueueSnapshot = { queuePage: SdpQueuePage; fetchedAt: number; expiresAt: number };
export type SdpSnapshot = { ticket: SdpTestTicket; fetchedAt: number; expiresAt: number };
export type SdpKeyProtection = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

/** Server-private storage; it is never a PocketBase collection or a desktop offline cache. */
export class SdpServerStore {
  private readonly key: Buffer;
  private readonly db: Database.Database;
  private readonly configPath: string;
  constructor(root: string, protection: SdpKeyProtection) {
    if (!protection.isEncryptionAvailable())
      throw new Error('OS-protected SDP storage is unavailable.');
    mkdirSync(root, { recursive: true, mode: 0o700 });
    chmodSync(root, 0o700);
    const keyPath = join(root, 'key.bin');
    if (existsSync(keyPath))
      this.key = Buffer.from(protection.decryptString(readFileSync(keyPath)), 'base64');
    else {
      this.key = randomBytes(32);
      writeFileSync(keyPath, protection.encryptString(this.key.toString('base64')), {
        mode: 0o600,
        flag: 'wx',
      });
    }
    if (this.key.length !== 32) throw new Error('Invalid SDP storage key.');
    this.configPath = join(root, 'connection.enc');
    const dbPath = join(root, 'outage-cache.sqlite');
    this.db = new Database(dbPath);
    chmodSync(dbPath, 0o600);
    this.db.pragma('secure_delete = ON');
    this.db.pragma('journal_mode = DELETE');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS snapshots (owner TEXT PRIMARY KEY, expires INTEGER NOT NULL, body BLOB NOT NULL)',
    );
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS queue_snapshots (owner TEXT NOT NULL, page_key TEXT NOT NULL, expires INTEGER NOT NULL, body BLOB NOT NULL, PRIMARY KEY(owner, page_key))',
    );
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS detail_snapshots (owner TEXT NOT NULL, detail_key TEXT NOT NULL, expires INTEGER NOT NULL, body BLOB NOT NULL, PRIMARY KEY(owner, detail_key))',
    );
    this.prune();
  }
  private seal(value: unknown, context: string): Buffer {
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(context));
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), body]);
  }
  private open(value: Buffer, context: string): unknown {
    const decipher = createDecipheriv('aes-256-gcm', this.key, value.subarray(0, 12));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(value.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8'),
    ) as unknown;
  }
  settings(): SdpSettings | null {
    if (!existsSync(this.configPath)) return null;
    const value = this.open(readFileSync(this.configPath), 'sdp-connection') as SdpSettings | null;
    if (!value) return null;
    const client = SdpClientSchema.parse(value.client);
    if (
      !Number.isInteger(value.cacheMinutes) ||
      value.cacheMinutes < 5 ||
      value.cacheMinutes > 240 ||
      typeof value.revision !== 'string'
    )
      throw new Error('Invalid SDP configuration.');
    return { ...value, client };
  }
  save(client: SdpClient | null, cacheMinutes: number, expectedRevision: string): void {
    if ((this.settings()?.revision ?? '') !== expectedRevision)
      throw new Error('SDP settings changed. Refresh before saving.');
    const value = client
      ? { client: SdpClientSchema.parse(client), cacheMinutes, revision: randomUUID() }
      : null;
    if (client && (!Number.isInteger(cacheMinutes) || cacheMinutes < 5 || cacheMinutes > 240))
      throw new Error('Invalid cache duration.');
    const temp = `${this.configPath}.tmp`;
    writeFileSync(temp, this.seal(value, 'sdp-connection'), { mode: 0o600 });
    renameSync(temp, this.configPath);
    this.db.prepare('DELETE FROM snapshots').run();
    this.db.prepare('DELETE FROM queue_snapshots').run();
    this.db.prepare('DELETE FROM detail_snapshots').run();
  }
  owner(zuid: string, revision: string): string {
    return createHmac('sha256', this.key)
      .update(`support.campingworld.com/itdesk\0${revision}\0${zuid}`)
      .digest('hex');
  }
  put(owner: string, snapshot: SdpSnapshot): void {
    this.prune();
    this.db
      .prepare('INSERT OR REPLACE INTO snapshots (owner,expires,body) VALUES (?,?,?)')
      .run(owner, snapshot.expiresAt, this.seal(snapshot, owner));
    // The restricted test has one snapshot per user; bound even unattended server storage.
    this.db
      .prepare(
        'DELETE FROM snapshots WHERE owner IN (SELECT owner FROM snapshots ORDER BY expires DESC LIMIT -1 OFFSET 1000)',
      )
      .run();
  }
  get(owner: string): SdpSnapshot | null {
    this.prune();
    const row = this.db.prepare('SELECT body FROM snapshots WHERE owner = ?').get(owner) as
      { body: Buffer } | undefined;
    if (!row) return null;
    try {
      const value = this.open(row.body, owner) as SdpSnapshot;
      if (!value || value.expiresAt <= Date.now()) return null;
      return value;
    } catch {
      this.remove(owner);
      return null;
    }
  }
  putQueue(owner: string, snapshot: SdpQueueSnapshot): void {
    this.prune();
    const key = `${snapshot.queuePage.queue}:${snapshot.queuePage.page}`;
    this.db
      .prepare(
        'INSERT OR REPLACE INTO queue_snapshots (owner,page_key,expires,body) VALUES (?,?,?,?)',
      )
      .run(owner, key, snapshot.expiresAt, this.seal(snapshot, `${owner}:${key}`));
    this.db
      .prepare(
        'DELETE FROM queue_snapshots WHERE rowid IN (SELECT rowid FROM queue_snapshots ORDER BY expires DESC LIMIT -1 OFFSET 1000)',
      )
      .run();
  }
  getQueue(owner: string, queue: string, page: number): SdpQueueSnapshot | null {
    this.prune();
    const key = `${queue}:${page}`;
    const row = this.db
      .prepare('SELECT body FROM queue_snapshots WHERE owner=? AND page_key=?')
      .get(owner, key) as { body: Buffer } | undefined;
    if (!row) return null;
    try {
      const value = this.open(row.body, `${owner}:${key}`) as SdpQueueSnapshot;
      const queuePage = SdpQueuePageSchema.parse(value.queuePage);
      if (
        queuePage.queue !== queue ||
        queuePage.page !== page ||
        !Number.isFinite(value.expiresAt) ||
        value.expiresAt <= Date.now()
      )
        return null;
      return { ...value, queuePage };
    } catch {
      this.remove(owner);
      return null;
    }
  }
  putDetail(owner: string, snapshot: SdpDetailSnapshot): void {
    this.prune();
    const key = `v2:${snapshot.detail.id}:${snapshot.detail.page}:${!!snapshot.detail.includeAutoNotifications}`;
    this.db
      .prepare(
        'INSERT OR REPLACE INTO detail_snapshots (owner,detail_key,expires,body) VALUES (?,?,?,?)',
      )
      .run(owner, key, snapshot.expiresAt, this.seal(snapshot, `${owner}:detail:${key}`));
    this.db
      .prepare(
        'DELETE FROM detail_snapshots WHERE rowid IN (SELECT rowid FROM detail_snapshots ORDER BY expires DESC LIMIT -1 OFFSET 200)',
      )
      .run();
  }
  getDetail(
    owner: string,
    id: string,
    page: number,
    includeAutoNotifications = false,
  ): SdpDetailSnapshot | null {
    this.prune();
    const key = `v2:${id}:${page}:${includeAutoNotifications}`;
    const row = this.db
      .prepare('SELECT body FROM detail_snapshots WHERE owner=? AND detail_key=?')
      .get(owner, key) as { body: Buffer } | undefined;
    if (!row) return null;
    try {
      const value = this.open(row.body, `${owner}:detail:${key}`) as SdpDetailSnapshot;
      const detail = SdpDetailSchema.parse(value.detail);
      if (
        detail.id !== id ||
        detail.page !== page ||
        !!detail.includeAutoNotifications !== includeAutoNotifications ||
        !Number.isFinite(value.expiresAt) ||
        value.expiresAt <= Date.now()
      )
        return null;
      return { ...value, detail };
    } catch {
      this.remove(owner);
      return null;
    }
  }
  remove(owner: string): void {
    this.db.prepare('DELETE FROM snapshots WHERE owner = ?').run(owner);
    this.db.prepare('DELETE FROM queue_snapshots WHERE owner = ?').run(owner);
    this.db.prepare('DELETE FROM detail_snapshots WHERE owner = ?').run(owner);
  }
  prune(): void {
    this.db.prepare('DELETE FROM snapshots WHERE expires <= ?').run(Date.now());
    this.db.prepare('DELETE FROM queue_snapshots WHERE expires <= ?').run(Date.now());
    this.db.prepare('DELETE FROM detail_snapshots WHERE expires <= ?').run(Date.now());
  }
  close(): void {
    this.db.close();
    this.key.fill(0);
  }
}
