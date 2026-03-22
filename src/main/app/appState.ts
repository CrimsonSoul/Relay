import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { setupIpcHandlers } from '../ipcHandlers';
import { setupAuthHandlers, setupAuthInterception } from '../handlers/authHandlers';
import { setupLoggerHandlers } from '../handlers/loggerHandlers';
import { ensureDataFilesAsync, loadConfigAsync, saveConfigAsync } from '../dataUtils';
import { validateDataPath } from '../pathValidation';
import { loggers } from '../logger';
import { getSecureOrigin, isTrustedGeolocationOrigin } from '../securityPolicy';
import type { AppConfig } from '../config/AppConfig';
import type { PocketBaseProcess } from '../pocketbase/PocketBaseProcess';
import type { BackupManager } from '../pocketbase/BackupManager';
import type { RetentionManager } from '../pocketbase/RetentionManager';
import type { OfflineCache } from '../cache/OfflineCache';
import type { PendingChanges } from '../cache/PendingChanges';
import type { SyncManager } from '../cache/SyncManager';

export interface AppState {
  mainWindow: BrowserWindow | null;
  currentDataRoot: string;
  // PocketBase-related state
  appConfig: AppConfig | null;
  pbProcess: PocketBaseProcess | null;
  backupManager: BackupManager | null;
  retentionManager: RetentionManager | null;
  offlineCache: OfflineCache | null;
  pendingChanges: PendingChanges | null;
  syncManager: SyncManager | null;
}

export const state: AppState = {
  mainWindow: null,
  currentDataRoot: '',
  appConfig: null,
  pbProcess: null,
  backupManager: null,
  retentionManager: null,
  offlineCache: null,
  pendingChanges: null,
  syncManager: null,
};

export const getDefaultDataPath = () => join(app.getPath('userData'), 'data');
export const getBundledDataPath = () =>
  app.isPackaged ? join(process.resourcesPath, 'data') : join(process.cwd(), 'data');

/**
 * Cached promise for the data root resolution.
 * Once resolved, `state.currentDataRoot` is set and subsequent calls
 * return immediately without hitting disk.
 */
let dataRootPromise: Promise<string> | null = null;

/** Reset the cached data root promise (for testing). */
export function resetDataRootCache() {
  dataRootPromise = null;
}

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
  dataRootPromise ??= (async () => {
    try {
      const config = await loadConfigAsync();
      const root = config.dataRoot || getDefaultDataPath();
      await ensureDataFilesAsync(root);
      state.currentDataRoot = root;
      loggers.main.info('Data root resolved', { path: root });
      return root;
    } catch (error) {
      dataRootPromise = null;
      throw error;
    }
  })();

  return dataRootPromise;
}

/**
 * Handles a user-initiated data path change. Fully async — saves config
 * and invalidates the cache.
 */
export async function handleDataPathChange(newPath: string): Promise<void> {
  if (!state.mainWindow) return;
  const validation = await validateDataPath(newPath);
  if (!validation.success) throw new Error(validation.error || 'Invalid data path');

  await ensureDataFilesAsync(newPath);
  await saveConfigAsync({ dataRoot: newPath });

  // Update cached root and invalidate the deferred promise
  state.currentDataRoot = newPath;
  dataRootPromise = null;
}

export function setupIpc(createAuxWindow?: (route: string) => void) {
  setupIpcHandlers(
    () => state.mainWindow,
    getDataRoot,
    handleDataPathChange,
    getDefaultDataPath,
    createAuxWindow,
    () => state.appConfig,
    () => state.offlineCache,
    () => state.pendingChanges,
    () => state.syncManager,
  );
  setupAuthHandlers();
  setupAuthInterception(() => state.mainWindow);
  setupLoggerHandlers();
}

export function setupPermissions(sess: Electron.Session) {
  sess.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const isMainWindow = state.mainWindow?.webContents === webContents;

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
    const mainWindowWebContents = state.mainWindow?.webContents;
    const canCompareById =
      typeof mainWindowWebContents?.id === 'number' && typeof webContents.id === 'number';
    const isMainWindowById = canCompareById && mainWindowWebContents.id === webContents.id;
    const isMainWindow = isMainWindowById;
    const mainWindowOrigin = state.mainWindow
      ? getSecureOrigin(state.mainWindow.webContents.getURL())
      : null;
    const isMainWindowOrigin =
      mainWindowOrigin !== null && getSecureOrigin(requestingOrigin) === mainWindowOrigin;

    if (permission === 'geolocation') {
      return !!isMainWindow || isMainWindowOrigin || isTrustedGeolocationOrigin(requestingOrigin);
    }

    if (permission === 'media') {
      return !!isMainWindow;
    }

    return false;
  });
}
