import { app } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loggers } from '../logger';

const DEFAULT_EXIT_DELAY_MS = 250;
const EXIT_MARKER_FILE = 'last-exit.json';
const RELAUNCH_MARKER_FILE = 'last-relaunch.json';

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

function recordRelaunch(reason: AppRelaunchReason, exitCode: number): void {
  writeLifecycleMarker(
    RELAUNCH_MARKER_FILE,
    {
      ...getBaseMarkerPayload(reason),
      exitCode,
    },
    { reason },
  );
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
