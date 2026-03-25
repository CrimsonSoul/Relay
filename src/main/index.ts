import { app, BrowserWindow, session, dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import { loggers } from './logger';
import { AppConfig, type ServerConfig, type ClientConfig } from './config/AppConfig';
import { OfflineCache } from './cache/OfflineCache';
import { PendingChanges } from './cache/PendingChanges';
import { SyncManager } from './cache/SyncManager';
import { IPC_CHANNELS } from '@shared/ipc';

import { validateEnv } from './env';
import { state, getDataRoot, setupIpc, setupPermissions } from './app/appState';
import { setupMaintenanceTasks } from './app/maintenanceTasks';
import { createWindow, createAuxWindow } from './app/windowFactory';
import { setupErrorHandlers } from './app/errorHandlers';
import { startPocketBase } from './app/pocketbaseBootstrap';
import { isTrustedWebviewUrl } from './securityPolicy';

// Ensure a consistent userData path for portable builds on Windows.
// Without this, portable .exe instances launched from different locations
// may resolve to different userData dirs and bypass the single-instance lock.
if (process.platform === 'win32') {
  const portableUserData = join(app.getPath('appData'), 'Relay');
  app.setPath('userData', portableUserData);
}

// Validate environment early
validateEnv();

const gotLock = app.requestSingleInstanceLock();
if (gotLock) {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, we should focus our window.
    if (state.mainWindow) {
      if (state.mainWindow.isMinimized()) state.mainWindow.restore();
      state.mainWindow.focus();
    }
  });

  loggers.main.info('Startup Info:', {
    arch: process.arch,
    platform: process.platform,
    electron: process.versions.electron,
    node: process.versions.node,
  });

  // Windows-specific optimizations
  if (process.platform === 'win32') {
    app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
  }

  // App lifecycle
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  loggers.main.info('Waiting for Electron ready...');

  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;

    contents.on('will-navigate', (event, url) => {
      if (isTrustedWebviewUrl(url)) return;
      loggers.security.warn(`Blocked webview navigation to non-allowlisted URL: ${url}`);
      event.preventDefault();
    });

    contents.setWindowOpenHandler(({ url }) => {
      loggers.security.warn(`Blocked webview window.open() attempt: ${url}`);
      return { action: 'deny' };
    });
  });

  const configDataDir = join(app.getPath('userData'), 'data');

  const bootstrap = async () => {
    try {
      if (!app.isReady()) {
        await app.whenReady();
      }

      loggers.main.info('Electron ready, performing setup...');

      setupPermissions(session.defaultSession);
      setupPermissions(session.fromPartition('persist:weather'));
      setupPermissions(session.fromPartition('persist:dispatcher-radar'));

      // Initialize AppConfig — PocketBase data always lives in %APPDATA%/Relay/data,
      // NOT in any custom dataRoot.
      state.appConfig = new AppConfig(configDataDir);

      // Resolve data root before loading the renderer
      loggers.main.info('Starting data initialization...');
      try {
        state.currentDataRoot = await getDataRoot();
        loggers.main.info('Data root:', { path: state.currentDataRoot });
      } catch (error) {
        loggers.main.error('Failed to initialize data root', { error });
      }

      // Start PocketBase if already configured in server mode
      const relayConfig = state.appConfig.load();
      if (relayConfig && relayConfig.mode === 'server') {
        await startPocketBase(relayConfig as ServerConfig, configDataDir);
      }

      // Initialize offline cache infrastructure for client mode.
      // All three components (cache, pending, sync) are initialized together so
      // they're either all available or none — preventing silent data loss from
      // a half-initialized state.
      if (relayConfig && relayConfig.mode === 'client') {
        const clientConfig = relayConfig as ClientConfig;
        try {
          const PocketBase = (await import('pocketbase')).default;
          const syncPb = new PocketBase(clientConfig.serverUrl);
          await syncPb
            .collection('_pb_users_auth_')
            .authWithPassword('relay@relay.app', clientConfig.secret);

          state.offlineCache = new OfflineCache(join(configDataDir, 'cache.db'));
          state.pendingChanges = new PendingChanges(join(configDataDir, 'pending_changes.db'));
          state.syncManager = new SyncManager(syncPb);
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

      // Register PocketBase IPC handlers
      ipcMain.handle(IPC_CHANNELS.PB_GET_URL, () => {
        if (state.pbProcess?.isRunning()) {
          // Server mode: renderer connects to localhost, not 0.0.0.0
          return state.pbProcess.getLocalUrl();
        }
        const config = state.appConfig?.load();
        if (config?.mode === 'client') {
          return config.serverUrl;
        }
        return null;
      });

      // Start PocketBase on demand (called after first-time setup)
      ipcMain.handle(IPC_CHANNELS.PB_START, async () => {
        const config = state.appConfig?.load();
        if (!config || config.mode !== 'server') return false;
        return startPocketBase(config as ServerConfig, configDataDir);
      });

      // Intentional: the plaintext passphrase is sent to the renderer for PB SDK auth.
      // This is an accepted tradeoff for the shared-passphrase LAN use case. The renderer
      // is sandboxed + context-isolated, and the passphrase is already known to all operators
      // who use the tool. If the threat model ever includes untrusted renderer content,
      // switch to a token-exchange approach where main authenticates and passes only the
      // PB auth token (not the master passphrase).
      ipcMain.handle(IPC_CHANNELS.PB_GET_SECRET, () => {
        const config = state.appConfig?.load();
        return config?.secret ?? null;
      });

      const restartPb = async (): Promise<boolean> => {
        const config = state.appConfig?.load();
        if (!config || config.mode !== 'server') return false;
        return startPocketBase(config as ServerConfig, configDataDir);
      };
      setupIpc(createAuxWindow, restartPb);
      await createWindow();
      const cleanupMaintenance = setupMaintenanceTasks();

      // Graceful shutdown: clean up file watchers, timers, etc.
      app.on('before-quit', () => {
        loggers.main.info('App quitting — cleaning up resources');
        cleanupMaintenance();
        // PocketBase cleanup — synchronous kill to ensure process dies before app exits
        if (state.retentionManager) {
          state.retentionManager.stop();
          state.retentionManager = null;
        }
        if (state.pbProcess) {
          state.pbProcess.killSync();
          state.pbProcess = null;
        }
        if (state.offlineCache) {
          state.offlineCache.close();
          state.offlineCache = null;
        }
        if (state.pendingChanges) {
          state.pendingChanges.close();
          state.pendingChanges = null;
        }
      });

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow().catch((error_) => {
            loggers.main.error('Failed to create window on app activate', { error: error_ });
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
} else {
  app.quit();
}
