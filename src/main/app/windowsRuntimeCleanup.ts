import { lstat, readdir, readFile, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const BUILD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const STAGING_DIRECTORY_PATTERN = /^\.staging-[A-Za-z0-9._-]{1,96}$/;
const RUNTIME_MARKER = '.relay-runtime-ready';
const STALE_STAGING_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CLEANUP_DELAY_MS = 5 * 60 * 1000;

export type WindowsRuntimeCleanupResult = {
  removed: string[];
  skipped: string[];
  failed: string[];
};

type CleanupOptions = {
  root: string;
  execPath: string;
  nowMs?: number;
  staleStagingAgeMs?: number;
};

type TimerHandle = ReturnType<typeof setTimeout>;

type ScheduleOptions = {
  platform?: NodeJS.Platform;
  isPackaged?: boolean;
  localAppData?: string;
  execPath?: string;
  delayMs?: number;
  cleanup?: (options: CleanupOptions) => Promise<WindowsRuntimeCleanupResult>;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
  onComplete?: (result: WindowsRuntimeCleanupResult) => void;
  onError?: (error: unknown) => void;
};

function isBuildId(value: string | undefined): value is string {
  return typeof value === 'string' && BUILD_ID_PATTERN.test(value);
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

function executingBuildId(root: string, execPath: string): string | null {
  const runtimeRoot = resolve(root, 'Runtime');
  const relativeExec = relative(runtimeRoot, resolve(execPath));
  if (!relativeExec || isAbsolute(relativeExec) || relativeExec === '..') return null;
  if (relativeExec.startsWith(`..${sep}`)) return null;

  const parts = relativeExec.split(sep);
  if (parts.length !== 2 || parts[1]?.toLowerCase() !== 'relay.exe') return null;
  return isBuildId(parts[0]) ? parts[0] : null;
}

async function readPreservedBuilds(root: string, executingBuild: string): Promise<Set<string>> {
  const preserved = new Set([executingBuild]);
  try {
    const state = readRelayIni(await readFile(join(root, 'state.ini'), 'utf8'));
    if (state.protocol !== '1') return preserved;
    if (isBuildId(state.current)) preserved.add(state.current);
    if (isBuildId(state.previous)) preserved.add(state.previous);
  } catch {
    // A missing or malformed state file must never broaden deletion scope.
  }
  return preserved;
}

async function isCompleteRuntime(directory: string, buildId: string): Promise<boolean> {
  try {
    const marker = readRelayIni(await readFile(join(directory, RUNTIME_MARKER), 'utf8'));
    return marker.protocol === '1' && marker.buildId === buildId;
  } catch {
    return false;
  }
}

export async function cleanupWindowsRuntimes({
  root,
  execPath,
  nowMs = Date.now(),
  staleStagingAgeMs = STALE_STAGING_AGE_MS,
}: CleanupOptions): Promise<WindowsRuntimeCleanupResult> {
  const result: WindowsRuntimeCleanupResult = { removed: [], skipped: [], failed: [] };
  const executingBuild = executingBuildId(root, execPath);
  if (!executingBuild) return result;

  const runtimeRoot = resolve(root, 'Runtime');
  const preserved = await readPreservedBuilds(root, executingBuild);
  let entries;
  try {
    entries = await readdir(runtimeRoot, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    const name = entry.name;
    const path = join(runtimeRoot, name);
    try {
      const stats = await lstat(path);
      if (!entry.isDirectory() || entry.isSymbolicLink() || stats.isSymbolicLink()) {
        result.skipped.push(name);
        continue;
      }

      if (STAGING_DIRECTORY_PATTERN.test(name)) {
        if (nowMs - stats.mtimeMs < staleStagingAgeMs) {
          result.skipped.push(name);
          continue;
        }
        await rm(path, { recursive: true, force: true });
        result.removed.push(name);
        continue;
      }

      if (!isBuildId(name) || preserved.has(name) || !(await isCompleteRuntime(path, name))) {
        result.skipped.push(name);
        continue;
      }

      await rm(path, { recursive: true, force: true });
      result.removed.push(name);
    } catch {
      result.failed.push(name);
    }
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
    }).then(options.onComplete, options.onError);
  }, options.delayMs ?? DEFAULT_CLEANUP_DELAY_MS);
  timer.unref?.();

  return () => clearTimer(timer);
}
