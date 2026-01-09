import { BrowserWindow } from 'electron';
import { FileManager } from './FileManager';
import { setupWeatherHandlers } from './handlers/weatherHandlers';
import { setupWindowHandlers, setupWindowListeners } from './handlers/windowHandlers';
import { setupConfigHandlers } from './handlers/configHandlers';
import { setupDataHandlers } from './handlers/dataHandlers';
import { setupFileHandlers } from './handlers/fileHandlers';
import { setupLocationHandlers } from './handlers/locationHandlers';

/**
 * Orchestrates all IPC handlers for the application.
 */
export function setupIpcHandlers(
  getMainWindow: () => BrowserWindow | null,
  getFileManager: () => FileManager | null,
  getDataRoot: () => string,
  onDataPathChange: (newPath: string) => void,
  getDefaultDataPath: () => string
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
  setupWindowHandlers(getMainWindow);

  // Listen for maximize/unmaximize events and notify renderer
  const mw = getMainWindow();
  if (mw) {
    setupWindowListeners(mw);
  }
}
