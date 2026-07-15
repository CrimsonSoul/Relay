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
  setBackupManager,
  setOfflineCache,
  setPbClient,
  setPbProcess,
  setPendingChanges,
  setRetentionManager,
  setSyncManager,
  setPrivilegedRuntime,
} from './appState';
import { initializeClientOfflineInfrastructure } from './clientOfflineInfrastructure';
import { startPocketBase } from './pocketbaseBootstrap';
import { stopAdvertising } from '../discovery/RelayDiscovery';
import {
  initializeKnowledgePdfService,
  startKnowledgeBaseManager,
  stopKnowledgeBaseManager,
} from '../knowledge/knowledgeRuntime';
import { createProductionPrivilegedRuntime } from '../privileged/privilegedRuntime';

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
  setPrivilegedRuntime(null);
  await runtime?.dispose();
}

async function rebuildPrivilegedRuntime(
  config: NonNullable<ReturnType<NonNullable<ReturnType<typeof getAppConfig>>['load']>>,
  configDataDir: string,
): Promise<void> {
  try {
    const privilegedRuntime = await createProductionPrivilegedRuntime({
      config,
      dataDir: configDataDir,
      serverClient: config.mode === 'server' ? getPbClient() : null,
    });
    setPrivilegedRuntime(privilegedRuntime);
  } catch (error) {
    loggers.security.warn('Could not initialize privileged access after reconfigure', { error });
  }
}

export async function reconfigureRuntime(configDataDir: string): Promise<void> {
  const config = getAppConfig()?.load();
  await disposePrivilegedRuntime();
  const dynatraceProblemsManager = getDynatraceProblemsManager();
  dynatraceProblemsManager?.stop();
  const cloudStatusManager = getCloudStatusManager();
  cloudStatusManager?.stop();
  await stopKnowledgeBaseManager();
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
  if (config?.mode === 'server') {
    const started = await startPocketBase(config, configDataDir);
    if (!started) throw new Error('Failed to start PocketBase server.');
    dynatraceProblemsManager?.start();
    cloudStatusManager?.start();
    try {
      await startKnowledgeBaseManager(configDataDir);
    } catch (error) {
      loggers.main.warn('Could not start Knowledge Base index after reconfigure', { error });
    }
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

  if (config) {
    await rebuildPrivilegedRuntime(config, configDataDir);
  }

  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.reloadIgnoringCache();
  }
}
