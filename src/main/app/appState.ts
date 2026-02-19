import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { FileManager } from '../FileManager';
import { setupIpcHandlers } from '../ipcHandlers';
import { setupAuthHandlers, setupAuthInterception } from '../handlers/authHandlers';
import { setupLoggerHandlers } from '../handlers/loggerHandlers';
import {
  copyDataFilesAsync,
  ensureDataFilesAsync,
  loadConfigAsync,
  saveConfigAsync,
} from '../dataUtils';
import { validateDataPath } from '../pathValidation';
import { loggers } from '../logger';
import { getSecureOrigin, isTrustedGeolocationOrigin } from '../securityPolicy';

export interface AppState {
  mainWindow: BrowserWindow | null;
  fileManager: FileManager | null;
  currentDataRoot: string;
}

export const state: AppState = { mainWindow: null, fileManager: null, currentDataRoot: '' };

export const getDefaultDataPath = () => join(app.getPath('userData'), 'data');
export const getBundledDataPath = () =>
  app.isPackaged ? join(process.resourcesPath, 'data') : join(process.cwd(), 'data');

/**
 * Cached promise for the data root resolution.
 * Once resolved, `state.currentDataRoot` is set and subsequent calls
 * return immediately without hitting disk.
 */
let dataRootPromise: Promise<string> | null = null;

/**
 * Returns the data root path. On the first call, resolves the path from
 * config (async), ensures directories exist, and caches the result in
 * `state.currentDataRoot`. Subsequent calls return the cached value
 * without any I/O.
 */
export async function getDataRoot(): Promise<string> {
  // Fast path: already resolved and cached
  if (state.currentDataRoot) return state.currentDataRoot;

  // Coalesce concurrent callers behind a single promise
  if (!dataRootPromise) {
    dataRootPromise = (async () => {
      const config = await loadConfigAsync();
      const root = config.dataRoot || getDefaultDataPath();
      await ensureDataFilesAsync(root);
      state.currentDataRoot = root;
      loggers.main.info('Data root resolved', { path: root });
      return root;
    })();
  }

  return dataRootPromise;
}

/**
 * Handles a user-initiated data path change. Fully async — copies files,
 * saves config, recreates the FileManager, and invalidates the cache.
 */
export async function handleDataPathChange(newPath: string): Promise<void> {
  if (!state.mainWindow) return;
  const validation = await validateDataPath(newPath);
  if (!validation.success) throw new Error(validation.error || 'Invalid data path');

  await copyDataFilesAsync(state.currentDataRoot, newPath);
  await ensureDataFilesAsync(newPath);
  await saveConfigAsync({ dataRoot: newPath });

  // Update cached root and invalidate the deferred promise
  state.currentDataRoot = newPath;
  dataRootPromise = null;

  if (state.fileManager) {
    state.fileManager.destroy();
    state.fileManager = null;
  }
  state.fileManager = new FileManager(state.currentDataRoot, getBundledDataPath());
  state.fileManager.init();
}

export function setupIpc(createAuxWindow?: (route: string) => void) {
  setupIpcHandlers(
    () => state.mainWindow,
    () => state.fileManager,
    getDataRoot,
    handleDataPathChange,
    getDefaultDataPath,
    createAuxWindow,
  );
  setupAuthHandlers();
  setupAuthInterception(() => state.mainWindow);
  setupLoggerHandlers();
}

export function setupPermissions(sess: Electron.Session) {
  sess.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const isMainWindow = state.mainWindow && webContents === state.mainWindow.webContents;

    if (permission === 'geolocation') {
      const requestingOrigin = getSecureOrigin(details.requestingUrl);
      const allowed = !!isMainWindow || isTrustedGeolocationOrigin(requestingOrigin);
      if (!allowed) {
        loggers.security.warn('Blocked geolocation permission request from untrusted origin', {
          requestingUrl: details.requestingUrl,
        });
      }
      callback(allowed);
      return;
    }

    if (permission === 'media') {
      callback(!!isMainWindow);
      return;
    }

    callback(false);
  });

  sess.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const isMainWindow = state.mainWindow && webContents === state.mainWindow.webContents;

    if (permission === 'geolocation') {
      return !!isMainWindow || isTrustedGeolocationOrigin(requestingOrigin);
    }

    if (permission === 'media') {
      return !!isMainWindow;
    }

    return false;
  });
}
