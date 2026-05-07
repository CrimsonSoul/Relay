import { BrowserWindow } from 'electron';
import { setupCloudStatusHandlers } from './handlers/cloudStatus';
import { setupWindowHandlers } from './handlers/windowHandlers';
import { setupSetupHandlers } from './handlers/setupHandlers';
import { setupCacheHandlers } from './handlers/cacheHandlers';
import { setupBackupHandlers } from './handlers/backupHandlers';
import type { AppConfig } from './config/AppConfig';
import type { OfflineCache } from './cache/OfflineCache';
import type { PendingChanges } from './cache/PendingChanges';
import type { SyncManager } from './cache/SyncManager';
import type { BackupManager } from './pocketbase/BackupManager';
import { loggers } from './logger';
import { getErrorMessage } from '@shared/types';

/**
 * Orchestrates all IPC handlers for the application.
 * Each handler group is wrapped in try/catch to prevent a single failure
 * from leaving all subsequent handlers unregistered.
 */
export function setupIpcHandlers(opts: {
  getMainWindow: () => BrowserWindow | null;
  getDataRoot: () => Promise<string>;
  createAuxWindow?: (route: string) => void;
  getAppConfig?: () => AppConfig | null;
  getCache?: () => OfflineCache | null;
  getPendingChanges?: () => PendingChanges | null;
  getSyncManager?: () => SyncManager | null;
  getBackupManager?: () => BackupManager | null;
  restartPb?: () => Promise<boolean>;
}) {
  const {
    getMainWindow,
    getDataRoot,
    createAuxWindow,
    getAppConfig,
    getCache,
    getPendingChanges,
    getSyncManager,
    getBackupManager,
    restartPb,
  } = opts;
  const safeSetup = (name: string, fn: () => void) => {
    try {
      fn();
    } catch (err) {
      loggers.main.error(`Failed to setup ${name} handlers`, {
        error: getErrorMessage(err),
      });
    }
  };

  safeSetup('cloudStatus', () => setupCloudStatusHandlers());

  // Window Management
  safeSetup('window', () => setupWindowHandlers(getMainWindow, createAuxWindow, getDataRoot));

  // PocketBase Setup Handlers (always registered — uses getter for lazy access)
  safeSetup('setup', () =>
    setupSetupHandlers(
      getAppConfig ?? (() => null),
      getCache ?? (() => null),
      getPendingChanges ?? (() => null),
    ),
  );

  // Offline Cache Handlers (always registered — getters return null when not in client mode)
  safeSetup('cache', () =>
    setupCacheHandlers(
      getCache ?? (() => null),
      getPendingChanges ?? (() => null),
      getSyncManager ?? (() => null),
      getAppConfig ?? (() => null),
    ),
  );

  // Backup Management
  safeSetup('backup', () =>
    setupBackupHandlers(
      getBackupManager ?? (() => null),
      restartPb ?? (() => Promise.resolve(false)),
      getCache ?? (() => null),
    ),
  );
}
