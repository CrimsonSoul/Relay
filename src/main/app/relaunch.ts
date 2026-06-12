import { app, dialog } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loggers } from '../logger';

const DEFAULT_EXIT_DELAY_MS = 250;
const EXIT_MARKER_FILE = 'last-exit.json';
const RELAUNCH_MARKER_FILE = 'last-relaunch.json';
const RELAUNCH_HISTORY_FILE = 'relaunch-history.json';
const RELAUNCH_LOOP_WINDOW_MS = 10 * 60_000;
const RELAUNCH_LOOP_LIMIT = 3;

export type AppRelaunchReason =
  | 'app-reconfigure'
  | 'fatal-main-process-error'
  | 'repeated-gpu-process-failures'
  | string;

export type AppQuitReason =
  | 'activate-window-create-failed'
  | 'all-windows-closed'
  | 'bootstrap-failed'
  | 'critical-startup-data-root'
  | 'single-instance-lock-unavailable'
  | 'startup-failed'
  | string;

type AppRelaunchOptions = {
  exitCode?: number;
  exitDelayMs?: number;
};

let relaunchInProgress = false;

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  timer.unref();
}

function writeLifecycleMarker(
  markerFile: string,
  payload: Record<string, unknown>,
  logContext: Record<string, unknown>,
): void {
  try {
    const userDataPath = app.getPath('userData');
    mkdirSync(userDataPath, { recursive: true });
    writeFileSync(join(userDataPath, markerFile), JSON.stringify(payload), 'utf8');
  } catch (error) {
    loggers.main.warn('Failed to record lifecycle marker', { ...logContext, markerFile, error });
  }
}

function getBaseMarkerPayload(reason: string): Record<string, unknown> {
  return {
    reason,
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    at: new Date().toISOString(),
  };
}

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

function recordRelaunch(reason: AppRelaunchReason, exitCode: number): void {
  writeLifecycleMarker(
    RELAUNCH_MARKER_FILE,
    {
      ...getBaseMarkerPayload(reason),
      exitCode,
    },
    { reason },
  );
  // Also write the exit marker so the crash watchdog treats this exit as
  // intentional — app.relaunch() spawns the successor itself; without this
  // the watchdog would spawn a second instance in parallel.
  writeLifecycleMarker(EXIT_MARKER_FILE, getBaseMarkerPayload(`relaunch:${reason}`), { reason });
}

function recordQuit(reason: AppQuitReason): void {
  writeLifecycleMarker(EXIT_MARKER_FILE, getBaseMarkerPayload(reason), { reason });
}

export function requestAppQuit(reason: AppQuitReason): void {
  loggers.main.error('Quitting Relay', { reason });
  recordQuit(reason);
  app.quit();
}

export function requestAppRelaunch(
  reason: AppRelaunchReason,
  options: AppRelaunchOptions = {},
): void {
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
  const exitDelayMs = options.exitDelayMs ?? DEFAULT_EXIT_DELAY_MS;

  loggers.main.error('Relaunching Relay', { reason, exitCode, exitDelayMs });
  recordRelaunch(reason, exitCode);
  app.relaunch();
  app.quit();

  if (exitDelayMs <= 0) {
    return;
  }

  const timer = setTimeout(() => {
    app.exit(exitCode);
  }, exitDelayMs);
  unrefTimer(timer);
}
