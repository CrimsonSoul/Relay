import { lstat, open, readdir, readFile, realpath, rm } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseRecoveryCatalog } from '../releases/RecoveryCatalog';

const BUILD_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const STAGING_DIRECTORY_PATTERN = /^\.staging-[a-z0-9._-]{1,96}$/;
const RESERVED_WINDOWS_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);
const RUNTIME_MARKER = '.relay-runtime-ready';
const QUARANTINE_CREATED_MARKER = '.relay-quarantine-created';
const STALE_STAGING_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CLEANUP_DELAY_MS = 5 * 60 * 1000;
const SNAPSHOT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SNAPSHOT_MARKER_MAX_BYTES = 32 * 1024;

export type WindowsRuntimeCleanupResult = {
  removed: string[];
  skipped: string[];
  failed: string[];
};

type CleanupOptions = {
  root: string;
  execPath: string;
  userDataRoot?: string;
  nowMs?: number;
  staleStagingAgeMs?: number;
  acquireLock?: (root: string) => Promise<(() => Promise<void>) | null>;
};

type ManagedRoot = { root: string; runtimeRoot: string };

type ManagedSnapshotRoot = { userDataRoot: string; snapshotsRoot: string };

type CleanupContext = {
  managedRoot: ManagedRoot;
  requestedRoot: string;
  executingBuild: string;
  nowMs: number;
  staleStagingAgeMs: number;
};

type TimerHandle = ReturnType<typeof setTimeout>;

type ScheduleOptions = {
  platform?: NodeJS.Platform;
  isPackaged?: boolean;
  localAppData?: string;
  execPath?: string;
  userDataRoot?: string;
  delayMs?: number;
  cleanup?: (options: CleanupOptions) => Promise<WindowsRuntimeCleanupResult>;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
  onComplete?: (result: WindowsRuntimeCleanupResult) => void;
  onError?: (error: unknown) => void;
};

function isBuildId(value: string | undefined): value is string {
  if (typeof value !== 'string' || !BUILD_ID_PATTERN.test(value) || value.endsWith('.')) {
    return false;
  }
  // String.split always yields at least one element; fall back to the whole value anyway
  // so a reserved device name can never slip through as a build id.
  const [firstSegment = value] = value.split('.', 1);
  return !RESERVED_WINDOWS_NAMES.has(firstSegment);
}

function isAsciiDigits(value: string): boolean {
  return value.length > 0 && [...value].every((character) => character >= '0' && character <= '9');
}

function isQuarantineDirectory(value: string): boolean {
  const prefix = '.corrupt-';
  if (!value.startsWith(prefix)) return false;
  const tickSeparator = value.lastIndexOf('-');
  const processSeparator = value.lastIndexOf('-', tickSeparator - 1);
  if (processSeparator < prefix.length || tickSeparator <= processSeparator + 1) return false;

  return (
    isBuildId(value.slice(prefix.length, processSeparator)) &&
    isAsciiDigits(value.slice(processSeparator + 1, tickSeparator)) &&
    isAsciiDigits(value.slice(tickSeparator + 1))
  );
}

function readRelayIni(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  let inRelaySection = false;

  for (const sourceLine of text.split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      inRelaySection = line.toLowerCase() === '[relay]';
      continue;
    }
    if (!inRelaySection) continue;

    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    result[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }

  return result;
}

async function executingBuildId(runtimeRoot: string, execPath: string): Promise<string | null> {
  let resolvedExecPath: string;
  try {
    resolvedExecPath = await realpath(resolve(execPath));
  } catch {
    return null;
  }
  const relativeExec = relative(runtimeRoot, resolvedExecPath);
  if (!relativeExec || isAbsolute(relativeExec) || relativeExec === '..') return null;
  if (relativeExec.startsWith(`..${sep}`)) return null;

  const parts = relativeExec.split(sep);
  if (parts.length !== 2 || parts[1]?.toLowerCase() !== 'relay.exe') return null;
  return isBuildId(parts[0]) ? parts[0] : null;
}

async function resolveManagedRoot(root: string): Promise<ManagedRoot | null> {
  const requestedRoot = resolve(root);
  const requestedRuntimeRoot = resolve(requestedRoot, 'Runtime');
  try {
    const [rootStats, runtimeStats] = await Promise.all([
      lstat(requestedRoot),
      lstat(requestedRuntimeRoot),
    ]);
    if (
      !rootStats.isDirectory() ||
      rootStats.isSymbolicLink() ||
      !runtimeStats.isDirectory() ||
      runtimeStats.isSymbolicLink()
    ) {
      return null;
    }

    const [realRoot, realRuntimeRoot] = await Promise.all([
      realpath(requestedRoot),
      realpath(requestedRuntimeRoot),
    ]);
    if (relative(realRoot, realRuntimeRoot).toLowerCase() !== 'runtime') return null;
    return { root: realRoot, runtimeRoot: realRuntimeRoot };
  } catch {
    return null;
  }
}

async function acquireBootstrapLock(root: string): Promise<(() => Promise<void>) | null> {
  try {
    const handle = await open(join(root, 'bootstrap.lock'), 'a+');
    return async () => handle.close();
  } catch {
    // The NSIS bootstrap opens this file with no sharing while it mutates runtime state.
    return null;
  }
}

function sameManagedRoot(first: ManagedRoot, second: ManagedRoot): boolean {
  return (
    first.root.toLowerCase() === second.root.toLowerCase() &&
    first.runtimeRoot.toLowerCase() === second.runtimeRoot.toLowerCase()
  );
}

async function isSafeDeletionPath(
  managedRoot: ManagedRoot,
  requestedRoot: string,
  path: string,
  name: string,
): Promise<boolean> {
  const currentRoot = await resolveManagedRoot(requestedRoot);
  if (!currentRoot || !sameManagedRoot(managedRoot, currentRoot)) return false;

  try {
    const [stats, resolvedPath] = await Promise.all([lstat(path), realpath(path)]);
    if (!stats.isDirectory() || stats.isSymbolicLink()) return false;
    const relativePath = relative(currentRoot.runtimeRoot, resolvedPath);
    return !isAbsolute(relativePath) && relativePath === name;
  } catch {
    return false;
  }
}

async function readPreservedBuilds(
  root: string,
  executingBuild: string,
): Promise<Set<string> | null> {
  const preserved = new Set([executingBuild]);
  try {
    const stateText = await readFile(join(root, 'state.ini'), 'utf8');
    const state = readRelayIni(stateText);
    if ((state.protocol !== '1' && state.protocol !== '2') || !isBuildId(state.current)) {
      return null;
    }
    if (await hasPendingRecoveryRequest(root)) return null;
    if (state.protocol === '2') {
      const catalog = parseRecoveryCatalog(stateText);
      if (!catalog || catalog.transaction) return null;
      for (const build of catalog.builds) preserved.add(build.buildId);
      return preserved;
    }
    preserved.add(state.current);
    for (const buildId of [state.previous]) {
      if (!buildId) continue;
      if (!isBuildId(buildId)) return null;
      preserved.add(buildId);
    }
    return preserved;
  } catch {
    // A missing or malformed state file must disable complete-runtime deletion.
    return null;
  }
}

async function isCompleteRuntime(directory: string, buildId: string): Promise<boolean> {
  try {
    const marker = readRelayIni(await readFile(join(directory, RUNTIME_MARKER), 'utf8'));
    return (marker.protocol === '1' || marker.protocol === '2') && marker.buildId === buildId;
  } catch {
    return false;
  }
}

async function removeTransientRuntime(
  context: CleanupContext,
  name: string,
  path: string,
  directoryMtimeMs: number,
  result: WindowsRuntimeCleanupResult,
): Promise<boolean> {
  const isStaging = STAGING_DIRECTORY_PATTERN.test(name);
  const isQuarantine = isQuarantineDirectory(name);
  if (!isStaging && !isQuarantine) return false;

  let createdAtMs = directoryMtimeMs;
  if (isQuarantine) {
    try {
      const markerStats = await lstat(join(path, QUARANTINE_CREATED_MARKER));
      if (!markerStats.isFile() || markerStats.isSymbolicLink()) {
        result.skipped.push(name);
        return true;
      }
      createdAtMs = markerStats.mtimeMs;
    } catch {
      result.skipped.push(name);
      return true;
    }
  }

  if (context.nowMs - createdAtMs < context.staleStagingAgeMs) {
    result.skipped.push(name);
    return true;
  }
  if (!(await isSafeDeletionPath(context.managedRoot, context.requestedRoot, path, name))) {
    result.skipped.push(name);
    return true;
  }
  await rm(path, { recursive: true, force: true });
  result.removed.push(name);
  return true;
}

async function removeCompleteRuntime(
  context: CleanupContext,
  name: string,
  path: string,
  result: WindowsRuntimeCleanupResult,
): Promise<void> {
  const preserved = await readPreservedBuilds(context.managedRoot.root, context.executingBuild);
  if (
    !isBuildId(name) ||
    !preserved ||
    preserved.has(name) ||
    !(await isCompleteRuntime(path, name))
  ) {
    result.skipped.push(name);
    return;
  }
  if (!(await isSafeDeletionPath(context.managedRoot, context.requestedRoot, path, name))) {
    result.skipped.push(name);
    return;
  }
  await rm(path, { recursive: true, force: true });
  result.removed.push(name);
}

async function cleanupRuntimeEntry(
  entry: Dirent,
  context: CleanupContext,
  result: WindowsRuntimeCleanupResult,
): Promise<void> {
  const name = entry.name;
  const path = join(context.managedRoot.runtimeRoot, name);
  try {
    const stats = await lstat(path);
    if (!entry.isDirectory() || entry.isSymbolicLink() || stats.isSymbolicLink()) {
      result.skipped.push(name);
      return;
    }
    if (await removeTransientRuntime(context, name, path, stats.mtimeMs, result)) return;
    await removeCompleteRuntime(context, name, path, result);
  } catch {
    result.failed.push(name);
  }
}

async function hasPendingRecoveryRequest(root: string): Promise<boolean> {
  const recoveryRoot = join(root, 'Recovery');
  try {
    const [stats, realRecoveryRoot] = await Promise.all([
      lstat(recoveryRoot),
      realpath(recoveryRoot),
    ]);
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      relative(root, realRecoveryRoot) !== 'Recovery'
    ) {
      return true;
    }
    for (const name of [
      'update-request.ini',
      'rollback-request.ini',
      'repair-request.ini',
      'prepared.ini',
    ]) {
      try {
        await lstat(join(realRecoveryRoot, name));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return true;
      }
    }
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
}

async function readPreservedSnapshotIds(root: string): Promise<Set<string> | null> {
  try {
    const catalog = parseRecoveryCatalog(await readFile(join(root, 'state.ini'), 'utf8'));
    if (!catalog || catalog.transaction || (await hasPendingRecoveryRequest(root))) return null;
    return new Set(
      catalog.builds.flatMap((build) =>
        build.rollbackSnapshotId ? [build.rollbackSnapshotId] : [],
      ),
    );
  } catch {
    return null;
  }
}

async function resolveManagedSnapshotRoot(
  userDataRoot: string,
): Promise<ManagedSnapshotRoot | null> {
  if (!isAbsolute(userDataRoot)) return null;
  const requestedUserDataRoot = resolve(userDataRoot);
  const requestedSnapshotsRoot = join(requestedUserDataRoot, 'RecoverySnapshots');
  try {
    const [userDataStats, snapshotsStats, realUserDataRoot, realSnapshotsRoot] = await Promise.all([
      lstat(requestedUserDataRoot),
      lstat(requestedSnapshotsRoot),
      realpath(requestedUserDataRoot),
      realpath(requestedSnapshotsRoot),
    ]);
    if (
      !userDataStats.isDirectory() ||
      userDataStats.isSymbolicLink() ||
      !snapshotsStats.isDirectory() ||
      snapshotsStats.isSymbolicLink() ||
      relative(realUserDataRoot, realSnapshotsRoot) !== 'RecoverySnapshots'
    ) {
      return null;
    }
    return { userDataRoot: realUserDataRoot, snapshotsRoot: realSnapshotsRoot };
  } catch {
    return null;
  }
}

async function isCompleteSnapshot(directory: string, snapshotId: string): Promise<boolean> {
  const markerPath = join(directory, 'snapshot.ini');
  try {
    const stats = await lstat(markerPath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > SNAPSHOT_MARKER_MAX_BYTES) {
      return false;
    }
    const marker = await readFile(markerPath, 'utf8');
    const values: Record<string, string> = {};
    let inSnapshot = false;
    for (const sourceLine of marker.split(/\r?\n/)) {
      const line = sourceLine.trim();
      if (!line) continue;
      if (line.startsWith('[') && line.endsWith(']')) {
        inSnapshot = line === '[Snapshot]';
        continue;
      }
      if (!inSnapshot) continue;
      const separator = line.indexOf('=');
      if (separator <= 0) return false;
      const key = line.slice(0, separator).trim();
      if (!key || key in values) return false;
      values[key] = line.slice(separator + 1).trim();
    }
    return values.protocol === '1' && values.snapshotId === snapshotId && values.complete === '1';
  } catch {
    return false;
  }
}

async function isSafeSnapshotDeletionPath(
  initialRoot: ManagedSnapshotRoot,
  requestedUserDataRoot: string,
  path: string,
  snapshotId: string,
): Promise<boolean> {
  const currentRoot = await resolveManagedSnapshotRoot(requestedUserDataRoot);
  if (
    currentRoot?.userDataRoot.toLowerCase() !== initialRoot.userDataRoot.toLowerCase() ||
    currentRoot?.snapshotsRoot.toLowerCase() !== initialRoot.snapshotsRoot.toLowerCase()
  ) {
    return false;
  }
  try {
    const [stats, realPath] = await Promise.all([lstat(path), realpath(path)]);
    return (
      stats.isDirectory() &&
      !stats.isSymbolicLink() &&
      relative(currentRoot.snapshotsRoot, realPath) === snapshotId
    );
  } catch {
    return false;
  }
}

async function cleanupRecoverySnapshots(
  root: string,
  userDataRoot: string,
  result: WindowsRuntimeCleanupResult,
): Promise<void> {
  const managedSnapshotRoot = await resolveManagedSnapshotRoot(userDataRoot);
  if (!managedSnapshotRoot) return;
  let entries: Dirent[];
  try {
    entries = await readdir(managedSnapshotRoot.snapshotsRoot, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const label = `snapshot:${entry.name}`;
    const path = join(managedSnapshotRoot.snapshotsRoot, entry.name);
    try {
      const preserved = await readPreservedSnapshotIds(root);
      const stats = await lstat(path);
      if (
        !preserved ||
        !SNAPSHOT_ID_PATTERN.test(entry.name) ||
        preserved.has(entry.name) ||
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        !stats.isDirectory() ||
        stats.isSymbolicLink() ||
        !(await isCompleteSnapshot(path, entry.name)) ||
        !(await isSafeSnapshotDeletionPath(managedSnapshotRoot, userDataRoot, path, entry.name))
      ) {
        result.skipped.push(label);
        continue;
      }
      await rm(path, { recursive: true, force: true });
      result.removed.push(label);
    } catch {
      result.failed.push(label);
    }
  }
}

export async function cleanupWindowsRuntimes({
  root,
  execPath,
  userDataRoot,
  nowMs = Date.now(),
  staleStagingAgeMs = STALE_STAGING_AGE_MS,
  acquireLock = acquireBootstrapLock,
}: CleanupOptions): Promise<WindowsRuntimeCleanupResult> {
  const result: WindowsRuntimeCleanupResult = { removed: [], skipped: [], failed: [] };
  const initialManagedRoot = await resolveManagedRoot(root);
  if (!initialManagedRoot) return result;
  const releaseLock = await acquireLock(initialManagedRoot.root);
  if (!releaseLock) return result;

  try {
    const managedRoot = await resolveManagedRoot(root);
    if (!managedRoot || !sameManagedRoot(initialManagedRoot, managedRoot)) return result;
    const executingBuild = await executingBuildId(managedRoot.runtimeRoot, execPath);
    if (!executingBuild) return result;

    let entries: Dirent[];
    try {
      entries = await readdir(managedRoot.runtimeRoot, { withFileTypes: true });
    } catch {
      return result;
    }

    const context: CleanupContext = {
      managedRoot,
      requestedRoot: root,
      executingBuild,
      nowMs,
      staleStagingAgeMs,
    };
    for (const entry of entries) {
      await cleanupRuntimeEntry(entry, context, result);
    }
    if (userDataRoot) await cleanupRecoverySnapshots(managedRoot.root, userDataRoot, result);
  } finally {
    await releaseLock();
  }

  result.removed.sort((left, right) => left.localeCompare(right));
  result.skipped.sort((left, right) => left.localeCompare(right));
  result.failed.sort((left, right) => left.localeCompare(right));
  return result;
}

export function scheduleWindowsRuntimeCleanup(options: ScheduleOptions = {}): () => void {
  const platform = options.platform ?? process.platform;
  const isPackaged = options.isPackaged ?? false;
  const localAppData = options.localAppData ?? process.env.LOCALAPPDATA;
  if (platform !== 'win32' || !isPackaged || !localAppData) return () => undefined;

  const cleanup = options.cleanup ?? cleanupWindowsRuntimes;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const timer = setTimer(() => {
    void cleanup({
      root: join(localAppData, 'Relay'),
      execPath: options.execPath ?? process.execPath,
      userDataRoot: options.userDataRoot,
    }).then(options.onComplete, options.onError);
  }, options.delayMs ?? DEFAULT_CLEANUP_DELAY_MS);
  timer.unref?.();

  return () => clearTimer(timer);
}
