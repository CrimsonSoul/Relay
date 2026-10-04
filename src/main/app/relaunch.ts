import { app, dialog } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loggers } from '../logger';

const EXIT_FALLBACK_DELAY_MS = 250;
const RELAUNCH_MARKER_FILE = 'last-relaunch.json';
const RELAUNCH_HISTORY_FILE = 'relaunch-history.json';
const RELAUNCH_LOOP_WINDOW_MS = 10 * 60_000;
const RELAUNCH_LOOP_LIMIT = 3;

type AppRelaunchOptions = {
  exitCode?: number;
  execPath?: string;
};

let relaunchInProgress = false;

/** True when `history` already holds RELAUNCH_LOOP_LIMIT relaunches inside the window. */
export function shouldBlockRelaunch(history: number[], now: number): boolean {
  const recent = history.filter((t) => now - t <= RELAUNCH_LOOP_WINDOW_MS);
  return recent.length >= RELAUNCH_LOOP_LIMIT;
}

/** Prune stale entries and append the current relaunch timestamp. */
export function appendToRelaunchHistory(history: number[], now: number): number[] {
  return [...history.filter((t) => now - t <= RELAUNCH_LOOP_WINDOW_MS), now];
}

function readRelaunchHistory(): number[] {
  try {
    const historyPath = join(app.getPath('userData'), RELAUNCH_HISTORY_FILE);
    if (!existsSync(historyPath)) return [];
    const parsed: unknown = JSON.parse(readFileSync(historyPath, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((t): t is number => typeof t === 'number') : [];
  } catch {
    return [];
  }
}

function writeRelaunchHistory(history: number[]): void {
  try {
    const userDataPath = app.getPath('userData');
    mkdirSync(userDataPath, { recursive: true });
    writeFileSync(join(userDataPath, RELAUNCH_HISTORY_FILE), JSON.stringify(history), 'utf8');
  } catch (error) {
    loggers.main.warn('Failed to write relaunch history', { error });
  }
}

function recordRelaunch(reason: string, exitCode: number): void {
  try {
    const userDataPath = app.getPath('userData');
    mkdirSync(userDataPath, { recursive: true });
    writeFileSync(
      join(userDataPath, RELAUNCH_MARKER_FILE),
      JSON.stringify({
        reason,
        pid: process.pid,
        uptimeSec: Math.round(process.uptime()),
        at: new Date().toISOString(),
        exitCode,
      }),
      'utf8',
    );
  } catch (error) {
    loggers.main.warn('Failed to record lifecycle marker', {
      reason,
      markerFile: RELAUNCH_MARKER_FILE,
      error,
    });
  }
}

export function requestAppQuit(reason: string): void {
  loggers.main.error('Quitting Relay', { reason });
  app.quit();
}

export function requestAppRelaunch(reason: string, options: AppRelaunchOptions = {}): void {
  if (relaunchInProgress) {
    loggers.main.warn('Relaunch already in progress; ignoring duplicate request', { reason });
    return;
  }

  const now = Date.now();
  const history = readRelaunchHistory();
  if (shouldBlockRelaunch(history, now)) {
    loggers.main.error('Relaunch loop detected — refusing to relaunch again', {
      reason,
      recentRelaunches: history.length,
    });
    if (app.isReady()) {
      dialog.showErrorBox(
        'Relay keeps restarting',
        'Relay restarted several times in a row and will now stay closed. Check the logs in the app data folder and start Relay manually.',
      );
    }
    requestAppQuit(`relaunch-loop:${reason}`);
    return;
  }
  writeRelaunchHistory(appendToRelaunchHistory(history, now));

  relaunchInProgress = true;

  const exitCode = options.exitCode ?? 0;

  loggers.main.error('Relaunching Relay', {
    reason,
    exitCode,
    exitDelayMs: EXIT_FALLBACK_DELAY_MS,
    execPath: options.execPath,
  });
  recordRelaunch(reason, exitCode);
  if (options.execPath) {
    app.relaunch({ execPath: options.execPath });
  } else {
    app.relaunch();
  }
  app.quit();

  // Force the exit only if a graceful quit stalls.
  setTimeout(() => {
    app.exit(exitCode);
  }, EXIT_FALLBACK_DELAY_MS).unref();
}
