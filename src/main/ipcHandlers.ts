import { BrowserWindow } from 'electron';
import { setupWeatherHandlers } from './handlers/weatherHandlers';
import { setupCloudStatusHandlers } from './handlers/cloudStatus';
import { setupWindowHandlers } from './handlers/windowHandlers';
import { setupConfigHandlers } from './handlers/configHandlers';
import { setupLocationHandlers } from './handlers/locationHandlers';
import { setupSetupHandlers } from './handlers/setupHandlers';
import { setupCacheHandlers } from './handlers/cacheHandlers';
import type { AppConfig } from './config/AppConfig';
import type { OfflineCache } from './cache/OfflineCache';
import type { PendingChanges } from './cache/PendingChanges';
import type { SyncManager } from './cache/SyncManager';
import { loggers } from './logger';
import { getErrorMessage } from '@shared/types';

/**
 * Orchestrates all IPC handlers for the application.
 * Each handler group is wrapped in try/catch to prevent a single failure
 * from leaving all subsequent handlers unregistered.
 */
export function setupIpcHandlers(
  getMainWindow: () => BrowserWindow | null,
  getDataRoot: () => Promise<string>,
  createAuxWindow?: (route: string) => void,
  getAppConfig?: () => AppConfig | null,
  getCache?: () => OfflineCache | null,
  getPendingChanges?: () => PendingChanges | null,
  getSyncManager?: () => SyncManager | null,
) {
  const safeSetup = (name: string, fn: () => void) => {
    try {
      fn();
    } catch (err) {
      loggers.main.error(`Failed to setup ${name} handlers`, {
        error: getErrorMessage(err),
      });
    }
  };

  // Config & App State
  safeSetup('config', () => setupConfigHandlers());

  // Location & Weather
  safeSetup('location', () => setupLocationHandlers(getMainWindow));
  safeSetup('weather', () => setupWeatherHandlers());
  safeSetup('cloudStatus', () => setupCloudStatusHandlers());

  // Window Management
  safeSetup('window', () => setupWindowHandlers(getMainWindow, createAuxWindow, getDataRoot));

  // PocketBase Setup Handlers (always registered — uses getter for lazy access)
  safeSetup('setup', () => setupSetupHandlers(getAppConfig ?? (() => null)));

  // Offline Cache Handlers (always registered — getters return null when not in client mode)
  safeSetup('cache', () =>
    setupCacheHandlers(
      getCache ?? (() => null),
      getPendingChanges ?? (() => null),
      getSyncManager ?? (() => null),
      getAppConfig ?? (() => null),
    ),
  );
}
