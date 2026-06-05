import { loggers } from '../logger';
import {
  getAppConfig,
  getMainWindow,
  getOfflineCache,
  getPbProcess,
  getPendingChanges,
  getRetentionManager,
  setBackupManager,
  setOfflineCache,
  setPbClient,
  setPbProcess,
  setPendingChanges,
  setRetentionManager,
  setSyncManager,
} from './appState';
import { initializeClientOfflineInfrastructure } from './clientOfflineInfrastructure';
import { startPocketBase } from './pocketbaseBootstrap';

export async function reconfigureRuntime(configDataDir: string): Promise<void> {
  const config = getAppConfig()?.load();

  const retentionManager = getRetentionManager();
  if (retentionManager) {
    retentionManager.stop();
    setRetentionManager(null);
  }
  setBackupManager(null);
  setPbClient(null);

  const offlineCache = getOfflineCache();
  if (offlineCache) {
    offlineCache.close();
    setOfflineCache(null);
  }

  const pendingChanges = getPendingChanges();
  if (pendingChanges) {
    pendingChanges.close();
    setPendingChanges(null);
  }
  setSyncManager(null);

  const pbProcess = getPbProcess();
  if (config?.mode === 'server') {
    const started = await startPocketBase(config, configDataDir);
    if (!started) throw new Error('Failed to start PocketBase server.');
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

  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.reloadIgnoringCache();
  }
}
