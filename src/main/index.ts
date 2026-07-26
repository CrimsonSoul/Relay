import { app, BrowserWindow, session, dialog, ipcMain, crashReporter, safeStorage } from 'electron';
import { join } from 'node:path';
import { loggers } from './logger';
import { AppConfig, type ServerConfig } from './config/AppConfig';
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
  getDynatraceWindowManager,
  getPbClient,
  getDynatraceProblemsManager,
  setDynatraceProblemsManager,
  getCloudStatusManager,
  setCloudStatusManager,
  setKnowledgePdfService,
  setKnowledgeCoverService,
  getKnowledgeUploadService,
  getKnowledgePdfService,
  getKnowledgeCoverService,
  getKnowledgeSearchService,
  setKnowledgeUploadService,
  getPrivilegedRuntime,
  getPrivilegedHost,
  setPrivilegedRuntime,
  setPrivilegedHost,
  subscribePrivilegedSessionChanged,
  getRelayWebServerManager,
  setRelayWebServerManager,
} from './app/appState';
import { setupMaintenanceTasks } from './app/maintenanceTasks';
import { createWindow, createAuxWindow, showAndFocusWindow } from './app/windowFactory';
import { setupErrorHandlers } from './app/errorHandlers';
import { configureHardwareAcceleration } from './app/hardwareAcceleration';
import { scheduleGpuDiagnostics } from './app/gpuDiagnostics';
import { createDeferredServerServices } from './app/deferredServerServices';
import { requestAppQuit } from './app/relaunch';
import { setupAppLifecycleListeners, startMemoryHeartbeat } from './app/processLifecycle';
import { runCrashWatchdogIfRequested, startCrashWatchdog } from './app/watchdog';
import {
  cancelDeferredPocketBaseServices,
  startDeferredPocketBaseServices,
  startPocketBase,
} from './app/pocketbaseBootstrap';
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
  createProductionPrivilegedHost,
  createProductionPrivilegedRuntime,
} from './privileged/privilegedRuntime';
import {
  restartKnowledgeSearchRuntime,
  stopKnowledgeSearchRuntime,
} from './knowledge/knowledgeSearchRuntime';
import { RelayWebServerManager } from './web/RelayWebServerManager';
import { resolveRendererStaticRoot } from './web/rendererStaticRoot';
import { RelayWebGateway } from './web/RelayWebGateway';
import { createWebSessionAuthenticator } from './web/WebSessionAuthenticator';
import { createOperationalServices } from './services/operationalServices';
import { PrivilegedAccountManager } from './privileged/PrivilegedAccountManager';
import { KnowledgeIndexStatusService } from './knowledge/KnowledgeIndexStatusService';
import { createStartupStateController } from './app/startupState';
import { createStartupTimeline } from './app/startupTimeline';
import { setupStartupIpc, shouldExitAfterStartupBenchmark } from './app/startupIpc';
import { assertRequiredStartupSucceeded, runStartupSequence } from './app/startupSequence';
import { scheduleWindowsRuntimeCleanup } from './app/windowsRuntimeCleanup';
import { installStartupBenchmarkExitMarker } from './app/startupBenchmark';
import { configureWindowsApplicationIdentity } from './app/windowsTaskbarIdentity';

const startupState = createStartupStateController();
const startupTimeline = createStartupTimeline();

async function waitForStartupTestDelay(): Promise<void> {
  if (process.env.NODE_ENV !== 'test') return;
  const requestedDelay = Number(process.env.RELAY_E2E_STARTUP_DELAY_MS);
  if (!Number.isFinite(requestedDelay) || requestedDelay <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, Math.min(requestedDelay, 5_000)));
}

// Ensure a consistent userData path for portable builds on Windows.
// Without this, portable .exe instances launched from different locations
// may resolve to different userData dirs and bypass the single-instance lock.
if (process.platform === 'win32') {
  const portableUserData = join(app.getPath('appData'), 'Relay');
  app.setPath('userData', portableUserData);
}
configureWindowsApplicationIdentity(app, {
  platform: process.platform,
  isPackaged: app.isPackaged,
});

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
  installStartupBenchmarkExitMarker({ environment: process.env, tempPath: app.getPath('temp') });
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
  });

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
    let cleanupStartupIpc: (() => void) | null = null;
    let stopMemoryHeartbeat: (() => void) | null = null;
    let stopKnowledgeUploadSession: (() => void) | null = null;
    let resolveWorkspace: ((config: ReturnType<AppConfig['load']>) => void) | null = null;
    let rejectWorkspace: ((error: unknown) => void) | null = null;
    let workspaceSettled = false;
    let startupSequence: Promise<ReturnType<AppConfig['load']>> | null = null;
    let deferredServerServices: ReturnType<typeof createDeferredServerServices> | null = null;
    let cancelGpuDiagnostics: (() => void) | null = null;
    let cancelWindowsRuntimeCleanup: (() => void) | null = null;
    let cleanupComplete = false;
    const cleanupAppResources = () => {
      if (cleanupComplete) return;
      cleanupComplete = true;

      loggers.main.info('App quitting — cleaning up resources');
      stopPeriodicCleanup();
      cleanupMaintenance?.();
      cleanupMaintenance = null;
      cleanupStartupIpc?.();
      cleanupStartupIpc = null;
      stopMemoryHeartbeat?.();
      stopMemoryHeartbeat = null;
      stopKnowledgeUploadSession?.();
      stopKnowledgeUploadSession = null;
      deferredServerServices?.cancel();
      cancelDeferredPocketBaseServices();
      cancelGpuDiagnostics?.();
      cancelGpuDiagnostics = null;
      cancelWindowsRuntimeCleanup?.();
      cancelWindowsRuntimeCleanup = null;
      getDynatraceProblemsManager()?.stop();
      getCloudStatusManager()?.stop();
      void getRelayWebServerManager()?.stop();
      setRelayWebServerManager(null);
      getKnowledgeUploadService()?.handleSessionChanged({
        state: 'signed-out',
        accountId: null,
        username: null,
        displayName: null,
        role: null,
        capabilities: [],
        deviceId: null,
        expiresAt: null,
      });
      void getKnowledgeUploadService()?.dispose();
      setKnowledgeUploadService(null);
      void stopKnowledgeSearchRuntime();
      void (getPrivilegedHost()?.dispose() ?? getPrivilegedRuntime()?.dispose());
      setPrivilegedHost(null);
      setPrivilegedRuntime(null);
      setKnowledgePdfService(null);
      setKnowledgeCoverService(null);
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

      startupTimeline.mark('electron-ready');
      loggers.main.info('Electron ready, performing setup...');
      loggers.main.info('Crash dumps path:', { path: app.getPath('crashDumps') });

      setupPermissions(session.defaultSession);
      cleanupStartupIpc = setupStartupIpc(startupState, startupTimeline, {
        onRendererMounted: () => {
          if (shouldExitAfterStartupBenchmark(process.env)) {
            requestAppQuit('startup-benchmark-complete');
            return;
          }
          if (process.env.RELAY_DISABLE_GPU_DIAGNOSTICS === '1') return;
          cancelGpuDiagnostics?.();
          cancelGpuDiagnostics = scheduleGpuDiagnostics(app, loggers.main);
        },
      });

      const workspaceReady = new Promise<ReturnType<AppConfig['load']>>((resolve, reject) => {
        resolveWorkspace = resolve;
        rejectWorkspace = reject;
      });
      startupSequence = runStartupSequence({
        controller: startupState,
        createWindow: () =>
          createWindow({
            onWindowCreated: () => startupTimeline.mark('window-created'),
            onShellReady: () => startupTimeline.mark('shell-ready'),
          }),
        prepareWorkspace: () => workspaceReady,
      });
      // The outer bootstrap catch owns user-facing failure handling. Attach a
      // rejection observer immediately so an early renderer-load failure is
      // never reported as an unhandled promise while required setup unwinds.
      void startupSequence.catch(() => undefined);

      // Initialize AppConfig — PocketBase data always lives in %APPDATA%/Relay/data,
      // NOT in any custom dataRoot.
      setAppConfig(new AppConfig(configDataDir));
      const authenticateWebSession = createWebSessionAuthenticator({
        getAppConfig,
        getPbProcess,
      });
      setRelayWebServerManager(
        new RelayWebServerManager({
          staticRoot: resolveRendererStaticRoot(),
          createGateway: (config) =>
            new RelayWebGateway({
              config,
              authenticate: authenticateWebSession,
              privilegedHost: getPrivilegedHost(),
              getAccountManager: () => {
                const pb = getPbClient();
                if (
                  !pb?.authStore.isValid ||
                  pb.authStore.record?.collectionName !== '_superusers'
                ) {
                  return null;
                }
                return new PrivilegedAccountManager({
                  pb,
                  onCredentialChanged: (accountId) =>
                    getPrivilegedHost()?.handleAuthorityChanged([accountId]),
                });
              },
              operationalServices: createOperationalServices({
                getCloudStatusManager,
                getDynatraceWindowManager,
                getDynatraceProblemsManager,
                getAppConfig,
                getDataRoot,
              }),
              knowledgeServices: {
                pdf: {
                  getPdf: async (request) =>
                    (await getKnowledgePdfService()?.getPdf(request)) ?? {
                      ok: false,
                      error: 'not-found',
                    },
                },
                cover: {
                  getCover: async (request) =>
                    (await getKnowledgeCoverService()?.getCover(request)) ?? {
                      ok: false,
                      error: 'not-found',
                    },
                },
                index: new KnowledgeIndexStatusService(getPbClient),
                search: {
                  search: async (request) =>
                    (await getKnowledgeSearchService()?.search(request)) ?? {
                      ok: false,
                      requestId: request.requestId,
                      error: 'unavailable',
                    },
                  cancel: (requestId) => getKnowledgeSearchService()?.cancel(requestId),
                },
              },
              knowledgeUploadRoot: join(app.getPath('temp'), 'Relay', 'web-knowledge-staging'),
            }),
        }),
      );
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
      deferredServerServices = createDeferredServerServices({
        startDataManagers: startServerDataManagers,
        startPocketBaseServices: startDeferredPocketBaseServices,
      });

      const stopPrivilegedAccess = async () => {
        const runtime = getPrivilegedRuntime();
        const host = getPrivilegedHost();
        setPrivilegedRuntime(null);
        setPrivilegedHost(null);
        getKnowledgeUploadService()?.handleSessionChanged({
          state: 'signed-out',
          accountId: null,
          username: null,
          displayName: null,
          role: null,
          capabilities: [],
          deviceId: null,
          expiresAt: null,
        });
        await (host?.dispose() ?? runtime?.dispose());
      };

      const startPrivilegedAccess = async (config: NonNullable<ReturnType<AppConfig['load']>>) => {
        await stopPrivilegedAccess();
        try {
          const productionOptions = {
            config,
            dataDir: configDataDir,
            serverClient: config.mode === 'server' ? getPbClient() : null,
            dynatraceProblemsManager: getDynatraceProblemsManager(),
          };
          const host =
            config.mode === 'server'
              ? await createProductionPrivilegedHost(productionOptions)
              : null;
          const runtime = host
            ? host.createElectronRuntime()
            : await createProductionPrivilegedRuntime(productionOptions);
          setPrivilegedHost(host);
          setPrivilegedRuntime(runtime);
          getKnowledgeUploadService()?.handleSessionChanged(runtime.getView());
        } catch (error) {
          loggers.security.warn('Could not initialize privileged access', { error });
        }
      };

      const startServerServices = async (config: ServerConfig): Promise<boolean> => {
        const result = await startPocketBase(config, configDataDir, {
          onHealthy: () => startupTimeline.mark('pocketbase-healthy'),
          onCredentialsReady: () => startupTimeline.mark('credentials-ready'),
          onSchemaReady: () => startupTimeline.mark('schema-ready'),
        });
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
        await getRelayWebServerManager()?.applyConfig(config);
        return true;
      };

      const startServerServicesAfterReady = async (config: ServerConfig): Promise<boolean> => {
        const started = await startServerServices(config);
        if (started) deferredServerServices?.schedule(config);
        return started;
      };

      // Resolve data root before loading the renderer
      loggers.main.info('Starting data initialization...');
      try {
        setCurrentDataRoot(await getDataRoot());
        startupTimeline.mark('data-root');
        loggers.main.info('Data root:', { path: getCurrentDataRoot() });
      } catch (error) {
        loggers.main.error('Failed to initialize data root', { error });
      }

      if (!getCurrentDataRoot()) {
        throw new Error(
          'Failed to initialize data root directory. The application cannot continue.',
        );
      }

      // Register PocketBase bootstrap IPC early so it's available when the renderer loads.
      setupPocketbaseConnectionHandlers(getAppConfig, getPbProcess, getOfflineCache);

      // Start PocketBase on demand (called after first-time setup)
      ipcMain.handle(IPC_CHANNELS.PB_START, async (event) => {
        if (!assertTrustedIpcSender(event, IPC_CHANNELS.PB_START)) return false;
        const config = getAppConfig()?.load();
        if (config?.mode !== 'server') return false;
        await getRelayWebServerManager()?.stop();
        await stopPrivilegedAccess();
        return startServerServicesAfterReady(config);
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
        return reconfigureRuntime(configDataDir, { startupState });
      });

      const restartPb = async (): Promise<boolean> => {
        const config = getAppConfig()?.load();
        if (config?.mode !== 'server') return false;
        await getRelayWebServerManager()?.stop();
        await stopPrivilegedAccess();
        return startServerServicesAfterReady(config);
      };
      setupIpc(createAuxWindow, restartPb);

      // Register shutdown cleanup before starting embedded services so an early
      // startup failure cannot leave PocketBase or SQLite handles behind.
      app.on('before-quit', cleanupAppResources);

      // Required server startup must settle before the workspace can publish
      // ready, even though the window and static shell are already visible.
      const relayConfig = getAppConfig()?.load();
      if (relayConfig?.mode === 'server') {
        const serverStarted = await startServerServices(relayConfig);
        assertRequiredStartupSucceeded(
          serverStarted,
          'Relay could not start its PocketBase workspace.',
        );
      }

      // Open the local client cache before the renderer asks for its bootstrap
      // connection. Server authentication is deferred, so this step remains
      // LAN/VPN independent and preserves a cache-backed cold start.
      if (relayConfig?.mode === 'client') {
        try {
          const { initializeClientOfflineInfrastructure } =
            await import('./app/clientOfflineInfrastructure');
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

      await waitForStartupTestDelay();
      startupTimeline.mark('workspace-ready');
      workspaceSettled = true;
      resolveWorkspace?.(relayConfig);
      await startupSequence;
      if (relayConfig?.mode === 'server') {
        deferredServerServices?.schedule(relayConfig);
      } else if (relayConfig?.mode === 'client') {
        void restartKnowledgeSearchRuntime();
      }
      startPeriodicCleanup();
      cleanupMaintenance = setupMaintenanceTasks(cleanupKnowledgePdfCache);
      stopMemoryHeartbeat = startMemoryHeartbeat();
      cancelWindowsRuntimeCleanup = scheduleWindowsRuntimeCleanup({
        isPackaged: app.isPackaged,
        onComplete: ({ removed, failed }) => {
          if (removed.length === 0 && failed.length === 0) return;
          loggers.main.info('Windows runtime cleanup completed', {
            removed: removed.length,
            failed: failed.length,
          });
        },
        onError: (error) => {
          loggers.main.warn('Windows runtime cleanup failed', { error });
        },
      });

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
      if (!workspaceSettled) {
        workspaceSettled = true;
        rejectWorkspace?.(error);
      }
      await startupSequence?.catch(() => undefined);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      loggers.main.error('Failed to start application', { error: errorMessage });
      dialog.showErrorBox('Critical Startup Error', errorMessage);
      cleanupAppResources();
      requestAppQuit('startup-failed');
    }
  };

  // Avoid top-level await — it deadlocks app.whenReady() in Electron ES modules
  // on certain macOS versions (confirmed on macOS 26). Start an explicit async
  // runner so module evaluation completes synchronously and the event loop stays
  // unblocked while still handling an unexpected rejection.
  const runBootstrap = async (): Promise<void> => {
    try {
      await bootstrap();
    } catch (error_) {
      loggers.main.error('Unexpected bootstrap failure', { error: error_ });
      requestAppQuit('bootstrap-failed');
    }
  };
  void runBootstrap();

  // Global Exception Handlers
  setupErrorHandlers();
  setupAppLifecycleListeners();
} else if (!isCrashWatchdog) {
  requestAppQuit('single-instance-lock-unavailable');
}
