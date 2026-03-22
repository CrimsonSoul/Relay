import { BrowserWindow } from 'electron';
import { setupWeatherHandlers } from './handlers/weatherHandlers';
import { setupCloudStatusHandlers } from './handlers/cloudStatusHandlers';
import { setupWindowHandlers } from './handlers/windowHandlers';
import { setupConfigHandlers } from './handlers/configHandlers';
import { setupLocationHandlers } from './handlers/locationHandlers';
import { setupSetupHandlers } from './handlers/setupHandlers';
import { setupCacheHandlers } from './handlers/cacheHandlers';
import type { AppConfig } from './config/AppConfig';
import type { OfflineCache } from './cache/OfflineCache';
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
  onDataPathChange: (newPath: string) => Promise<void>,
  getDefaultDataPath: () => string,
  createAuxWindow?: (route: string) => void,
  appConfig?: AppConfig | null,
  getCache?: () => OfflineCache | null,
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

  // Guard wrapper: logs a warning if data root hasn't resolved yet
  const guardedGetDataRoot = async (): Promise<string> => {
    const root = await getDataRoot();
    if (!root) {
      loggers.main.warn('getDataRoot() returned empty string — data root not yet initialized');
    }
    return root;
  };

  // Config & App State
  safeSetup('config', () =>
    setupConfigHandlers(getMainWindow, guardedGetDataRoot, onDataPathChange, getDefaultDataPath),
  );

  // Location & Weather
  safeSetup('location', () => setupLocationHandlers(getMainWindow));
  safeSetup('weather', () => setupWeatherHandlers());
  safeSetup('cloudStatus', () => setupCloudStatusHandlers());

  // Window Management
  safeSetup('window', () =>
    setupWindowHandlers(getMainWindow, createAuxWindow, guardedGetDataRoot),
  );

  // PocketBase Setup Handlers
  if (appConfig) {
    safeSetup('setup', () => setupSetupHandlers(appConfig));
  }

  // Offline Cache Handlers
  if (getCache) {
    safeSetup('cache', () => setupCacheHandlers(getCache));
  }
}
