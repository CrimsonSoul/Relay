import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { crc32 } from 'node:zlib';
import { restoreAndCheckArchive } from './backupVerificationCore';
import { verifyBackupArchive } from './BackupVerification';
type ZipFixtureEntry = {
  name: string;
  data: Buffer;
  flags?: number;
  compressionMethod?: number;
  externalFileAttributes?: number;
};

function storedZip(entries: ZipFixtureEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const flags = entry.flags ?? 0;
    const compressionMethod = entry.compressionMethod ?? 0;
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(compressionMethod, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.data.byteLength, 18);
    local.writeUInt32LE(entry.data.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    localParts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(compressionMethod, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(entry.data.byteLength, 20);
    central.writeUInt32LE(entry.data.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt32LE(entry.externalFileAttributes ?? (0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.byteLength + name.byteLength + entry.data.byteLength;
  }

  const localData = Buffer.concat(localParts);
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(localData.byteLength, 16);
  return Buffer.concat([localData, centralDirectory, end]);
}

vi.mock('electron', () => ({
  utilityProcess: {
    fork: (path: string, args: string[]) => {
      const child = fork(path, args, { stdio: 'ignore' });
      return Object.assign(child, {
        postMessage: (message: unknown) => child.send(message as object),
      });
    },
  },
}));
let dir: string;
let database: Buffer;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'relay-verifier-test-'));
  const db = new Database(join(dir, 'fixture.db'));
  db.exec(`CREATE TABLE _collections (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE contacts (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE unknown_extension (id TEXT PRIMARY KEY, contact TEXT REFERENCES contacts(id));
    INSERT INTO _collections VALUES ('known','contacts'), ('extra','unknown_extension');
    INSERT INTO contacts VALUES ('abc123','Example');
    INSERT INTO unknown_extension VALUES ('relation123','abc123');`);
  db.close();
  database = readFileSync(join(dir, 'fixture.db'));
  mkdirSync(join(dir, 'extracted'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
it('restores a real PocketBase-format SQLite archive with unknown tables, IDs, relationships and files', async () => {
  const archive = join(dir, 'backup.zip');
  writeFileSync(
    archive,
    storedZip([
      { name: 'data.db', data: database },
      { name: 'storage/known/abc123/sample.txt', data: Buffer.from('retained attachment') },
    ]),
  );
  await restoreAndCheckArchive(archive, join(dir, 'extracted'));
  const db = new Database(join(dir, 'extracted/data.db'), { readonly: true });
  try {
    expect(
      db
        .prepare('SELECT u.id, c.name FROM unknown_extension u JOIN contacts c ON u.contact = c.id')
        .all(),
    ).toEqual([{ id: 'relation123', name: 'Example' }]);
  } finally {
    db.close();
  }
  expect(readFileSync(join(dir, 'extracted/storage/known/abc123/sample.txt'), 'utf8')).toBe(
    'retained attachment',
  );
});
it.each(['../escape', '/absolute', 'storage/../escape', 'C:/escape'])(
  'rejects traversal %s',
  async (name) => {
    const archive = join(dir, 'bad.zip');
    writeFileSync(archive, storedZip([{ name, data: Buffer.from('unsafe') }]));
    await expect(restoreAndCheckArchive(archive, join(dir, 'extracted'))).rejects.toThrow();
  },
);
it('rejects symlinks and duplicate paths', async () => {
  const archive = join(dir, 'bad.zip');
  writeFileSync(
    archive,
    storedZip([
      { name: 'data.db', data: database, externalFileAttributes: (0o120777 << 16) >>> 0 },
    ]),
  );
  await expect(restoreAndCheckArchive(archive, join(dir, 'extracted'))).rejects.toThrow();
  writeFileSync(
    archive,
    storedZip([
      { name: 'data.db', data: database },
      { name: 'data.db', data: database },
    ]),
  );
  await expect(restoreAndCheckArchive(archive, join(dir, 'extracted'))).rejects.toThrow();
});
it('rejects CRC corruption', async () => {
  const archive = join(dir, 'bad.zip');
  const zip = storedZip([{ name: 'data.db', data: database }]);
  zip[100] = zip[100]! ^ 0xff;
  writeFileSync(archive, zip);
  await expect(restoreAndCheckArchive(archive, join(dir, 'extracted'))).rejects.toThrow();
});
it('terminates a native SQLite process before cleaning private extraction and leaves the caller responsive', async () => {
  const worker = join(dir, 'busy.cjs');
  const sqlite = createRequire(import.meta.url).resolve('better-sqlite3');
  const marker = join(dir, 'native-started');
  writeFileSync(
    worker,
    `const db = new (require(${JSON.stringify(sqlite)}))(':memory:'); require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started'); db.prepare('WITH RECURSIVE t(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM t WHERE x<200000000) SELECT sum(x) FROM t').get();`,
  );
  const started = Date.now();
  let responsive = false;
  setTimeout(() => {
    responsive = true;
  }, 10);
  await expect(
    verifyBackupArchive(join(dir, 'unused.zip'), dir, { processPath: worker, timeoutMs: 1000 }),
  ).rejects.toThrow('timed out');
  expect(readFileSync(marker, 'utf8')).toBe('started');
  expect(responsive).toBe(true);
  expect(Date.now() - started).toBeLessThan(3000);
  expect(readdirSync(dir).some((name) => name.startsWith('.relay-backup-verify-'))).toBe(false);
});

it('cleans disposable data after process success and process failure', async () => {
  const worker = join(dir, 'result.cjs');
  for (const result of ['verified', 'failed']) {
    writeFileSync(worker, `process.send('${result}');`);
    const check = verifyBackupArchive(join(dir, 'unused.zip'), dir, { processPath: worker });
    if (result === 'verified') await expect(check).resolves.toBeUndefined();
    else await expect(check).rejects.toThrow('not readable');
    expect(readdirSync(dir).some((name) => name.startsWith('.relay-backup-verify-'))).toBe(false);
  }
});
it('rejects a database that is not PocketBase and malformed archives', async () => {
  const archive = join(dir, 'bad.zip');
  writeFileSync(archive, 'not a zip');
  await expect(restoreAndCheckArchive(archive, join(dir, 'extracted'))).rejects.toThrow();
  writeFileSync(archive, storedZip([{ name: 'data.db', data: Buffer.from('not SQLite') }]));
  await expect(restoreAndCheckArchive(archive, join(dir, 'extracted'))).rejects.toThrow();
});

it('sends verification paths only over the private parent channel', async () => {
  const worker = join(dir, 'request.cjs');
  const record = join(dir, 'request.json');
  writeFileSync(
    worker,
    `process.once('message', request => { require('node:fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify({ args: process.argv.slice(2), request })); process.send('verified'); });`,
  );
  const archive = join(dir, 'private-backup.zip');
  await verifyBackupArchive(archive, dir, { processPath: worker });
  const received = JSON.parse(readFileSync(record, 'utf8')) as {
    args: string[];
    request: { archive: string; destination: string };
  };
  expect(received.args).toEqual([]);
  expect(received.request.archive).toBe(archive);
  expect(received.request.destination).toMatch(/\.relay-backup-verify-/);
  expect(readdirSync(dir).some((name) => name.startsWith('.relay-backup-verify-'))).toBe(false);
});
