import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installPreparedRestore, recoverInterruptedRestore } from './BackupRestore';

const faults = vi.hoisted(() => ({
  rename: -1,
  syncCommitted: false,
  committedRenamed: false,
  cleanup: false,
}));
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return {
    ...fs,
    renameSync: (...args: Parameters<typeof fs.renameSync>) => {
      if (faults.rename-- === 0) throw new Error('Injected rename failure');
      fs.renameSync(...args);
      if (faults.syncCommitted && String(args[1]).endsWith('.relay-backup-restore.json'))
        faults.committedRenamed = true;
    },
    fsyncSync: (...args: Parameters<typeof fs.fsyncSync>) => {
      if (faults.committedRenamed) {
        faults.committedRenamed = false;
        faults.syncCommitted = false;
        throw new Error('Injected directory sync failure');
      }
      fs.fsyncSync(...args);
    },
    rmSync: (...args: Parameters<typeof fs.rmSync>) => {
      if (faults.cleanup && String(args[0]).includes('.relay-backup-original-')) {
        faults.cleanup = false;
        throw new Error('Injected cleanup failure');
      }
      fs.rmSync(...args);
    },
  };
});

const original = '.relay-backup-original-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const stageName = '.relay-backup-verify-fixture';
const reserved = ['backups', '.autocert_cache', 'lost+found'];
let root: string;
let stage: string;
let live: string;

function put(directory: string, name: string, value: string): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), value);
}
function journal(committed = false): void {
  writeFileSync(
    join(root, '.relay-backup-restore.json'),
    JSON.stringify({ version: 1, stage: stageName, original, committed, preserved: reserved }),
  );
}
function expectOriginal(): void {
  expect(readFileSync(join(live, 'data.db'), 'utf8')).toBe('original database');
  for (const name of reserved) expect(readFileSync(join(live, name, 'local'), 'utf8')).toBe(name);
  expect(existsSync(join(root, '.relay-backup-restore.json'))).toBe(false);
  expect(existsSync(join(root, original))).toBe(false);
  expect(existsSync(stage)).toBe(false);
}

beforeEach(() => {
  faults.rename = -1;
  faults.syncCommitted = false;
  faults.committedRenamed = false;
  faults.cleanup = false;
  root = mkdtempSync(join(tmpdir(), 'relay-restore-transaction-'));
  live = join(root, 'pb_data');
  stage = join(root, stageName);
  put(live, 'data.db', 'original database');
  put(stage, 'data.db', 'restored database');
  put(join(stage, 'storage', 'unknown-collection', 'record-id'), 'attachment', 'original bytes');
  for (const name of reserved) put(join(live, name), 'local', name);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('offline backup restore', () => {
  it('does not create data on first launch when no data directory exists', () => {
    const missing = join(root, 'not-created-yet');
    expect(() => recoverInterruptedRestore(missing)).not.toThrow();
    expect(existsSync(missing)).toBe(false);
  });

  it.each([0, 1, 2, 3, 4, 5])('preserves original data if install rename %i fails', (step) => {
    faults.rename = step;
    expect(() => installPreparedRestore(root, stage)).toThrow(/Injected rename failure/);
    recoverInterruptedRestore(root);
    // Failure to write the first journal leaves the caller-owned stage untouched.
    if (step === 0) rmSync(stage, { recursive: true });
    expectOriginal();
  });

  // Windows does not fsync directories; this fault exists only on POSIX.
  it.skipIf(process.platform === 'win32')(
    'never rolls back a commit marker visible after directory sync fails',
    () => {
      const transaction = installPreparedRestore(root, stage);
      faults.syncCommitted = true;
      transaction.commit();
      expect(() => transaction.rollback()).toThrow(/committed/i);
      recoverInterruptedRestore(root);
      expect(readFileSync(join(live, 'data.db'), 'utf8')).toBe('restored database');
      expect(readdirSync(root)).toEqual(['pb_data']);
    },
  );

  it('retains a committed journal when old-directory cleanup fails, then retries on startup', () => {
    const transaction = installPreparedRestore(root, stage);
    faults.cleanup = true;
    transaction.commit();
    expect(
      JSON.parse(readFileSync(join(root, '.relay-backup-restore.json'), 'utf8')).committed,
    ).toBe(true);
    recoverInterruptedRestore(root);
    expect(readFileSync(join(live, 'data.db'), 'utf8')).toBe('restored database');
    expect(readdirSync(root)).toEqual(['pb_data']);
  });

  it('installs verified bytes and keeps local archives and their identity through commit', () => {
    const archive = statSync(join(live, 'backups', 'local'));
    for (const name of [...reserved, '.pb_temp_to_delete'])
      put(join(stage, name), 'untrusted', 'archived local state');
    const transaction = installPreparedRestore(root, stage);
    expect(readFileSync(join(live, 'data.db'), 'utf8')).toBe('restored database');
    expect(
      readFileSync(join(live, 'storage/unknown-collection/record-id/attachment'), 'utf8'),
    ).toBe('original bytes');
    for (const name of reserved) {
      expect(readFileSync(join(live, name, 'local'), 'utf8')).toBe(name);
      expect(existsSync(join(live, name, 'untrusted'))).toBe(false);
    }
    expect(existsSync(join(live, '.pb_temp_to_delete'))).toBe(false);
    const preservedArchive = statSync(join(live, 'backups', 'local'));
    expect(preservedArchive.ino).toBe(archive.ino);
    expect(preservedArchive.ctimeMs).toBe(archive.ctimeMs);
    transaction.commit();
    transaction.commit();
    expect(() => transaction.rollback()).toThrow(/committed/i);
    recoverInterruptedRestore(root);
    expect(readFileSync(join(live, 'data.db'), 'utf8')).toBe('restored database');
    expect(readdirSync(root)).toEqual(['pb_data']);
  });

  it('rolls back a failed server startup without losing local archives', () => {
    const transaction = installPreparedRestore(root, stage);
    transaction.rollback();
    transaction.rollback();
    recoverInterruptedRestore(root);
    expectOriginal();
    expect(() => transaction.commit()).toThrow(/rolled back/i);
  });

  it.each([0, 1, 2, 3, 4, 5])('recovers interruption after install rename %i', (step) => {
    journal();
    if (step >= 1) renameSync(live, join(root, original));
    if (step >= 2) renameSync(stage, live);
    for (let index = 0; index < Math.max(0, step - 2); index++) {
      const name = reserved[index]!;
      renameSync(join(root, original, name), join(live, name));
    }
    recoverInterruptedRestore(root);
    recoverInterruptedRestore(root);
    expectOriginal();
  });

  it.each([0, 1, 2, 3, 4])('resumes interruption during rollback at step %i', (step) => {
    installPreparedRestore(root, stage);
    const current = JSON.parse(readFileSync(join(root, '.relay-backup-restore.json'), 'utf8'));
    for (let index = 0; index < Math.min(step, 3); index++) {
      const name = reserved[index]!;
      renameSync(join(live, name), join(root, current.original, name));
    }
    if (step === 4) rmSync(live, { recursive: true });
    recoverInterruptedRestore(root);
    expectOriginal();
  });

  it('finishes cleanup after durable commit without reverting restored bytes', () => {
    installPreparedRestore(root, stage);
    const path = join(root, '.relay-backup-restore.json');
    const state = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(path, JSON.stringify({ ...state, committed: true }));
    recoverInterruptedRestore(root);
    recoverInterruptedRestore(root);
    expect(readFileSync(join(live, 'data.db'), 'utf8')).toBe('restored database');
    expect(readdirSync(root)).toEqual(['pb_data']);
  });

  it('rejects a second restore without altering the first transaction', () => {
    const transaction = installPreparedRestore(root, stage);
    const second = join(root, '.relay-backup-verify-second');
    put(second, 'data.db', 'second database');
    expect(() => installPreparedRestore(root, second)).toThrow();
    expect(readFileSync(join(live, 'data.db'), 'utf8')).toBe('restored database');
    transaction.rollback();
    rmSync(second, { recursive: true });
    expectOriginal();
  });

  it.each(['../outside', '/outside', 'pb_data', '.relay-backup-original-invalid'])(
    'rejects an unsafe journal original path %s',
    (name) => {
      journal();
      const path = join(root, '.relay-backup-restore.json');
      const state = JSON.parse(readFileSync(path, 'utf8'));
      writeFileSync(path, JSON.stringify({ ...state, original: name }));
      expect(() => recoverInterruptedRestore(root)).toThrow();
      expect(readFileSync(join(live, 'data.db'), 'utf8')).toBe('original database');
      expect(existsSync(stage)).toBe(true);
    },
  );

  it('fails closed when both live and original are missing', () => {
    journal();
    rmSync(live, { recursive: true });
    expect(() => recoverInterruptedRestore(root)).toThrow();
    expect(existsSync(stage)).toBe(true);
    expect(existsSync(join(root, '.relay-backup-restore.json'))).toBe(true);
  });

  it('refuses ambiguous duplicate preserved directories without deleting either', () => {
    journal();
    renameSync(live, join(root, original));
    renameSync(stage, live);
    put(join(live, 'backups'), 'conflict', 'keep this');
    expect(() => recoverInterruptedRestore(root)).toThrow();
    expect(readFileSync(join(root, original, 'backups/local'), 'utf8')).toBe('backups');
    expect(readFileSync(join(live, 'backups/conflict'), 'utf8')).toBe('keep this');
  });

  it.each(['pb_data', stageName, '.relay-backup-restore.json'])(
    'rejects redirected %s without touching the target',
    (name) => {
      const outside = mkdtempSync(join(tmpdir(), 'relay-restore-outside-'));
      try {
        put(outside, 'data.db', 'untouched');
        rmSync(join(root, name), { recursive: true, force: true });
        symlinkSync(outside, join(root, name), process.platform === 'win32' ? 'junction' : 'dir');
        expect(() => installPreparedRestore(root, stage)).toThrow();
        expect(readFileSync(join(outside, 'data.db'), 'utf8')).toBe('untouched');
        expect(lstatSync(join(root, name)).isSymbolicLink()).toBe(true);
      } finally {
        rmSync(outside, { recursive: true });
      }
    },
  );

  it('rejects a symlink inside preserved archives', () => {
    symlinkSync(
      stage,
      join(live, 'backups', 'redirect'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    expect(() => installPreparedRestore(root, stage)).toThrow();
    expect(readFileSync(join(live, 'data.db'), 'utf8')).toBe('original database');
  });
});
