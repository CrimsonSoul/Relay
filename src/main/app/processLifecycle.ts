import { app, BrowserWindow, type Details, type RenderProcessGoneDetails } from 'electron';
import { loggers } from '../logger';
import { broadcastToAllWindows } from '../utils/broadcastToAllWindows';

const MB = 1024 * 1024;
const UNRESPONSIVE_WARN_AFTER_MS = 5_000;
const MEMORY_HEARTBEAT_INTERVAL_MS = 5 * 60_000;

// Reload guard: prevent reload loops if the renderer is crashing repeatedly.
const RELOAD_WINDOW_MS = 10 * 60_000;
const MAX_RELOADS_IN_WINDOW = 3;
const reloadTimestamps = new WeakMap<BrowserWindow, number[]>();

function shouldAutoReload(win: BrowserWindow): boolean {
  const now = Date.now();
  const history = reloadTimestamps.get(win) ?? [];
  const recent = history.filter((t) => t > now - RELOAD_WINDOW_MS);
  if (recent.length >= MAX_RELOADS_IN_WINDOW) {
    reloadTimestamps.set(win, recent);
    return false;
  }
  recent.push(now);
  reloadTimestamps.set(win, recent);
  return true;
}

export function attachWindowLifecycleListeners(
  win: BrowserWindow,
  options: { label: string; autoReload: boolean },
): void {
  const { label, autoReload } = options;
  const wc = win.webContents;

  // Renderer process died (crash, oom, killed, etc.)
  wc.on('render-process-gone', (_event, details: RenderProcessGoneDetails) => {
    loggers.main.error(`Renderer process gone (${label})`, {
      reason: details.reason,
      exitCode: details.exitCode,
      uptimeSec: Math.round(process.uptime()),
    });

    // clean-exit is normal shutdown — don't reload.
    if (details.reason === 'clean-exit' || win.isDestroyed()) return;

    if (!autoReload) return;

    if (!shouldAutoReload(win)) {
      loggers.main.error(
        `Auto-reload suppressed for ${label}: ${MAX_RELOADS_IN_WINDOW} crashes within ${RELOAD_WINDOW_MS / 60_000}m`,
      );
      broadcastToAllWindows('app:error-notification', {
        title: 'Relay is unstable',
        message:
          'The window crashed multiple times and was not reloaded automatically. Please restart Relay.',
      });
      return;
    }

    loggers.main.warn(`Auto-reloading ${label} after renderer crash`);
    broadcastToAllWindows('app:error-notification', {
      title: 'Relay recovered from a crash',
      message: 'The window reloaded automatically. Unsaved changes may be lost.',
    });
    try {
      wc.reload();
    } catch (err) {
      loggers.main.error(`Failed to reload ${label} after crash`, { error: err });
    }
  });

  // Hang detection — renderer event loop stalled.
  let unresponsiveSince: number | null = null;
  win.on('unresponsive', () => {
    unresponsiveSince = Date.now();
    loggers.main.warn(`Window unresponsive (${label})`, {
      threshold: `${UNRESPONSIVE_WARN_AFTER_MS}ms`,
    });
  });
  win.on('responsive', () => {
    const duration = unresponsiveSince ? Date.now() - unresponsiveSince : null;
    unresponsiveSince = null;
    loggers.main.warn(`Window responsive again (${label})`, { hangMs: duration });
  });

  // Renderer failed to load the initial HTML/URL.
  wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return; // iframe/webview failures are noise
    loggers.main.error(`did-fail-load (${label})`, {
      errorCode,
      errorDescription,
      validatedURL,
    });
  });

  // Preload script crashed — breaks all IPC from that renderer.
  wc.on('preload-error', (_event, preloadPath, error) => {
    loggers.main.error(`Preload error (${label})`, {
      preloadPath,
      error: error?.message,
      stack: error?.stack,
    });
  });
}

/** App-level listeners for GPU / utility / webview child process crashes. */
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
