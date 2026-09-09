import { createWriteStream } from 'node:fs';
import { mkdir, lstat, statfs } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32 } from 'node:zlib';
import Database from 'better-sqlite3';
import yauzl from 'yauzl';

const MAX_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_ENTRIES = 100_000;

/** Only call in the dedicated utility process: integrity_check is synchronous native work. */
export async function restoreAndCheckArchive(archive: string, destination: string): Promise<void> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(
      archive,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, result) => {
        if (error || !result) reject(error ?? new Error('Invalid ZIP'));
        else resolve(result);
      },
    );
  });
  const seen = new Set<string>();
  let total = 0;
  const disk = await statfs(destination);
  const available = disk.bavail * disk.bsize - 512 * 1024 * 1024;
  const extract = async (entry: yauzl.Entry): Promise<void> => {
    const name = entry.fileName;
    const parts = name.replace(/\/$/, '').split('/');
    const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
    if (
      !name ||
      name.includes('\\') ||
      name.includes(':') ||
      parts.some((p) => !p || p === '.' || p === '..') ||
      seen.has(name.toLowerCase()) ||
      (mode !== 0 && mode !== 0o100000 && mode !== 0o040000) ||
      entry.generalPurposeBitFlag & 1
    )
      throw new Error('Unsafe ZIP entry');
    seen.add(name.toLowerCase());
    total += entry.uncompressedSize;
    if (seen.size > MAX_ENTRIES || total > MAX_BYTES || total > available)
      throw new Error('Archive exceeds verification limits or available disk space');
    const path = join(destination, name);
    if (name.endsWith('/')) {
      await mkdir(path, { recursive: true, mode: 0o700 });
      return;
    }
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const stream = await new Promise<NodeJS.ReadableStream>((res, rej) =>
      zip.openReadStream(entry, (error, result) => (error || !result ? rej(error) : res(result))),
    );
    let bytes = 0;
    let checksum = 0;
    const guard = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        checksum = crc32(chunk, checksum);
        callback(bytes > entry.uncompressedSize ? new Error('Invalid ZIP size') : null, chunk);
      },
    });
    await pipeline(stream, guard, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
    if (bytes !== entry.uncompressedSize || checksum !== entry.crc32)
      throw new Error('ZIP integrity check failed');
  };
  try {
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry: yauzl.Entry) => {
        void extract(entry).then(() => zip.readEntry(), reject);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
  const dbPath = join(destination, 'data.db');
  if (!(await lstat(dbPath)).isFile()) throw new Error('Missing PocketBase database');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok')
      throw new Error('SQLite integrity check failed');
    const tables = db
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    if (!tables.some((table) => table.name === '_collections'))
      throw new Error('Missing PocketBase schema');
    for (const table of tables)
      db.prepare(`SELECT * FROM "${table.name.replaceAll('"', '""')}" LIMIT 1`).all();
  } finally {
    db.close();
  }
}
