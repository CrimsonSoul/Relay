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
import { stopAdvertising } from '../discovery/RelayDiscovery';

function tryClose(db: { close(): void } | null, label: string): void {
  if (!db) return;
  try {
    db.close();
  } catch (error) {
    loggers.main.warn(`Failed to close ${label} during reconfigure`, { error });
  }
}

export async function reconfigureRuntime(configDataDir: string): Promise<void> {
  const config = getAppConfig()?.load();

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
