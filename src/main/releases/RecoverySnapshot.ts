import {
  cp,
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BUILD_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const MINIMUM_FREE_MARGIN_BYTES = 512 * 1_024 * 1_024;
const MAX_TREE_ENTRIES = 250_000;

type StatFsResult = { bavail: number | bigint; bsize: number | bigint };

type RecoverySnapshotOptions = {
  userDataRoot: string;
  dataDirectory: string;
  transactionId: string;
  sourceBuildId: string;
  dataEpoch: number;
  createPrivateDirectory: (path: string) => unknown | Promise<unknown>;
  snapshotId: string;
  now?: () => Date;
  statfs?: (path: string) => Promise<StatFsResult>;
};

export type RecoveryServerSnapshot = {
  snapshotId: string;
  path: string;
  bytes: number;
};

function isDirectChild(parent: string, child: string, expectedName: string): boolean {
  const childRelative = relative(parent, child);
  return !isAbsolute(childRelative) && childRelative === expectedName;
}

async function inspectTreeEntry(path: string, pending: string[]): Promise<number> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink()) {
    throw new Error('Relay server data contained a symbolic link');
  }
  if (stats.isDirectory()) {
    pending.push(path);
    return 0;
  }
  if (!stats.isFile()) {
    throw new Error('Relay server data contained an unsupported filesystem entry');
  }
  return stats.size;
}

async function inspectTree(root: string): Promise<number> {
  const pending = [root];
  let bytes = 0;
  let entriesSeen = 0;
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      entriesSeen += 1;
      if (entriesSeen > MAX_TREE_ENTRIES) throw new Error('Relay data tree was too large to scan');
      const path = join(directory, entry.name);
      bytes += await inspectTreeEntry(path, pending);
      if (!Number.isSafeInteger(bytes)) throw new Error('Relay data size was invalid');
    }
  }
  return bytes;
}

async function ensurePrivateSnapshotsRoot(
  userDataRoot: string,
  createPrivateDirectory: RecoverySnapshotOptions['createPrivateDirectory'],
): Promise<string> {
  const snapshotsRoot = join(userDataRoot, 'RecoverySnapshots');
  try {
    await lstat(snapshotsRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await createPrivateDirectory(snapshotsRoot);
  }
  const [realUserDataRoot, stats, resolvedSnapshotsRoot] = await Promise.all([
    realpath(userDataRoot),
    lstat(snapshotsRoot),
    realpath(snapshotsRoot),
  ]);
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    !isDirectChild(realUserDataRoot, resolvedSnapshotsRoot, 'RecoverySnapshots')
  ) {
    throw new Error('Relay recovery snapshots directory was redirected');
  }
  return snapshotsRoot;
}

function availableBytes(result: StatFsResult): bigint {
  return BigInt(result.bavail) * BigInt(result.bsize);
}

export async function createRecoveryServerSnapshot(
  options: RecoverySnapshotOptions,
): Promise<RecoveryServerSnapshot> {
  if (
    !UUID_V4_PATTERN.test(options.transactionId) ||
    !UUID_V4_PATTERN.test(options.snapshotId) ||
    !BUILD_ID_PATTERN.test(options.sourceBuildId) ||
    !Number.isSafeInteger(options.dataEpoch) ||
    options.dataEpoch <= 0
  ) {
    throw new TypeError('Recovery snapshot identity was invalid');
  }

  const [realUserDataRoot, dataStats, realDataDirectory] = await Promise.all([
    realpath(options.userDataRoot),
    lstat(options.dataDirectory),
    realpath(options.dataDirectory),
  ]);
  if (
    !dataStats.isDirectory() ||
    dataStats.isSymbolicLink() ||
    !isDirectChild(realUserDataRoot, realDataDirectory, 'data')
  ) {
    throw new Error('Relay server data directory was redirected');
  }

  const bytes = await inspectTree(options.dataDirectory);
  const readStatFs = options.statfs ?? statfs;
  const filesystem = await readStatFs(options.userDataRoot);
  const requiredBytes = BigInt(bytes) * 2n + BigInt(MINIMUM_FREE_MARGIN_BYTES);
  if (availableBytes(filesystem) < requiredBytes) {
    throw new Error('Relay does not have enough free space for a recovery snapshot');
  }

  const snapshotsRoot = await ensurePrivateSnapshotsRoot(
    options.userDataRoot,
    options.createPrivateDirectory,
  );
  const finalPath = join(snapshotsRoot, options.snapshotId);
  const stagingPath = `${finalPath}.staging`;
  try {
    await lstat(finalPath);
    throw new Error('Recovery snapshot already exists');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await rm(stagingPath, { recursive: true, force: true });
  await mkdir(stagingPath, { mode: 0o700 });
  try {
    await cp(options.dataDirectory, join(stagingPath, 'data'), {
      recursive: true,
      force: false,
      errorOnExist: true,
      verbatimSymlinks: true,
    });
    const copiedBytes = await inspectTree(join(stagingPath, 'data'));
    if (copiedBytes !== bytes) throw new Error('Recovery snapshot size changed during copying');
    const createdAt = (options.now ?? (() => new Date()))().toISOString();
    await writeFile(
      join(stagingPath, 'snapshot.ini'),
      `${[
        '[Snapshot]',
        'protocol=1',
        `snapshotId=${options.snapshotId}`,
        `transactionId=${options.transactionId}`,
        `sourceBuildId=${options.sourceBuildId}`,
        `dataEpoch=${options.dataEpoch}`,
        `bytes=${bytes}`,
        `createdAt=${createdAt}`,
        'complete=1',
      ].join('\r\n')}\r\n`,
      { encoding: 'utf8', mode: 0o600, flag: 'wx' },
    );
    await rename(stagingPath, finalPath);
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return { snapshotId: options.snapshotId, path: finalPath, bytes };
}
