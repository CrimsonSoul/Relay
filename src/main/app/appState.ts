import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { FileManager } from '../FileManager';
import { setupIpcHandlers } from '../ipcHandlers';
import { setupAuthHandlers, setupAuthInterception } from '../handlers/authHandlers';
import { setupLoggerHandlers } from '../handlers/loggerHandlers';
import { copyDataFiles, ensureDataFiles, ensureDataFilesAsync, loadConfig, loadConfigAsync, saveConfig } from '../dataUtils';
import { validateDataPath } from '../pathValidation';

export interface AppState {
  mainWindow: BrowserWindow | null;
  fileManager: FileManager | null;
  currentDataRoot: string;
}

export const state: AppState = { mainWindow: null, fileManager: null, currentDataRoot: '' };

export const getDefaultDataPath = () => join(app.getPath('userData'), 'data');
export const getBundledDataPath = () => app.isPackaged ? join(process.resourcesPath, 'data') : join(process.cwd(), 'data');

export async function getDataRootAsync(): Promise<string> {
  const config = await loadConfigAsync();
  if (config.dataRoot) {
    await ensureDataFilesAsync(config.dataRoot);
    return config.dataRoot;
  }
  const defaultDataPath = getDefaultDataPath();
  await ensureDataFilesAsync(defaultDataPath);
  return defaultDataPath;
}

export function getDataRoot() {
  const config = loadConfig();
  if (config.dataRoot) {
    ensureDataFiles(config.dataRoot);
    return config.dataRoot;
  }
  const defaultDataPath = getDefaultDataPath();
  ensureDataFiles(defaultDataPath);
  return defaultDataPath;
}

export function handleDataPathChange(newPath: string) {
  if (!state.mainWindow) return;
  const validation = validateDataPath(newPath);
  if (!validation.success) throw new Error(validation.error || 'Invalid data path');
  copyDataFiles(state.currentDataRoot, newPath);
  ensureDataFiles(newPath);
  saveConfig({ dataRoot: newPath });
  state.currentDataRoot = newPath;
  if (state.fileManager) { state.fileManager.destroy(); state.fileManager = null; }
  state.fileManager = new FileManager(state.currentDataRoot, getBundledDataPath());
  void state.fileManager.readAndEmit();
}

export function setupIpc(createAuxWindow?: (route: string) => void) {
  setupIpcHandlers(() => state.mainWindow, () => state.fileManager, () => state.currentDataRoot, handleDataPathChange, getDefaultDataPath, createAuxWindow);
  setupAuthHandlers();
  setupAuthInterception(() => state.mainWindow);
  setupLoggerHandlers();
}

export function setupPermissions(sess: Electron.Session) {
  sess.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'geolocation' || permission === 'media') { callback(true); return; }
    callback(false);
  });
  sess.setPermissionCheckHandler((_webContents, permission) => permission === 'geolocation' || permission === 'media');
}
