import { loggers } from '../logger';
import {
  createProductionPrivilegedHost,
  createProductionPrivilegedRuntime,
} from '../privileged/privilegedRuntime';
import {
  getAppConfig,
  getMainWindow,
  getOfflineCache,
  getPbProcess,
  getPendingChanges,
  getRetentionManager,
  getDynatraceProblemsManager,
  getCloudStatusManager,
  getPbClient,
  getRelayWebServerManager,
  setBackupManager,
  setOfflineCache,
  setPbClient,
  setPbProcess,
  setPendingChanges,
  setRetentionManager,
  setSyncManager,
} from './appState';
import {
  cancelDeferredPocketBaseServices,
  startDeferredPocketBaseServices,
  startPocketBase,
} from './pocketbaseBootstrap';
import { stopAdvertising } from '../discovery/RelayDiscovery';
import { initializeKnowledgePdfService } from '../knowledge/knowledgeRuntime';
import { restartKnowledgeSearchRuntime } from '../knowledge/knowledgeSearchRuntime';
import { clearRelayAppUserAuthCoordinator } from '../pocketbase/RelayAppUserAuthCoordinator';
import type { StartupStateController } from './startupState';
import { replacePrivilegedRuntime, stopPrivilegedRuntime } from './privilegedRuntimeLifecycle';

function tryClose(db: { close(): void } | null, label: string): void {
  if (!db) return;
  try {
    db.close();
  } catch (error) {
    loggers.main.warn(`Failed to close ${label} during reconfigure`, { error });
  }
}

async function rebuildPrivilegedRuntime(
  config: NonNullable<ReturnType<NonNullable<ReturnType<typeof getAppConfig>>['load']>>,
  configDataDir: string,
): Promise<void> {
  try {
    await replacePrivilegedRuntime(async () => {
      // Same on-demand load as the startup path in src/main/index.ts.
      const productionOptions = {
        config,
        dataDir: configDataDir,
        serverClient: config.mode === 'server' ? getPbClient() : null,
        dynatraceProblemsManager: getDynatraceProblemsManager(),
      };
      const host =
        config.mode === 'server' ? await createProductionPrivilegedHost(productionOptions) : null;
      const runtime = host
        ? host.createElectronRuntime()
        : await createProductionPrivilegedRuntime(productionOptions);
      return { host, runtime };
    });
  } catch (error) {
    loggers.security.warn('Could not initialize privileged access after reconfigure', { error });
  }
}

async function reconfigureRuntimeInternal(configDataDir: string): Promise<void> {
  clearRelayAppUserAuthCoordinator();
  cancelDeferredPocketBaseServices();
  const config = getAppConfig()?.load();
  await getRelayWebServerManager()?.stop();
  await stopPrivilegedRuntime();
  const dynatraceProblemsManager = getDynatraceProblemsManager();
  dynatraceProblemsManager?.stop();
  const cloudStatusManager = getCloudStatusManager();
  cloudStatusManager?.stop();
  initializeKnowledgePdfService(configDataDir);

  // Stop mDNS advertising; startPocketBase re-starts it for LAN-bound server mode.
  stopAdvertising();

  const retentionManager = getRetentionManager();
  if (retentionManager) {
    retentionManager.stop();
    setRetentionManager(null);
  }
  setBackupManager(null);
  setPbClient(null);

  tryClose(getOfflineCache(), 'offline cache');
  setOfflineCache(null);

  tryClose(getPendingChanges(), 'pending changes');
  setPendingChanges(null);
  setSyncManager(null);

  const pbProcess = getPbProcess();
  let privilegedRuntimeReady = config?.mode !== 'server';
  if (config?.mode === 'server') {
    const result = await startPocketBase(config, configDataDir);
    // The reason is a fixed, user-safe sentence describing the actual cause.
    if (result.status !== 'started') throw new Error(result.reason);
    privilegedRuntimeReady = result.privilegedRuntimeReady;
    if (!result.privilegedRuntimeReady) {
      loggers.security.warn('Privileged runtime deferred until role account migration completes', {
        reason: result.reason,
      });
    }
    dynatraceProblemsManager?.start();
    cloudStatusManager?.start();
  } else if (pbProcess) {
    await pbProcess.stop();
    setPbProcess(null);
  }

  if (config?.mode === 'client') {
    try {
      const { initializeClientOfflineInfrastructure } =
        await import('./clientOfflineInfrastructure');
      await initializeClientOfflineInfrastructure(configDataDir, config);
      loggers.pocketbase.info('Client-mode offline infrastructure initialized after reconfigure');
    } catch (error) {
      loggers.pocketbase.warn(
        'Could not initialize client-mode offline infrastructure after reconfigure',
        { error },
      );
    }
  }

  if (config && privilegedRuntimeReady) {
    await rebuildPrivilegedRuntime(config, configDataDir);
  }
  if (config?.mode === 'server') {
    await getRelayWebServerManager()?.applyConfig(config);
  }

  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.reloadIgnoringCache();
  }
}

type RuntimeReconfigureOptions = Readonly<{
  startupState?: StartupStateController;
}>;

export async function reconfigureRuntime(
  configDataDir: string,
  options: RuntimeReconfigureOptions = {},
): Promise<void> {
  const generation = options.startupState?.beginGeneration();
  if (generation !== undefined) {
    options.startupState?.transition(generation, 'preparing-data');
  }

  try {
    await reconfigureRuntimeInternal(configDataDir);
    if (generation !== undefined) options.startupState?.transition(generation, 'ready');
    const config = getAppConfig()?.load();
    if (config?.mode === 'server') {
      startDeferredPocketBaseServices(config);
    } else if (config?.mode === 'client') {
      void restartKnowledgeSearchRuntime();
    }
  } catch (error) {
    if (generation !== undefined) {
      options.startupState?.transition(
        generation,
        'failed',
        'Relay could not apply the new configuration.',
      );
    }
    throw error;
  }
}
