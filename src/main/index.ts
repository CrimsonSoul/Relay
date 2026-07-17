import { app, BrowserWindow, session, dialog, ipcMain, crashReporter, safeStorage } from 'electron';
import { join } from 'node:path';
import { loggers } from './logger';
import { AppConfig } from './config/AppConfig';
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
  setDynatraceWindowManager,
  getPbClient,
  getDynatraceProblemsManager,
  setDynatraceProblemsManager,
  getCloudStatusManager,
  setCloudStatusManager,
  setKnowledgePdfService,
  getKnowledgeUploadService,
  setKnowledgeUploadService,
  getPrivilegedRuntime,
  setPrivilegedRuntime,
  subscribePrivilegedSessionChanged,
} from './app/appState';
import { setupMaintenanceTasks } from './app/maintenanceTasks';
import { createWindow, createAuxWindow, showAndFocusWindow } from './app/windowFactory';
import { setupErrorHandlers } from './app/errorHandlers';
import { configureHardwareAcceleration } from './app/hardwareAcceleration';
import { requestAppQuit } from './app/relaunch';
import { setupAppLifecycleListeners, startMemoryHeartbeat } from './app/processLifecycle';
import { runCrashWatchdogIfRequested, startCrashWatchdog } from './app/watchdog';
import { initializeClientOfflineInfrastructure } from './app/clientOfflineInfrastructure';
import { startPocketBase } from './app/pocketbaseBootstrap';
import { stopAdvertising } from './discovery/RelayDiscovery';
import { reconfigureRuntime } from './app/runtimeReconfigure';
import { startPeriodicCleanup, stopPeriodicCleanup } from './credentialManager';
import { setupPocketbaseConnectionHandlers } from './handlers/pocketbaseConnectionHandlers';
import { assertTrustedIpcSender } from './utils/trustedSender';
import { DynatraceDashboardStore } from './dynatrace/DynatraceDashboardStore';
import { DynatraceWindowManager } from './dynatrace/DynatraceWindowManager';
import { DynatraceProblemsConfigStore } from './dynatrace/DynatraceProblemsConfigStore';
import { DynatraceProblemsManager } from './dynatrace/DynatraceProblemsManager';
import { CloudStatusManager } from './handlers/cloudStatus/CloudStatusManager';
import {
  cleanupKnowledgePdfCache,
  initializeKnowledgePdfService,
} from './knowledge/knowledgeRuntime';
import { KnowledgeUploadQueueStore } from './knowledge/KnowledgeUploadQueueStore';
import { KnowledgeUploadService } from './knowledge/KnowledgeUploadService';
import {
  createProductionPrivilegedRuntime,
  installPrivilegedE2EControl,
} from './privileged/privilegedRuntime';

// Ensure a consistent userData path for portable builds on Windows.
// Without this, portable .exe instances launched from different locations
// may resolve to different userData dirs and bypass the single-instance lock.
if (process.platform === 'win32') {
  const portableUserData = join(app.getPath('appData'), 'Relay');
  app.setPath('userData', portableUserData);
}

// Validate environment early
validateEnv();

const isCrashWatchdog = runCrashWatchdogIfRequested();

const hardwareAccelerationDisabled = configureHardwareAcceleration(app);
const devDeviceScaleFactor = process.env.RELAY_TEST_DEVICE_SCALE_FACTOR;
if (!app.isPackaged && devDeviceScaleFactor) {
  const parsedScaleFactor = Number(devDeviceScaleFactor);
  if (Number.isFinite(parsedScaleFactor) && parsedScaleFactor > 0) {
    app.commandLine.appendSwitch('force-device-scale-factor', String(parsedScaleFactor));
  }
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

const gotLock = !isCrashWatchdog && app.requestSingleInstanceLock();
if (gotLock) {
  startCrashWatchdog();

  app.on('second-instance', () => {
    // Someone tried to run a second instance. Explicitly show the existing
    // window as well as focusing it in case startup left it hidden.
    showAndFocusWindow(getMainWindow(), 'second-instance');
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
    if (process.platform !== 'darwin' || process.env.NODE_ENV === 'test') {
      requestAppQuit('all-windows-closed');
    }
  });

  loggers.main.info('Waiting for Electron ready...');

  const configDataDir = join(app.getPath('userData'), 'data');

  const bootstrap = async () => {
    let cleanupMaintenance: (() => void) | null = null;
    let stopMemoryHeartbeat: (() => void) | null = null;
    let stopKnowledgeUploadSession: (() => void) | null = null;
    let cleanupComplete = false;
    const cleanupPrivilegedE2EControl = installPrivilegedE2EControl(getPrivilegedRuntime);

    const cleanupAppResources = () => {
      if (cleanupComplete) return;
      cleanupComplete = true;

      loggers.main.info('App quitting — cleaning up resources');
      stopPeriodicCleanup();
      cleanupMaintenance?.();
      cleanupMaintenance = null;
      stopMemoryHeartbeat?.();
      stopMemoryHeartbeat = null;
      cleanupPrivilegedE2EControl();
      stopKnowledgeUploadSession?.();
      stopKnowledgeUploadSession = null;
      getDynatraceProblemsManager()?.stop();
      getCloudStatusManager()?.stop();
      getKnowledgeUploadService()?.handleSessionChanged({
        state: 'signed-out',
        accountId: null,
        operatorId: null,
        operatorName: null,
        role: null,
        capabilities: [],
        deviceId: null,
        expiresAt: null,
      });
      void getKnowledgeUploadService()?.dispose();
      setKnowledgeUploadService(null);
      void getPrivilegedRuntime()?.dispose();
      setPrivilegedRuntime(null);
      setKnowledgePdfService(null);
      // PocketBase cleanup — synchronous kill to ensure process dies before app exits
      if (getRetentionManager()) {
        getRetentionManager()!.stop();
        setRetentionManager(null);
      }
      stopAdvertising();
      if (getPbProcess()) {
        getPbProcess()!.killSync();
        setPbProcess(null);
      }
      if (getOfflineCache()) {
        try {
          getOfflineCache()!.close();
        } catch (error) {
          loggers.main.warn('Failed to close offline cache during quit', { error });
        }
        setOfflineCache(null);
      }
      if (getPendingChanges()) {
        try {
          getPendingChanges()!.close();
        } catch (error) {
          loggers.main.warn('Failed to close pending changes during quit', { error });
        }
        setPendingChanges(null);
      }
    };

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
      initializeKnowledgePdfService(configDataDir);
      const knowledgeUploadService = new KnowledgeUploadService({
        getRuntime: getPrivilegedRuntime,
        store: new KnowledgeUploadQueueStore({ dataDir: configDataDir, safeStorage }),
        emitSnapshot: (snapshot) => {
          for (const window of BrowserWindow.getAllWindows()) {
            if (!window.isDestroyed()) {
              window.webContents.send(IPC_CHANNELS.KNOWLEDGE_UPLOAD_QUEUE_CHANGED, snapshot);
            }
          }
        },
      });
      setKnowledgeUploadService(knowledgeUploadService);
      stopKnowledgeUploadSession = subscribePrivilegedSessionChanged((view) =>
        knowledgeUploadService.handleSessionChanged(view),
      );
      await knowledgeUploadService.start();
      const dynatraceStore = new DynatraceDashboardStore(configDataDir);
      setDynatraceWindowManager(new DynatraceWindowManager({ store: dynatraceStore }));
      setDynatraceProblemsManager(
        new DynatraceProblemsManager(new DynatraceProblemsConfigStore(configDataDir), getPbClient),
      );
      setCloudStatusManager(new CloudStatusManager(getPbClient));

      const startServerDataManagers = () => {
        getDynatraceProblemsManager()?.start();
        getCloudStatusManager()?.start();
      };

      const stopPrivilegedAccess = async () => {
        const runtime = getPrivilegedRuntime();
        setPrivilegedRuntime(null);
        getKnowledgeUploadService()?.handleSessionChanged({
          state: 'signed-out',
          accountId: null,
          operatorId: null,
          operatorName: null,
          role: null,
          capabilities: [],
          deviceId: null,
          expiresAt: null,
        });
        await runtime?.dispose();
      };

      const startPrivilegedAccess = async (config: NonNullable<ReturnType<AppConfig['load']>>) => {
        await stopPrivilegedAccess();
        try {
          const runtime = await createProductionPrivilegedRuntime({
            config,
            dataDir: configDataDir,
            serverClient: config.mode === 'server' ? getPbClient() : null,
            dynatraceProblemsManager: getDynatraceProblemsManager(),
          });
          setPrivilegedRuntime(runtime);
          getKnowledgeUploadService()?.handleSessionChanged(runtime.getView());
        } catch (error) {
          loggers.security.warn('Could not initialize privileged access', { error });
        }
      };

      const startServerServices = async (
        config: NonNullable<ReturnType<AppConfig['load']>>,
      ): Promise<boolean> => {
        const result = await startPocketBase(config, configDataDir);
        if (result.status !== 'started') return false;
        if (result.privilegedRuntimeReady) {
          await startPrivilegedAccess(config);
        } else {
          loggers.security.warn(
            'Privileged runtime deferred until role account migration completes',
            {
              reason: result.reason,
            },
          );
        }
        startServerDataManagers();
        return true;
      };

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
        requestAppQuit('critical-startup-data-root');
        return;
      }

      // Register PocketBase bootstrap IPC early so it's available when the renderer loads.
      setupPocketbaseConnectionHandlers(getAppConfig, getPbProcess, getOfflineCache);

      // Start PocketBase on demand (called after first-time setup)
      ipcMain.handle(IPC_CHANNELS.PB_START, async (event) => {
        if (!assertTrustedIpcSender(event, IPC_CHANNELS.PB_START)) return false;
        const config = getAppConfig()?.load();
        if (config?.mode !== 'server') return false;
        await stopPrivilegedAccess();
        return startServerServices(config);
      });

      // Runtime reconfigure — used by the setup flow so the main process rebuilds
      // its per-mode state from the new config without closing the app.
      // This now reconfigures in-process and reloads the visible window. Closing
      // the app here made client-mode setup depend on app.relaunch(), so a failed
      // successor launch left users with a closed app.
      ipcMain.handle(IPC_CHANNELS.APP_RELAUNCH, (event) => {
        if (!assertTrustedIpcSender(event, IPC_CHANNELS.APP_RELAUNCH)) return;
        loggers.main.info('Reconfiguring app runtime');
        if (process.env.NODE_ENV === 'test') {
          app.quit();
          return;
        }
        return reconfigureRuntime(configDataDir);
      });

      const restartPb = async (): Promise<boolean> => {
        const config = getAppConfig()?.load();
        if (config?.mode !== 'server') return false;
        await stopPrivilegedAccess();
        return startServerServices(config);
      };
      setupIpc(createAuxWindow, restartPb);

      // Register shutdown cleanup before starting embedded services so an early
      // startup failure cannot leave PocketBase or SQLite handles behind.
      app.on('before-quit', cleanupAppResources);

      // Start PocketBase before the window in server mode so bootstrap
      // connection checks can succeed as soon as the renderer loads.
      const relayConfig = getAppConfig()?.load();
      if (relayConfig?.mode === 'server') {
        await startServerServices(relayConfig);
      }

      // Open the local client cache before the renderer asks for its bootstrap
      // connection. Server authentication is deferred, so this step remains
      // LAN/VPN independent and preserves a cache-backed cold start.
      if (relayConfig?.mode === 'client') {
        try {
          await initializeClientOfflineInfrastructure(configDataDir, relayConfig, {
            deferAuthentication: true,
          });
          loggers.pocketbase.info('Client-mode offline infrastructure initialized');
        } catch (syncErr) {
          loggers.pocketbase.warn(
            'Could not initialize offline infrastructure — local cache unavailable',
            { error: syncErr },
          );
        }
      }

      // Present the UI before optional privileged client initialization. A slow
      // or unreachable LAN/VPN server must never prevent the Relay shell from
      // appearing.
      await createWindow();
      startPeriodicCleanup();
      cleanupMaintenance = setupMaintenanceTasks(cleanupKnowledgePdfCache);
      stopMemoryHeartbeat = startMemoryHeartbeat();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow().catch((error_) => {
            loggers.main.error('Failed to create window on app activate', { error: error_ });
            requestAppQuit('activate-window-create-failed');
          });
        }
      });

      if (relayConfig?.mode === 'client') {
        await startPrivilegedAccess(relayConfig);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      loggers.main.error('Failed to start application', { error: errorMessage });
      dialog.showErrorBox('Critical Startup Error', errorMessage);
      cleanupAppResources();
      requestAppQuit('startup-failed');
    }
  };

  // Avoid top-level await — it deadlocks app.whenReady() in Electron ES modules
  // on certain macOS versions (confirmed on macOS 26). Use .catch() instead so
  // module evaluation completes synchronously and the event loop stays unblocked.
  bootstrap().catch((error_) => {
    loggers.main.error('Unexpected bootstrap failure', { error: error_ });
    requestAppQuit('bootstrap-failed');
  }); // NOSONAR: top-level await can deadlock Electron startup on some macOS versions.

  // Global Exception Handlers
  setupErrorHandlers();
  setupAppLifecycleListeners();
} else if (!isCrashWatchdog) {
  requestAppQuit('single-instance-lock-unavailable');
}
