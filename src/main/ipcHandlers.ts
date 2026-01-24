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

/**
 * Orchestrates all IPC handlers for the application.
 */
export function setupIpcHandlers(
  getMainWindow: () => BrowserWindow | null,
  getFileManager: () => FileManager | null,
  getDataRoot: () => string,
  onDataPathChange: (newPath: string) => Promise<void>,
  getDefaultDataPath: () => string,
  createAuxWindow?: (route: string) => void
) {
  // Config & App State
  setupConfigHandlers(getMainWindow, getDataRoot, onDataPathChange, getDefaultDataPath);

  // Data Mutations (Contacts, Groups, Servers, On-Call)
  setupDataHandlers(getMainWindow, getFileManager);

  // File System Operations
  setupFileHandlers(getDataRoot);

  // Location & Weather
  setupLocationHandlers(getMainWindow);
  setupWeatherHandlers();

  // Window Management
  setupWindowHandlers(getMainWindow, createAuxWindow);

  // Feature Handlers (Presets, History, Notes, Saved Locations)
  setupFeatureHandlers(getDataRoot);

  // Data Record Handlers (JSON-based contacts, servers, on-call, data manager)
  setupDataRecordHandlers(getDataRoot);

  // Listen for maximize/unmaximize events and notify renderer
  // Handled in main/index.ts after window creation

}
