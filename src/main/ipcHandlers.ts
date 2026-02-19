import { BrowserWindow } from 'electron';
import { FileManager } from './FileManager';
import { setupWeatherHandlers } from './handlers/weatherHandlers';
import { setupWindowHandlers } from './handlers/windowHandlers';
import { setupConfigHandlers } from './handlers/configHandlers';
import { setupDataHandlers } from './handlers/dataHandlers';
import { setupFileHandlers } from './handlers/fileHandlers';
import { setupLocationHandlers } from './handlers/locationHandlers';
import { setupFeatureHandlers } from './handlers/featureHandlers';
import { setupDataRecordHandlers } from './handlers/dataRecordHandlers';
import { loggers } from './logger';
import { getErrorMessage } from '@shared/types';

/**
 * Orchestrates all IPC handlers for the application.
 * Each handler group is wrapped in try/catch to prevent a single failure
 * from leaving all subsequent handlers unregistered.
 *
 * `getDataRoot` is async — it resolves from config on the first call,
 * then returns the cached value on subsequent calls with no I/O.
 */
export function setupIpcHandlers(
  getMainWindow: () => BrowserWindow | null,
  getFileManager: () => FileManager | null,
  getDataRoot: () => Promise<string>,
  onDataPathChange: (newPath: string) => Promise<void>,
  getDefaultDataPath: () => string,
  createAuxWindow?: (route: string) => void,
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

  // Data Mutations (Contacts, Groups, Servers, On-Call)
  safeSetup('data', () => setupDataHandlers(getMainWindow, getFileManager));

  // File System Operations
  safeSetup('file', () => setupFileHandlers(guardedGetDataRoot));

  // Location & Weather
  safeSetup('location', () => setupLocationHandlers(getMainWindow));
  safeSetup('weather', () => setupWeatherHandlers());

  // Window Management
  safeSetup('window', () => setupWindowHandlers(getMainWindow, createAuxWindow));

  // Feature Handlers (Presets, History, Notes, Saved Locations)
  safeSetup('feature', () => setupFeatureHandlers(guardedGetDataRoot));

  // Data Record Handlers (JSON-based contacts, servers, on-call, data manager)
  safeSetup('dataRecord', () => setupDataRecordHandlers(guardedGetDataRoot));
}
