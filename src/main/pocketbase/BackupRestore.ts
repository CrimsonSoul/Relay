import {
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const JOURNAL = '.relay-backup-restore.json';
const PRESERVED = ['backups', '.autocert_cache', 'lost+found'] as const;
const STAGE_PATTERN = /^\.relay-backup-verify-[a-zA-Z0-9_-]+$/;
const ORIGINAL_PATTERN =
  /^\.relay-backup-original-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Journal = {
  version: 1;
  stage: string;
  original: string;
  committed: boolean;
  preserved: string[];
};

export type BackupRestoreTransaction = { commit(): void; rollback(): void };

function inspect(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    const entry = lstatSync(path);
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory()))
      throw new Error('Backup restore path is redirected or unsupported');
    return entry;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function directory(path: string): boolean {
  const entry = inspect(path);
  if (entry && !entry.isDirectory()) throw new Error('Backup restore directory is invalid');
  return !!entry;
}

function rootPath(dataDir: string): string {
  if (!directory(dataDir)) throw new Error('Backup restore data directory is missing');
  return realpathSync(dataDir);
}

function syncFile(path: string, directory = false): void {
  const fd = openSync(path, directory ? 'r' : 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function syncDirectory(path: string): void {
  if (process.platform !== 'win32') syncFile(path, true);
}

function inspectTreeEntry(path: string, sync: boolean): boolean {
  const entry = inspect(path);
  if (!entry) throw new Error('Backup restore tree changed');
  if (sync && entry.isFile()) syncFile(path);
  return entry.isDirectory();
}

/** Validate before recursive deletion; sync prepared bytes before installing them. */
function inspectTree(root: string, sync = false): void {
  if (!directory(root)) throw new Error('Backup restore directory is missing');
  const pending = [root];
  let entries = 0;
  while (pending.length) {
    const parent = pending.pop()!;
    for (const name of readdirSync(parent)) {
      if (++entries > 250_000) throw new Error('Backup restore tree is too large');
      const path = join(parent, name);
      if (inspectTreeEntry(path, sync)) pending.push(path);
    }
    if (sync) syncDirectory(parent);
  }
}

function readJournal(root: string): Journal | undefined {
  const path = join(root, JOURNAL);
  const entry = inspect(path);
  if (!entry) return undefined;
  if (!entry.isFile() || entry.size > 4096) throw new Error('Invalid backup restore journal');
  const value = JSON.parse(readFileSync(path, 'utf8')) as Journal;
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value)
      .sort((a, b) => a.localeCompare(b))
      .join(',') !== 'committed,original,preserved,stage,version' ||
    value.version !== 1 ||
    typeof value.stage !== 'string' ||
    !STAGE_PATTERN.test(value.stage) ||
    typeof value.original !== 'string' ||
    !ORIGINAL_PATTERN.test(value.original) ||
    typeof value.committed !== 'boolean' ||
    !Array.isArray(value.preserved) ||
    value.preserved.length > PRESERVED.length ||
    new Set(value.preserved).size !== value.preserved.length ||
    value.preserved.some((name) => !(PRESERVED as readonly string[]).includes(name))
  )
    throw new Error('Invalid backup restore journal');
  return value;
}

function saveJournal(root: string, value: Journal): void {
  const temporary = join(root, `${JOURNAL}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    syncFile(temporary);
    renameSync(temporary, join(root, JOURNAL));
    syncDirectory(root);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function move(source: string, destination: string): void {
  renameSync(source, destination);
  syncDirectory(dirname(source));
  if (dirname(source) !== dirname(destination)) syncDirectory(dirname(destination));
}

function removeJournal(root: string): void {
  rmSync(join(root, JOURNAL));
  syncDirectory(root);
}

function finishCommitted(root: string, value: Journal): void {
  const live = join(root, 'pb_data');
  const original = join(root, value.original);
  const stage = join(root, value.stage);
  if (!directory(live)) throw new Error('Committed backup restore data is missing');
  for (const name of value.preserved) {
    if (!directory(join(live, name)) || directory(join(original, name)))
      throw new Error('Committed backup restore local directories are missing or ambiguous');
  }
  for (const path of [original, stage]) {
    if (directory(path)) {
      inspectTree(path);
      rmSync(path, { recursive: true });
    }
  }
  syncDirectory(root);
  removeJournal(root);
}

function validatePreserved(live: string, original: string, names: string[]): void {
  // Check every directory before moving any. A conflict leaves both copies for recovery.
  for (const name of names) {
    if (directory(join(original, name)) === directory(join(live, name)))
      throw new Error('Backup restore local directories are missing or ambiguous');
  }
}

function undo(root: string, value: Journal): void {
  const live = join(root, 'pb_data');
  const original = join(root, value.original);
  const stage = join(root, value.stage);
  const hasOriginal = directory(original);
  const hasLive = directory(live);
  const hasStage = directory(stage);
  if (!hasOriginal && !hasLive) throw new Error('Original backup restore data is missing');
  for (const path of [original, live, stage]) if (directory(path)) inspectTree(path);
  validatePreserved(live, original, value.preserved);
  if (hasOriginal) {
    for (const name of value.preserved) {
      if (!directory(join(original, name))) move(join(live, name), join(original, name));
    }
    if (hasLive) {
      rmSync(live, { recursive: true });
      syncDirectory(root);
    }
    move(original, live);
  }
  if (hasStage) rmSync(stage, { recursive: true });
  syncDirectory(root);
  removeJournal(root);
}

/** Run only during cold startup, before opening or creating PocketBase data. */
export function recoverInterruptedRestore(dataDir: string): void {
  if (!inspect(dataDir)) return;
  const root = rootPath(dataDir);
  const value = readJournal(root);
  if (!value) return;
  // Validate roots even if a child directory is absent, so symlink parents cannot
  // redirect recovery or committed cleanup.
  for (const name of ['pb_data', value.original, value.stage]) directory(join(root, name));
  if (value.committed) finishCommitted(root, value);
  else undo(root, value);
}

/** The caller must stop PocketBase before installation and before rollback. */
export function installPreparedRestore(
  dataDir: string,
  preparedStage: string,
): BackupRestoreTransaction {
  const root = rootPath(dataDir);
  if (readJournal(root)) throw new Error('Another backup restore needs recovery');
  const stageName = basename(preparedStage);
  if (!STAGE_PATTERN.test(stageName) || realpathSync(dirname(preparedStage)) !== root)
    throw new Error('Invalid prepared backup restore directory');
  const stage = join(root, stageName);
  const live = join(root, 'pb_data');
  inspectTree(live);
  inspectTree(stage);
  if (!inspect(join(stage, 'data.db'))?.isFile())
    throw new Error('Prepared backup restore database is missing');
  for (const name of [...PRESERVED, '.pb_temp_to_delete'])
    rmSync(join(stage, name), { recursive: true, force: true });
  inspectTree(stage, true);
  const value: Journal = {
    version: 1,
    stage: stageName,
    original: `.relay-backup-original-${randomUUID()}`,
    committed: false,
    preserved: PRESERVED.filter((name) => directory(join(live, name))),
  };
  const original = join(root, value.original);
  if (inspect(original)) throw new Error('Backup restore original directory already exists');
  saveJournal(root, value);
  try {
    move(live, original);
    move(stage, live);
    for (const name of value.preserved) move(join(original, name), join(live, name));
  } catch (error) {
    // A failed rollback deliberately retains the journal and both trees.
    undo(root, value);
    throw error;
  }
  let outcome: 'pending' | 'committed' | 'rolled back' = 'pending';
  return {
    commit(): void {
      if (outcome === 'rolled back') throw new Error('Backup restore was rolled back');
      if (outcome === 'committed') return;
      try {
        saveJournal(root, { ...value, committed: true });
      } catch (error) {
        // A directory sync may fail after the atomic marker replacement. Never
        // roll back a commit already visible to cold-start recovery; retain its
        // journal so cleanup can retry after restart.
        if (readJournal(root)?.committed) {
          outcome = 'committed';
          return;
        }
        throw error;
      }
      outcome = 'committed';
      try {
        finishCommitted(root, { ...value, committed: true });
      } catch {
        // Restoration is committed. Cold startup can retry leftover cleanup.
      }
    },
    rollback(): void {
      if (outcome === 'committed' || readJournal(root)?.committed)
        throw new Error('Backup restore was committed');
      if (outcome === 'rolled back') return;
      undo(root, value);
      outcome = 'rolled back';
    },
  };
}
