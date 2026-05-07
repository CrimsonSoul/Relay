import { app, BrowserWindow, session, dialog, ipcMain, crashReporter } from 'electron';
import { join } from 'node:path';
import { loggers } from './logger';
import { AppConfig } from './config/AppConfig';
import { OfflineCache } from './cache/OfflineCache';
import { PendingChanges } from './cache/PendingChanges';
import { SyncManager } from './cache/SyncManager';
import { IPC_CHANNELS } from '@shared/ipc';

import { validateEnv } from './env';
import {
  getMainWindow,
  getDataRoot,
  setupIpc,
  setupPermissions,
  getAppConfig,
  setAppConfig,
  getCurrentDataRoot,
  setCurrentDataRoot,
  getPbProcess,
  setPbProcess,
  getRetentionManager,
  setRetentionManager,
  getOfflineCache,
  setOfflineCache,
  getPendingChanges,
  setPendingChanges,
  setSyncManager,
} from './app/appState';
import { setupMaintenanceTasks } from './app/maintenanceTasks';
import { createWindow, createAuxWindow } from './app/windowFactory';
import { setupErrorHandlers } from './app/errorHandlers';
import { setupAppLifecycleListeners, startMemoryHeartbeat } from './app/processLifecycle';
import { startPocketBase } from './app/pocketbaseBootstrap';
import { startPeriodicCleanup, stopPeriodicCleanup } from './credentialManager';
import { setupPocketbaseConnectionHandlers } from './handlers/pocketbaseConnectionHandlers';

// Ensure a consistent userData path for portable builds on Windows.
// Without this, portable .exe instances launched from different locations
// may resolve to different userData dirs and bypass the single-instance lock.
if (process.platform === 'win32') {
  const portableUserData = join(app.getPath('appData'), 'Relay');
  app.setPath('userData', portableUserData);
}

// Validate environment early
validateEnv();

const hardwareAccelerationDisabled = process.env.RELAY_DISABLE_HARDWARE_ACCELERATION === '1';
if (hardwareAccelerationDisabled) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu-compositing');
}
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
}

crashReporter.start({
  uploadToServer: false,
  compress: false,
  globalExtra: {
    productName: app.name,
    appVersion: app.getVersion(),
    platform: process.platform,
  },
});

const gotLock = app.requestSingleInstanceLock();
if (gotLock) {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, we should focus our window.
    const mainWindow = getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  loggers.main.info('Startup Info:', {
    arch: process.arch,
    platform: process.platform,
    electron: process.versions.electron,
    node: process.versions.node,
    hardwareAcceleration: hardwareAccelerationDisabled ? 'disabled' : 'enabled',
    nativeWinOcclusion: process.platform === 'win32' ? 'disabled' : 'unchanged',
  });

  // Windows-specific optimizations
  if (process.platform === 'win32') {
    app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
  }

  // App lifecycle
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' || process.env.NODE_ENV === 'test') app.quit();
  });

  loggers.main.info('Waiting for Electron ready...');

  const configDataDir = join(app.getPath('userData'), 'data');

  const bootstrap = async () => {
    try {
      if (!app.isReady()) {
        await app.whenReady();
      }

      loggers.main.info('Electron ready, performing setup...');
      loggers.main.info('Crash dumps path:', { path: app.getPath('crashDumps') });

      setupPermissions(session.defaultSession);

      // Initialize AppConfig — PocketBase data always lives in %APPDATA%/Relay/data,
      // NOT in any custom dataRoot.
      setAppConfig(new AppConfig(configDataDir));

      // Resolve data root before loading the renderer
      loggers.main.info('Starting data initialization...');
      try {
        setCurrentDataRoot(await getDataRoot());
        loggers.main.info('Data root:', { path: getCurrentDataRoot() });
      } catch (error) {
        loggers.main.error('Failed to initialize data root', { error });
      }

      if (!getCurrentDataRoot()) {
        dialog.showErrorBox(
          'Critical Startup Error',
          'Failed to initialize data root directory. The application cannot continue.',
        );
        app.quit();
        return;
      }

      // Register PocketBase bootstrap IPC early so it's available when the renderer loads.
      setupPocketbaseConnectionHandlers(getAppConfig, getPbProcess);

      // Start PocketBase on demand (called after first-time setup)
      ipcMain.handle(IPC_CHANNELS.PB_START, async () => {
        const config = getAppConfig()?.load();
        if (config?.mode !== 'server') return false;
        return startPocketBase(config, configDataDir);
      });

      // Full app relaunch — used by the setup flow so the main process rebuilds
      // its per-mode state (pbProcess, syncPb, offline cache) from the new config.
      // A renderer-only reload leaves stale state (e.g. the embedded PocketBase
      // still running after switching to client mode) that can misroute or
      // stall the first connection attempt.
      ipcMain.handle(IPC_CHANNELS.APP_RELAUNCH, () => {
        loggers.main.info('Relaunching app (reconfigure)');
        if (process.env.NODE_ENV === 'test') {
          app.quit();
          return;
        }
        app.relaunch();
        app.exit(0);
      });

      const restartPb = async (): Promise<boolean> => {
        const config = getAppConfig()?.load();
        if (config?.mode !== 'server') return false;
        return startPocketBase(config, configDataDir);
      };
      setupIpc(createAuxWindow, restartPb);

      // Start PocketBase before the window in server mode so bootstrap
      // connection checks can succeed as soon as the renderer loads.
      const relayConfig = getAppConfig()?.load();
      if (relayConfig?.mode === 'server') {
        await startPocketBase(relayConfig, configDataDir);
      }

      // Show the window as early as possible — the renderer has its own
      // loading/connecting states and doesn't need the offline cache to be ready.
      await createWindow();
      startPeriodicCleanup();
      const cleanupMaintenance = setupMaintenanceTasks();
      const stopMemoryHeartbeat = startMemoryHeartbeat();

      // Initialize offline cache infrastructure for client mode AFTER the
      // window is visible. All three components (cache, pending, sync) are
      // initialized together so they're either all available or none —
      // preventing silent data loss from a half-initialized state.
      // Auth is capped at 15 s to avoid hanging if the server is unreachable.
      if (relayConfig?.mode === 'client') {
        try {
          const PocketBase = (await import('pocketbase')).default;
          const syncPb = new PocketBase(relayConfig.serverUrl);
          const controller = new AbortController();
          const authTimeout = setTimeout(() => controller.abort(), 15_000);
          try {
            // requestKey: null prevents the PB SDK from replacing our signal
            // with its own internal AbortController.
            await syncPb
              .collection('_pb_users_auth_')
              .authWithPassword('relay@relay.app', relayConfig.secret, {
                signal: controller.signal,
                requestKey: null,
              });
          } finally {
            clearTimeout(authTimeout);
          }

          setOfflineCache(new OfflineCache(join(configDataDir, 'cache.db')));
          setPendingChanges(new PendingChanges(join(configDataDir, 'pending_changes.db')));
          // SyncManager is pre-built infrastructure for future offline-write support.
          // Currently it processes pending changes when explicitly triggered via IPC,
          // but no production code path enqueues changes into PendingChanges yet.
          setSyncManager(new SyncManager(syncPb));
          loggers.pocketbase.info('Client-mode offline infrastructure initialized');
        } catch (syncErr) {
          loggers.pocketbase.warn(
            'Could not initialize offline infrastructure — will retry on reconnect',
            {
              error: syncErr,
            },
          );
        }
      }

      // Graceful shutdown: clean up file watchers, timers, etc.
      app.on('before-quit', () => {
        loggers.main.info('App quitting — cleaning up resources');
        stopPeriodicCleanup();
        cleanupMaintenance();
        stopMemoryHeartbeat();
        // PocketBase cleanup — synchronous kill to ensure process dies before app exits
        if (getRetentionManager()) {
          getRetentionManager()!.stop();
          setRetentionManager(null);
        }
        if (getPbProcess()) {
          getPbProcess()!.killSync();
          setPbProcess(null);
        }
        if (getOfflineCache()) {
          getOfflineCache()!.close();
          setOfflineCache(null);
        }
        if (getPendingChanges()) {
          getPendingChanges()!.close();
          setPendingChanges(null);
        }
      });

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow().catch((error_) => {
            loggers.main.error('Failed to create window on app activate', { error: error_ });
            app.quit();
          });
        }
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      loggers.main.error('Failed to start application', { error: errorMessage });
      dialog.showErrorBox('Critical Startup Error', errorMessage);
      app.quit();
    }
  };

  // Avoid top-level await — it deadlocks app.whenReady() in Electron ES modules
  // on certain macOS versions (confirmed on macOS 26). Use .catch() instead so
  // module evaluation completes synchronously and the event loop stays unblocked.
  bootstrap().catch((error_) => {
    loggers.main.error('Unexpected bootstrap failure', { error: error_ });
    app.quit();
  }); // NOSONAR: top-level await can deadlock Electron startup on some macOS versions.

  // Global Exception Handlers
  setupErrorHandlers();
  setupAppLifecycleListeners();
} else {
  app.quit();
}
