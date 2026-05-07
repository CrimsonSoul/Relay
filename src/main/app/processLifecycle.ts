import {
  app,
  BrowserWindow,
  type Details,
  type RenderProcessGoneDetails,
  type WebContents,
} from 'electron';
import { loggers } from '../logger';
import { broadcastToAllWindows } from '../utils/broadcastToAllWindows';

const MB = 1024 * 1024;
const UNRESPONSIVE_WARN_AFTER_MS = 5_000;
const UNRESPONSIVE_RECOVERY_AFTER_MS = 30_000;
const MEMORY_HEARTBEAT_INTERVAL_MS = 5 * 60_000;

// Reload guard: prevent reload loops if the renderer is crashing repeatedly.
const RELOAD_WINDOW_MS = 10 * 60_000;
const MAX_RELOADS_IN_WINDOW = 3;
const reloadTimestamps = new WeakMap<WebContents, number[]>();
const gpuGoneTimestamps: number[] = [];

function getRecentReloads(contents: WebContents, now = Date.now()): number[] {
  const history = reloadTimestamps.get(contents) ?? [];
  return history.filter((t) => t > now - RELOAD_WINDOW_MS);
}

function canAutoReload(contents: WebContents): boolean {
  const recent = getRecentReloads(contents);
  reloadTimestamps.set(contents, recent);
  return recent.length < MAX_RELOADS_IN_WINDOW;
}

function shouldAutoReload(contents: WebContents): boolean {
  const now = Date.now();
  const recent = getRecentReloads(contents, now);
  if (recent.length >= MAX_RELOADS_IN_WINDOW) {
    reloadTimestamps.set(contents, recent);
    return false;
  }
  recent.push(now);
  reloadTimestamps.set(contents, recent);
  return true;
}

function getWebContentsSnapshot(contents: WebContents): Record<string, unknown> {
  try {
    return {
      id: contents.id,
      type: contents.getType(),
      url: contents.getURL(),
      destroyed: contents.isDestroyed(),
      crashed: contents.isCrashed(),
    };
  } catch (error) {
    return { error };
  }
}

function notifyCrashLoopSuppressed(label: string): void {
  loggers.main.error(
    `Auto-reload suppressed for ${label}: ${MAX_RELOADS_IN_WINDOW} recoveries within ${RELOAD_WINDOW_MS / 60_000}m`,
  );
  broadcastToAllWindows('app:error-notification', {
    title: 'Relay is unstable',
    message: 'A window failed repeatedly and was not reloaded automatically. Please restart Relay.',
  });
}

function reloadWebContents(
  contents: WebContents,
  label: string,
  reason: string,
  options: { ignoringCache?: boolean } = {},
): void {
  if (contents.isDestroyed()) return;

  if (!shouldAutoReload(contents)) {
    notifyCrashLoopSuppressed(label);
    return;
  }

  loggers.main.warn(`Recovering ${label}: ${reason}`, {
    ignoringCache: options.ignoringCache === true,
    snapshot: getWebContentsSnapshot(contents),
  });
  broadcastToAllWindows('app:error-notification', {
    title: 'Relay recovered a window',
    message: 'The affected view reloaded automatically. Unsaved changes may be lost.',
  });

  try {
    if (options.ignoringCache) {
      contents.reloadIgnoringCache();
    } else {
      contents.reload();
    }
  } catch (err) {
    loggers.main.error(`Failed to reload ${label}`, { error: err });
  }
}

export function attachWebContentsLifecycleListeners(
  contents: WebContents,
  options: { label: string; autoReload: boolean },
): void {
  const { label, autoReload } = options;

  // Renderer process died (crash, oom, killed, etc.)
  contents.on('render-process-gone', (_event, details: RenderProcessGoneDetails) => {
    loggers.main.error(`Renderer process gone (${label})`, {
      reason: details.reason,
      exitCode: details.exitCode,
      uptimeSec: Math.round(process.uptime()),
      snapshot: getWebContentsSnapshot(contents),
    });

    // clean-exit is normal shutdown — don't reload.
    if (details.reason === 'clean-exit' || !autoReload) return;

    reloadWebContents(contents, label, 'renderer process exited');
  });

  // Renderer failed to load the initial HTML/URL.
  contents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return; // iframe failures are noise
    loggers.main.error(`did-fail-load (${label})`, {
      errorCode,
      errorDescription,
      validatedURL,
    });
  });

  // Preload script crashed — breaks all IPC from that renderer.
  contents.on('preload-error', (_event, preloadPath, error) => {
    loggers.main.error(`Preload error (${label})`, {
      preloadPath,
      error: error?.message,
      stack: error?.stack,
    });
  });
}

export function attachWindowLifecycleListeners(
  win: BrowserWindow,
  options: { label: string; autoReload: boolean },
): void {
  const { label, autoReload } = options;
  const wc = win.webContents;

  attachWebContentsLifecycleListeners(wc, options);

  // Hang detection — renderer event loop stalled.
  let unresponsiveSince: number | null = null;
  let recoveryTimer: NodeJS.Timeout | null = null;

  const clearRecoveryTimer = () => {
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = null;
  };

  win.on('unresponsive', () => {
    unresponsiveSince = Date.now();
    loggers.main.warn(`Window unresponsive (${label})`, {
      threshold: `${UNRESPONSIVE_WARN_AFTER_MS}ms`,
      recoveryAfterMs: UNRESPONSIVE_RECOVERY_AFTER_MS,
      snapshot: getWebContentsSnapshot(wc),
    });

    if (!autoReload || recoveryTimer) return;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      if (win.isDestroyed() || unresponsiveSince === null) return;

      loggers.main.error(`Window still unresponsive; forcing renderer recovery (${label})`, {
        hangMs: Date.now() - unresponsiveSince,
        snapshot: getWebContentsSnapshot(wc),
      });

      if (!canAutoReload(wc)) {
        notifyCrashLoopSuppressed(label);
        return;
      }

      try {
        wc.forcefullyCrashRenderer();
      } catch (error) {
        loggers.main.error(`Failed to force crash hung renderer (${label})`, { error });
        reloadWebContents(wc, label, 'renderer hung past recovery threshold', {
          ignoringCache: true,
        });
      }
    }, UNRESPONSIVE_RECOVERY_AFTER_MS);
    recoveryTimer.unref();
  });

  win.on('responsive', () => {
    const duration = unresponsiveSince ? Date.now() - unresponsiveSince : null;
    unresponsiveSince = null;
    clearRecoveryTimer();
    loggers.main.warn(`Window responsive again (${label})`, { hangMs: duration });
  });

  win.once('closed', () => {
    clearRecoveryTimer();
  });
}

function pruneGpuGoneHistory(now: number): void {
  while (gpuGoneTimestamps.length > 0 && gpuGoneTimestamps[0] < now - RELOAD_WINDOW_MS) {
    gpuGoneTimestamps.shift();
  }
}

function recoverWindowsAfterGpuFailure(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    reloadWebContents(win.webContents, 'gpu-recovery', 'GPU process exited', {
      ignoringCache: true,
    });
  }
}

/** App-level listeners for GPU / utility child process crashes. */
export function setupAppLifecycleListeners(): void {
  app.on('child-process-gone', (_event, details: Details) => {
    const base = {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      serviceName: details.serviceName,
      name: details.name,
    };
    // GPU crashes are the most suspicious for "black window" reports; flag them loudly.
    if (details.type === 'GPU') {
      loggers.main.error('GPU process gone', base);
      const now = Date.now();
      gpuGoneTimestamps.push(now);
      pruneGpuGoneHistory(now);

      if (gpuGoneTimestamps.length >= MAX_RELOADS_IN_WINDOW) {
        loggers.main.error('Repeated GPU failures detected; relaunching Relay', {
          failures: gpuGoneTimestamps.length,
          windowMs: RELOAD_WINDOW_MS,
        });
        app.relaunch();
        app.exit(0);
        return;
      }

      setTimeout(recoverWindowsAfterGpuFailure, 1_000).unref();
    } else {
      loggers.main.warn('Child process gone', base);
    }
  });
}

/**
 * Periodic per-process memory snapshot. Helps diagnose slow leaks that lead to
 * renderer OOM after multi-day uptime. Returns a stop function.
 */
export function startMemoryHeartbeat(): () => void {
  const tick = async () => {
    try {
      const metrics = app.getAppMetrics();
      const summary = metrics.map((m) => ({
        pid: m.pid,
        type: m.type,
        name: m.name,
        workingSetMB: Math.round((m.memory?.workingSetSize ?? 0) / 1024), // kB → MB
        peakWorkingSetMB: Math.round((m.memory?.peakWorkingSetSize ?? 0) / 1024),
        cpuPct: m.cpu?.percentCPUUsage ?? 0,
      }));
      const mainMem = process.memoryUsage();
      loggers.main.info('memory-heartbeat', {
        uptimeSec: Math.round(process.uptime()),
        mainHeapUsedMB: Math.round(mainMem.heapUsed / MB),
        mainHeapTotalMB: Math.round(mainMem.heapTotal / MB),
        mainRssMB: Math.round(mainMem.rss / MB),
        processes: summary,
      });
    } catch (err) {
      loggers.main.warn('memory-heartbeat failed', { error: err });
    }
  };

  const interval = setInterval(tick, MEMORY_HEARTBEAT_INTERVAL_MS);
  // First sample shortly after startup settles.
  setTimeout(tick, 30_000).unref();
  interval.unref();

  return () => clearInterval(interval);
}
