import {
  app,
  BrowserWindow,
  session,
  dialog,
  ipcMain,
  crashReporter,
  safeStorage,
  powerSaveBlocker,
} from 'electron';
import { dirname, join } from 'node:path';
import recoveryTiming from '../../build/windows/recovery-timing.json';
import { loggers } from './logger';
import { AppConfig, type RelayConfig, type ServerConfig } from './config/AppConfig';
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
  getRadarManager,
  setRadarManager,
  setKnowledgePdfService,
  setKnowledgeCoverService,
  getKnowledgeUploadService,
  notifyKnowledgeUploadSessionChanged,
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
  getWorkstationAwakeService,
  setWorkstationAwakeService,
} from './app/appState';
import { setupMaintenanceTasks } from './app/maintenanceTasks';
import { createWindow, showAndFocusWindow } from './app/windowFactory';
import { setupErrorHandlers } from './app/errorHandlers';
import { configureHardwareAcceleration } from './app/hardwareAcceleration';
import { scheduleGpuDiagnostics } from './app/gpuDiagnostics';
import { createDeferred } from './app/deferred';
import {
  createProductionPrivilegedHost,
  createProductionPrivilegedRuntime,
} from './privileged/privilegedRuntime';
import { createDeferredServerServices } from './app/deferredServerServices';
import { recordAppExitMarker, requestAppQuit } from './app/relaunch';
import { setupAppLifecycleListeners, startMemoryHeartbeat } from './app/processLifecycle';
import { runCrashWatchdogIfRequested, startCrashWatchdog } from './app/watchdog';
import {
  cancelDeferredPocketBaseServices,
  startDeferredPocketBaseServices,
  startPocketBase,
} from './app/pocketbaseBootstrap';
import { stopAdvertising } from './discovery/RelayDiscovery';
import { reconfigureRuntime } from './app/runtimeReconfigure';
import { replacePrivilegedRuntime, stopPrivilegedRuntime } from './app/privilegedRuntimeLifecycle';
import { startPeriodicCleanup, stopPeriodicCleanup } from './credentialManager';
import { setupPocketbaseConnectionHandlers } from './handlers/pocketbaseConnectionHandlers';
import { assertTrustedIpcSender } from './utils/trustedSender';
import { DynatraceDashboardStore } from './dynatrace/DynatraceDashboardStore';
import { DynatraceWindowManager } from './dynatrace/DynatraceWindowManager';
import { DynatraceProblemsConfigStore } from './dynatrace/DynatraceProblemsConfigStore';
import { DynatraceProblemsManager } from './dynatrace/DynatraceProblemsManager';
import { CloudStatusManager } from './handlers/cloudStatus/CloudStatusManager';
import { RadarManager } from './handlers/radar/RadarManager';
import {
  cleanupKnowledgePdfCache,
  initializeKnowledgePdfService,
} from './knowledge/knowledgeRuntime';
import { KnowledgeUploadQueueStore } from './knowledge/KnowledgeUploadQueueStore';
import { KnowledgeUploadService } from './knowledge/KnowledgeUploadService';
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
import { runStartupSequence } from './app/startupSequence';
import {
  installStartupBenchmarkExitMarker,
  recordStartupBenchmarkTimeline,
} from './app/startupBenchmark';
import { configureWindowsApplicationIdentity } from './app/windowsTaskbarIdentity';
import { configureE2EDesktopIsolation } from './app/e2eSafety';
import { installMacOsTypeOfServiceGuard } from './app/typeOfServiceGuard';
import { WorkstationAwakeManager } from './power/WorkstationAwakeManager';
import { WorkstationAwakePreferenceStore } from './power/WorkstationAwakePreferenceStore';
import { WorkstationAwakeService } from './power/WorkstationAwakeService';
import { createWindowsInputPulse } from './power/windowsInputPulse';
import { parseRecoveryProbationArgument } from './releases/RecoveryProbationArgument';
import {
  parseManualUpdateCheckpointArgument,
  parseRecoveryLaunchIntent,
} from './releases/RecoveryLaunchIntent';

installMacOsTypeOfServiceGuard();
const manualUpdateCheckpointTransaction = parseManualUpdateCheckpointArgument(
  process.argv,
  process.platform,
  app.isPackaged,
);
const recoveryProbationArgument = parseRecoveryProbationArgument();
const recoveryProbationRequested = recoveryProbationArgument.requested;
const recoveryLaunchIntent = recoveryProbationRequested
  ? null
  : parseRecoveryLaunchIntent(process.argv, process.platform, app.isPackaged);

async function startProductionManualUpdateCheckpointProcess(transactionId: string): Promise<void> {
  try {
    const { startProductionManualUpdateCheckpointProcess: startCheckpoint } =
      await import('./releases/productionManualUpdateCheckpointProcess');
    startCheckpoint(transactionId);
  } catch (error) {
    loggers.main.error('Manual update checkpoint failed', { error });
    app.exit(1);
  }
}

let startupMetadata: Parameters<typeof createStartupStateController>[0] = {};
if (recoveryProbationRequested) startupMetadata = { recoveryMode: 'probation' };
else if (recoveryLaunchIntent) startupMetadata = { launchIntent: recoveryLaunchIntent };
const startupState = createStartupStateController(startupMetadata);
const startupTimeline = createStartupTimeline();

/** Server startup either succeeded or failed with a cause worth showing. */
type ServerStartOutcome = { started: true } | { started: false; reason: string };

/**
 * A configuration that exists but cannot be decoded blocks startup: showing
 * first-run setup would overwrite it with a secret no existing client knows.
 */
type WorkspaceConfigResolution =
  { status: 'resolved'; config: RelayConfig | null } | { status: 'blocked'; reason: string };

function resolveWorkspaceConfig(appConfig: AppConfig | null): WorkspaceConfigResolution {
  const state = appConfig?.readState() ?? { status: 'absent' as const };
  if (state.status === 'unreadable') return { status: 'blocked', reason: state.reason };
  return { status: 'resolved', config: state.status === 'loaded' ? state.config : null };
}

type RequiredWorkspace =
  | { status: 'ready'; config: RelayConfig | null }
  | { status: 'blocked'; reason: string; context: string };

/**
 * Settle everything the workspace cannot publish "ready" without. A blocked
 * result names a cause the user can act on rather than a generic failure.
 */
async function prepareRequiredWorkspace(
  appConfig: AppConfig | null,
  startServerServices: (config: ServerConfig) => Promise<ServerStartOutcome>,
): Promise<RequiredWorkspace> {
  const resolution = resolveWorkspaceConfig(appConfig);
  if (resolution.status === 'blocked') {
    return { status: 'blocked', reason: resolution.reason, context: 'config-unreadable' };
  }

  const config = resolution.config;
  if (config?.mode !== 'server') return { status: 'ready', config };

  const outcome = await startServerServices(config);
  return outcome.started
    ? { status: 'ready', config }
    : { status: 'blocked', reason: outcome.reason, context: 'pocketbase-start-failed' };
}

function registerWindowActivation(): void {
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => {
        loggers.main.error('Failed to create window on app activate', { error });
        requestAppQuit('activate-window-create-failed');
      });
    }
  });
}

async function waitForStartupTestDelay(): Promise<void> {
  if (process.env.NODE_ENV !== 'test') return;
  const requestedDelay = Number(process.env.RELAY_E2E_STARTUP_DELAY_MS);
  if (!Number.isFinite(requestedDelay) || requestedDelay <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, Math.min(requestedDelay, 5_000)));
}

type RecoveryProbationRuntime = {
  controller: ReturnType<
    typeof import('./releases/RecoveryProbation').createRecoveryProbationController
  >;
  setMode: (mode: RelayConfig['mode'] | 'unconfigured') => void;
};

function isRecoveryProbationHealthy(mode: RelayConfig['mode'] | 'unconfigured'): boolean {
  const mainWindow = getMainWindow();
  if (
    startupState.getSnapshot().phase !== 'ready' ||
    !mainWindow ||
    mainWindow.isDestroyed() ||
    mainWindow.webContents.isCrashed()
  ) {
    return false;
  }
  if (mode === 'server') return getPbProcess()?.isRunning() === true;
  if (mode === 'client') return getOfflineCache() !== null && getPendingChanges() !== null;
  return true;
}

async function initializeRecoveryProbation(
  cleanupAppResources: () => void,
): Promise<RecoveryProbationRuntime | null> {
  if (!recoveryProbationRequested) return null;
  if (
    process.platform !== 'win32' ||
    !app.isPackaged ||
    recoveryProbationArgument.transactionId === null
  ) {
    throw new Error('Relay recovery probation request was invalid');
  }
  const {
    createRecoveryProbationController,
    resolveRecoveryProbationContext,
    writeRecoveryProbationReceipt,
  } = await import('./releases/RecoveryProbation');
  const relayRoot = dirname(dirname(dirname(process.execPath)));
  const context = await resolveRecoveryProbationContext({
    relayRoot,
    execPath: process.execPath,
    transactionId: recoveryProbationArgument.transactionId,
  });
  let mode: RelayConfig['mode'] | 'unconfigured' = 'unconfigured';
  const controller = createRecoveryProbationController({
    durationMs: recoveryTiming.probationDurationMs,
    startupDeadlineMs: recoveryTiming.startupDeadlineMs,
    isHealthy: () => isRecoveryProbationHealthy(mode),
    writeHealthyReceipt: (durationMs) => writeRecoveryProbationReceipt(context, durationMs),
    complete: (healthy) => {
      loggers.main.info('Recovery probation completed', { healthy });
      recordAppExitMarker(healthy ? 'recovery-probation-healthy' : 'recovery-probation-failed');
      cleanupAppResources();
      app.exit(healthy ? 0 : 1);
    },
  });
  return {
    controller,
    setMode: (nextMode) => {
      mode = nextMode;
    },
  };
}

function startRadarForRuntime(
  radarManager: RadarManager,
  probationRuntime: RecoveryProbationRuntime | null,
): void {
  if (!probationRuntime) radarManager.start();
}

function serverConfigForRuntime(
  config: ServerConfig,
  probationRuntime: RecoveryProbationRuntime | null,
): ServerConfig {
  if (!probationRuntime) return config;
  return {
    ...config,
    bindHost: '127.0.0.1',
    web: { enabled: false, port: config.web?.port ?? 8091 },
  };
}

function probationCrashHandler(
  probationRuntime: RecoveryProbationRuntime | null,
): (() => void) | undefined {
  if (!probationRuntime) return undefined;
  return () => probationRuntime.controller.fail();
}

async function applyRelayWebConfigForRuntime(
  config: ServerConfig,
  probationRuntime: RecoveryProbationRuntime | null,
): Promise<void> {
  if (!probationRuntime) await getRelayWebServerManager()?.applyConfig(config);
}

function handleClientInfrastructureFailure(
  error: unknown,
  probationRuntime: RecoveryProbationRuntime | null,
): void {
  if (probationRuntime) throw error;
  loggers.pocketbase.warn('Could not initialize offline infrastructure — local cache unavailable', {
    error,
  });
}

type PostWorkspaceRuntimeHandles = {
  cleanupMaintenance: (() => void) | null;
  stopMemoryHeartbeat: (() => void) | null;
  cancelWindowsRuntimeCleanup: (() => void) | null;
};

async function completePostWorkspaceRuntime(options: {
  relayConfig: RelayConfig | null;
  probationRuntime: RecoveryProbationRuntime | null;
  deferredServerServices: ReturnType<typeof createDeferredServerServices> | null;
  startPrivilegedAccess: (config: RelayConfig) => Promise<void>;
}): Promise<PostWorkspaceRuntimeHandles> {
  if (options.probationRuntime) {
    options.probationRuntime.setMode(options.relayConfig?.mode ?? 'unconfigured');
    options.probationRuntime.controller.markLocalStartupComplete();
    return {
      cleanupMaintenance: null,
      stopMemoryHeartbeat: null,
      cancelWindowsRuntimeCleanup: null,
    };
  }
  if (options.relayConfig?.mode === 'server') {
    options.deferredServerServices?.schedule(options.relayConfig);
  } else if (options.relayConfig?.mode === 'client') {
    void restartKnowledgeSearchRuntime();
  }
  startPeriodicCleanup();
  const cleanupMaintenance = setupMaintenanceTasks(cleanupKnowledgePdfCache);
  const stopMemoryHeartbeat = startMemoryHeartbeat();
  const { scheduleWindowsRuntimeCleanup } = await import('./app/windowsRuntimeCleanup');
  const cancelWindowsRuntimeCleanup = scheduleWindowsRuntimeCleanup({
    isPackaged: app.isPackaged,
    userDataRoot: app.getPath('userData'),
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
  if (options.relayConfig?.mode === 'client') {
    await options.startPrivilegedAccess(options.relayConfig);
  }
  return { cleanupMaintenance, stopMemoryHeartbeat, cancelWindowsRuntimeCleanup };
}

function handleBootstrapFailure(
  errorMessage: string,
  probationRuntime: RecoveryProbationRuntime | null,
  cleanupAppResources: () => void,
): void {
  if (recoveryProbationRequested) {
    if (probationRuntime) {
      probationRuntime.controller.fail();
    } else {
      recordAppExitMarker('recovery-probation-startup-failed');
      cleanupAppResources();
      app.exit(1);
    }
    return;
  }
  dialog.showErrorBox('Critical Startup Error', errorMessage);
  cleanupAppResources();
  requestAppQuit('startup-failed');
}

// Keep automated Electron runs off the interactive macOS desktop before the
// application reaches its ready state or creates a BrowserWindow.
configureE2EDesktopIsolation(app);

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

const gotLock =
  !isCrashWatchdog && manualUpdateCheckpointTransaction === null && app.requestSingleInstanceLock();
if (manualUpdateCheckpointTransaction !== null) {
  void startProductionManualUpdateCheckpointProcess(manualUpdateCheckpointTransaction); // NOSONAR - top-level await blocks Electron ESM entry evaluation before app readiness.
} else if (gotLock) {
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
    const workspaceDeferred = createDeferred<ReturnType<AppConfig['load']>>();
    // runStartupSequence observes this promise once it starts. Attach a no-op handler up
    // front as well so a failure raised before that point cannot become an unhandled
    // rejection — the settlers used to be null until the startup sequence was wired up.
    void workspaceDeferred.promise.catch(() => undefined);
    let workspaceSettled = false;
    let startupSequence: Promise<ReturnType<AppConfig['load']>> | null = null;
    let deferredServerServices: ReturnType<typeof createDeferredServerServices> | null = null;
    let cancelGpuDiagnostics: (() => void) | null = null;
    let cancelWindowsRuntimeCleanup: (() => void) | null = null;
    let recoveryProbationRuntime: RecoveryProbationRuntime | null = null;
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
      recoveryProbationRuntime?.controller.dispose();
      recoveryProbationRuntime = null;
      getWorkstationAwakeService()?.shutdown();
      setWorkstationAwakeService(null);
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

      recoveryProbationRuntime = await initializeRecoveryProbation(cleanupAppResources);

      let windowsInputPulse: (() => boolean) | null = null;
      const workstationAwakeManager = new WorkstationAwakeManager({
        platform: process.platform,
        powerSaveBlocker,
        pulseInput: () => {
          if (process.platform !== 'win32') return false;
          try {
            windowsInputPulse ??= createWindowsInputPulse();
            return windowsInputPulse();
          } catch (error) {
            loggers.main.warn('Windows rejected the workstation keep-awake input pulse', {
              error,
            });
            return false;
          }
        },
      });
      const workstationAwakeService = new WorkstationAwakeService(
        workstationAwakeManager,
        new WorkstationAwakePreferenceStore(app.getPath('userData')),
      );
      setWorkstationAwakeService(workstationAwakeService);
      const workstationAwakeState = workstationAwakeService.initialize();
      loggers.main.info('Workstation keep-awake initialized', {
        supported: workstationAwakeState.supported,
        enabled: workstationAwakeState.enabled,
        status: workstationAwakeState.status,
      });

      setupPermissions(session.defaultSession);
      cleanupStartupIpc = setupStartupIpc(startupState, startupTimeline, {
        onRendererMounted: (timeline) => {
          recoveryProbationRuntime?.controller.markRendererMounted();
          if (shouldExitAfterStartupBenchmark(process.env)) {
            recordStartupBenchmarkTimeline({
              environment: process.env,
              tempPath: app.getPath('temp'),
              timeline,
            });
            requestAppQuit('startup-benchmark-complete');
            return;
          }
          if (process.env.RELAY_DISABLE_GPU_DIAGNOSTICS === '1') return;
          cancelGpuDiagnostics?.();
          cancelGpuDiagnostics = scheduleGpuDiagnostics(app, loggers.main);
        },
      });

      startupSequence = runStartupSequence({
        controller: startupState,
        createWindow: () =>
          createWindow({
            onWindowCreated: () => startupTimeline.mark('window-created'),
            onShellReady: () => startupTimeline.mark('shell-ready'),
            autoRecover: !recoveryProbationRequested,
          }),
        prepareWorkspace: () => workspaceDeferred.promise,
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
                getRadarManager,
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
      stopKnowledgeUploadSession = subscribePrivilegedSessionChanged(
        notifyKnowledgeUploadSessionChanged,
      );
      await knowledgeUploadService.start();
      const dynatraceStore = new DynatraceDashboardStore(configDataDir);
      setDynatraceWindowManager(new DynatraceWindowManager({ store: dynatraceStore }));
      setDynatraceProblemsManager(
        new DynatraceProblemsManager(new DynatraceProblemsConfigStore(configDataDir), getPbClient),
      );
      setCloudStatusManager(new CloudStatusManager(getPbClient));

      // Radar authenticates with each user's own SSO cookie rather than a
      // shared server credential, so it starts per instance instead of joining
      // the server-only data managers below.
      const radarManager = new RadarManager();
      setRadarManager(radarManager);
      startRadarForRuntime(radarManager, recoveryProbationRuntime);

      const startServerDataManagers = () => {
        getDynatraceProblemsManager()?.start();
        getCloudStatusManager()?.start();
      };
      deferredServerServices = createDeferredServerServices({
        startDataManagers: startServerDataManagers,
        startPocketBaseServices: startDeferredPocketBaseServices,
      });

      const stopPrivilegedAccess = stopPrivilegedRuntime;

      const startPrivilegedAccess = async (config: NonNullable<ReturnType<AppConfig['load']>>) => {
        try {
          await replacePrivilegedRuntime(async () => {
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
            return { host, runtime };
          });
        } catch (error) {
          loggers.security.warn('Could not initialize privileged access', { error });
        }
      };

      const startServerServices = async (config: ServerConfig): Promise<ServerStartOutcome> => {
        const effectiveConfig = serverConfigForRuntime(config, recoveryProbationRuntime);
        const result = await startPocketBase(effectiveConfig, configDataDir, {
          onHealthy: () => startupTimeline.mark('pocketbase-healthy'),
          onCredentialsReady: () => startupTimeline.mark('credentials-ready'),
          onSchemaReady: () => startupTimeline.mark('schema-ready'),
          restartOnCrash: !recoveryProbationRuntime,
          onCrash: probationCrashHandler(recoveryProbationRuntime),
        });
        if (result.status !== 'started') return { started: false, reason: result.reason };
        if (result.privilegedRuntimeReady) {
          await startPrivilegedAccess(effectiveConfig);
        } else {
          loggers.security.warn(
            'Privileged runtime deferred until role account migration completes',
            {
              reason: result.reason,
            },
          );
        }
        await applyRelayWebConfigForRuntime(config, recoveryProbationRuntime);
        return { started: true };
      };

      const startServerServicesAfterReady = async (config: ServerConfig): Promise<boolean> => {
        const outcome = await startServerServices(config);
        if (outcome.started) deferredServerServices?.schedule(config);
        return outcome.started;
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
      await setupIpc(restartPb);

      // Register shutdown cleanup before starting embedded services so an early
      // startup failure cannot leave PocketBase or SQLite handles behind.
      app.on('before-quit', () => {
        // The crash watchdog only treats an exit as intentional when a marker is
        // newer than its own start, and requestAppQuit/requestAppRelaunch cannot
        // cover a shutdown that Electron initiates on its own. On Windows this
        // also covers system shutdown/restart and user logoff, so no separate
        // session-end listener is needed — and 'session-end' is a BrowserWindow
        // event, not an app one, so registering it here would never fire.
        recordAppExitMarker('before-quit');
        cleanupAppResources();
      });

      // Registered before the required-startup gate so a workspace that failed to
      // start can still be brought back to the foreground on macOS.
      registerWindowActivation();

      /**
       * Publish a startup failure the user can act on and stop bootstrapping,
       * leaving the window and the restart/reconfigure IPC handlers alive.
       * Quitting here replaced the actual cause with one fixed sentence in a
       * modal and put Relay's own recovery UI out of reach.
       */
      const failStartupRecoverably = (reason: string, context: string): void => {
        loggers.main.error('Relay could not complete startup', { context, reason });
        startupState.transition(startupState.getSnapshot().generation, 'failed', reason);
        workspaceSettled = true;
        workspaceDeferred.reject(new Error(reason));
        void startupSequence?.catch(() => undefined);
        recoveryProbationRuntime?.controller.fail();
      };

      // Required server startup must settle before the workspace can publish
      // ready, even though the window and static shell are already visible.
      const workspace = await prepareRequiredWorkspace(getAppConfig(), startServerServices);
      if (workspace.status === 'blocked') {
        failStartupRecoverably(workspace.reason, workspace.context);
        return;
      }
      const relayConfig = workspace.config;

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
          handleClientInfrastructureFailure(syncErr, recoveryProbationRuntime);
        }
      }

      await waitForStartupTestDelay();
      startupTimeline.mark('workspace-ready');
      workspaceSettled = true;
      workspaceDeferred.resolve(relayConfig);
      await startupSequence;
      const postWorkspace = await completePostWorkspaceRuntime({
        relayConfig,
        probationRuntime: recoveryProbationRuntime,
        deferredServerServices,
        startPrivilegedAccess,
      });
      cleanupMaintenance = postWorkspace.cleanupMaintenance;
      stopMemoryHeartbeat = postWorkspace.stopMemoryHeartbeat;
      cancelWindowsRuntimeCleanup = postWorkspace.cancelWindowsRuntimeCleanup;
    } catch (error: unknown) {
      if (!workspaceSettled) {
        workspaceSettled = true;
        workspaceDeferred.reject(error);
      }
      await startupSequence?.catch(() => undefined);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      loggers.main.error('Failed to start application', { error: errorMessage });
      handleBootstrapFailure(errorMessage, recoveryProbationRuntime, cleanupAppResources);
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
  setupErrorHandlers({
    allowAutoRelaunch: !recoveryProbationRequested,
    suppressDesktopSideEffects: recoveryProbationRequested,
  });
  setupAppLifecycleListeners({ allowRecovery: !recoveryProbationRequested });
} else if (!isCrashWatchdog) {
  requestAppQuit('single-instance-lock-unavailable');
}
