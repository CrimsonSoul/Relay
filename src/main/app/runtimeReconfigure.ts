import { loggers } from '../logger';
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
  getPrivilegedRuntime,
  getPrivilegedHost,
  getRelayWebServerManager,
  setBackupManager,
  setOfflineCache,
  setPbClient,
  setPbProcess,
  setPendingChanges,
  setRetentionManager,
  setSyncManager,
  setPrivilegedRuntime,
  setPrivilegedHost,
} from './appState';
import { initializeClientOfflineInfrastructure } from './clientOfflineInfrastructure';
import { startPocketBase } from './pocketbaseBootstrap';
import { stopAdvertising } from '../discovery/RelayDiscovery';
import { initializeKnowledgePdfService } from '../knowledge/knowledgeRuntime';
import {
  createProductionPrivilegedHost,
  createProductionPrivilegedRuntime,
} from '../privileged/privilegedRuntime';
import { restartKnowledgeSearchRuntime } from '../knowledge/knowledgeSearchRuntime';

function tryClose(db: { close(): void } | null, label: string): void {
  if (!db) return;
  try {
    db.close();
  } catch (error) {
    loggers.main.warn(`Failed to close ${label} during reconfigure`, { error });
  }
}

async function disposePrivilegedRuntime(): Promise<void> {
  const runtime = getPrivilegedRuntime();
  const host = getPrivilegedHost();
  setPrivilegedRuntime(null);
  setPrivilegedHost(null);
  await (host?.dispose() ?? runtime?.dispose());
}

async function rebuildPrivilegedRuntime(
  config: NonNullable<ReturnType<NonNullable<ReturnType<typeof getAppConfig>>['load']>>,
  configDataDir: string,
): Promise<void> {
  try {
    const productionOptions = {
      config,
      dataDir: configDataDir,
      serverClient: config.mode === 'server' ? getPbClient() : null,
      dynatraceProblemsManager: getDynatraceProblemsManager(),
    };
    const host =
      config.mode === 'server' ? await createProductionPrivilegedHost(productionOptions) : null;
    const privilegedRuntime = host
      ? host.createElectronRuntime()
      : await createProductionPrivilegedRuntime(productionOptions);
    setPrivilegedHost(host);
    setPrivilegedRuntime(privilegedRuntime);
  } catch (error) {
    loggers.security.warn('Could not initialize privileged access after reconfigure', { error });
  }
}

export async function reconfigureRuntime(configDataDir: string): Promise<void> {
  const config = getAppConfig()?.load();
  await getRelayWebServerManager()?.stop();
  await disposePrivilegedRuntime();
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
    if (result.status !== 'started') throw new Error('Failed to start PocketBase server.');
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

  // Enhanced search owns only disposable derived state and must never delay
  // runtime reconfiguration or the renderer reload.
  void restartKnowledgeSearchRuntime();

  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.reloadIgnoringCache();
  }
}
