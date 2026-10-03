import { app, ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import type { RelayConfig, ServerConfig } from '../config/AppConfig';
import { stopKnowledgeSearchRuntime } from '../knowledge/knowledgeSearchRuntime';
import { loggers } from '../logger';
import { recoverInterruptedRestore } from '../pocketbase/BackupRestore';
import {
  createProductionPrivilegedHost,
  createProductionPrivilegedRuntime,
} from '../privileged/privilegedRuntime';
import { assertTrustedIpcSender } from '../utils/trustedSender';
import {
  getAppConfig,
  getCloudStatusManager,
  getDynatraceProblemsManager,
  getPbClient,
  getPbProcess,
  getRelayWebServerManager,
  getRetentionManager,
} from './appState';
import type { DeferredServerServices } from './deferredServerServices';
import { cancelDeferredPocketBaseServices, startPocketBase } from './pocketbaseBootstrap';
import { replacePrivilegedRuntime, stopPrivilegedRuntime } from './privilegedRuntimeLifecycle';
import { reconfigureRuntime } from './runtimeReconfigure';
import type { StartupStateController } from './startupState';
import type { StartupTimeline } from './startupTimeline';

/** Server startup either succeeded or failed with a cause worth showing. */
export type ServerStartOutcome = { started: true } | { started: false; reason: string };

/** The part of a recovery probation run that server startup reacts to. */
type ServerProbation = { controller: { fail(): void } };

type ServerRuntimeDependencies = {
  configDataDir: string;
  startupTimeline: StartupTimeline;
  deferredServerServices: DeferredServerServices;
  /** Read on every call: probation is torn down during app cleanup. */
  getProbation: () => ServerProbation | null;
};

export type ServerRuntimeServices = {
  startPrivilegedAccess(config: RelayConfig): Promise<void>;
  startServerServices(config: ServerConfig, forRestore?: boolean): Promise<ServerStartOutcome>;
  startServerServicesAfterReady(config: ServerConfig, forRestore?: boolean): Promise<boolean>;
  restartPb(replaceData: () => void): Promise<boolean>;
};

function serverConfigForRuntime(
  config: ServerConfig,
  probation: ServerProbation | null,
): ServerConfig {
  if (!probation) return config;
  return {
    ...config,
    bindHost: '127.0.0.1',
    web: { enabled: false, port: config.web?.port ?? 8091 },
  };
}

function probationCrashHandler(probation: ServerProbation | null): (() => void) | undefined {
  if (!probation) return undefined;
  return () => probation.controller.fail();
}

async function applyRelayWebConfigForRuntime(
  config: ServerConfig,
  probation: ServerProbation | null,
): Promise<void> {
  if (!probation) await getRelayWebServerManager()?.applyConfig(config);
}

async function startPrivilegedAccess(config: RelayConfig, configDataDir: string): Promise<void> {
  try {
  } catch (error) {
    loggers.security.warn('Could not initialize privileged access', { error });
  }
}

async function startServerServices(
  dependencies: ServerRuntimeDependencies,
  config: ServerConfig,
  forRestore: boolean,
): Promise<ServerStartOutcome> {
  const { configDataDir, startupTimeline } = dependencies;
  const effectiveConfig = serverConfigForRuntime(config, dependencies.getProbation());
  const result = { status: 'started', privilegedRuntimeReady: false, reason: '' } as const;
  if (result.status !== 'started') return { started: false, reason: result.reason };
  if (result.privilegedRuntimeReady) {
    await startPrivilegedAccess(effectiveConfig, configDataDir);
  } else {
    loggers.security.warn('Privileged runtime deferred until role account migration completes', {
      reason: result.reason,
    });
  }
  await applyRelayWebConfigForRuntime(config, dependencies.getProbation());
  return { started: true };
}

async function startServerServicesAfterReady(
  dependencies: ServerRuntimeDependencies,
  config: ServerConfig,
  forRestore: boolean,
): Promise<boolean> {
  const outcome = await startServerServices(dependencies, config, forRestore);
  if (outcome.started) dependencies.deferredServerServices.schedule(config);
  return outcome.started;
}

async function restartPb(
  dependencies: ServerRuntimeDependencies,
  replaceData: () => void,
): Promise<boolean> {
  const config = getAppConfig()?.load();
  if (config?.mode !== 'server') return false;
  await getRelayWebServerManager()?.stop();
  await stopPrivilegedRuntime();
  dependencies.deferredServerServices.cancel();
  cancelDeferredPocketBaseServices();
  await stopKnowledgeSearchRuntime();
  await Promise.all([
    getRetentionManager()?.stopForRestore(),
    getDynatraceProblemsManager()?.stopForRestore(),
    getCloudStatusManager()?.stopForRestore(),
  ]);
  await getPbProcess()?.stopForRestore();
  try {
    replaceData();
  } catch (error) {
    // A failed replacement rolls its files back before services resume.
    recoverInterruptedRestore(dependencies.configDataDir);
    await startServerServicesAfterReady(dependencies, config, true);
    throw error;
  }
  return startServerServicesAfterReady(dependencies, config, true);
}

/**
 * Server-mode lifecycle shared by required startup, first-run setup and
 * backup restore. Kept outside the entry point so each operation depends only
 * on the state it names.
 */
export function createServerRuntimeServices(
  dependencies: ServerRuntimeDependencies,
): ServerRuntimeServices {
  return {
    startPrivilegedAccess: (config) => startPrivilegedAccess(config, dependencies.configDataDir),
    startServerServices: (config, forRestore = false) =>
      startServerServices(dependencies, config, forRestore),
    startServerServicesAfterReady: (config, forRestore = false) =>
      startServerServicesAfterReady(dependencies, config, forRestore),
    restartPb: (replaceData) => restartPb(dependencies, replaceData),
  };
}

/** Register the IPC handlers that start or rebuild the runtime after setup. */
export function registerServerRuntimeIpc(
  services: ServerRuntimeServices,
  options: { configDataDir: string; startupState: StartupStateController },
): void {
  // Start PocketBase on demand (called after first-time setup)
  ipcMain.handle(IPC_CHANNELS.PB_START, async (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.PB_START)) return false;
    const config = getAppConfig()?.load();
    if (config?.mode !== 'server') return false;
    await getRelayWebServerManager()?.stop();
    await stopPrivilegedRuntime();
    return services.startServerServicesAfterReady(config);
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
    return reconfigureRuntime(options.configDataDir, { startupState: options.startupState });
  });
}
