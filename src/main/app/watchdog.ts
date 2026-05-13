import { app } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loggers } from '../logger';

const WATCHDOG_POLL_MS = 2_000;
const WATCHDOG_FLAG = '--relay-watchdog';
const PARENT_PID_PREFIX = '--relay-parent-pid=';
const STARTED_AT_PREFIX = '--relay-watchdog-started-at=';
const RESTARTED_FLAG = '--relay-restarted-by-watchdog';
const LAST_EXIT_MARKER = 'last-exit.json';

type WatchdogOptions = {
  platform?: NodeJS.Platform;
  isPackaged?: boolean;
  execPath?: string;
  pid?: number;
  argv?: string[];
  env?: NodeJS.ProcessEnv;
};

type WatchdogArgs = {
  parentPid: number;
  startedAt: number;
};

export function parseWatchdogArgs(argv = process.argv): WatchdogArgs | null {
  if (!argv.includes(WATCHDOG_FLAG)) return null;

  const parentPidArg = argv.find((arg) => arg.startsWith(PARENT_PID_PREFIX));
  const startedAtArg = argv.find((arg) => arg.startsWith(STARTED_AT_PREFIX));
  const parentPid = Number(parentPidArg?.slice(PARENT_PID_PREFIX.length));
  const startedAt = Number(startedAtArg?.slice(STARTED_AT_PREFIX.length));

  if (!Number.isInteger(parentPid) || parentPid <= 0 || !Number.isFinite(startedAt)) {
    return null;
  }

  return { parentPid, startedAt };
}

export function shouldRestartAfterParentExit({
  lastExitMarker,
  startedAt,
}: {
  lastExitMarker: string | null;
  startedAt: number;
}): boolean {
  if (!lastExitMarker) return true;

  try {
    const marker = JSON.parse(lastExitMarker) as { at?: unknown };
    if (typeof marker.at !== 'string') return true;

    const markerTime = Date.parse(marker.at);
    return !Number.isFinite(markerTime) || markerTime < startedAt;
  } catch {
    return true;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLastExitMarker(): string | null {
  const markerPath = join(app.getPath('userData'), LAST_EXIT_MARKER);
  if (!existsSync(markerPath)) return null;
  return readFileSync(markerPath, 'utf8');
}

function spawnDetachedRelay(execPath: string, args: string[]): void {
  const child = spawn(execPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

export function startCrashWatchdog(options: WatchdogOptions = {}): void {
  const platform = options.platform ?? process.platform;
  const isPackaged = options.isPackaged ?? app.isPackaged;
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;

  if (platform !== 'win32' || !isPackaged || env.RELAY_DISABLE_CRASH_WATCHDOG === '1') return;
  if (argv.includes(WATCHDOG_FLAG)) return;

  const execPath = options.execPath ?? process.execPath;
  const pid = options.pid ?? process.pid;
  const startedAt = Date.now();

  try {
    spawnDetachedRelay(execPath, [
      WATCHDOG_FLAG,
      `${PARENT_PID_PREFIX}${pid}`,
      `${STARTED_AT_PREFIX}${startedAt}`,
    ]);
    loggers.main.info('Relay crash watchdog started', { pid, startedAt });
  } catch (error) {
    loggers.main.warn('Failed to start Relay crash watchdog', { error });
  }
}

export function runCrashWatchdogIfRequested(argv = process.argv): boolean {
  const args = parseWatchdogArgs(argv);
  if (!args) return false;

  loggers.main.info('Relay crash watchdog running', { parentPid: args.parentPid });

  const interval = setInterval(() => {
    if (isProcessAlive(args.parentPid)) return;

    clearInterval(interval);
    const lastExitMarker = readLastExitMarker();

    if (shouldRestartAfterParentExit({ lastExitMarker, startedAt: args.startedAt })) {
      loggers.main.warn('Relay parent exited unexpectedly; restarting Relay', {
        parentPid: args.parentPid,
      });
      spawnDetachedRelay(process.execPath, [RESTARTED_FLAG]);
    } else {
      loggers.main.info('Relay parent exited intentionally; watchdog will not restart it', {
        parentPid: args.parentPid,
      });
    }

    app.exit(0);
  }, WATCHDOG_POLL_MS);

  return true;
}
