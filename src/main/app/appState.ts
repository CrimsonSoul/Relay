import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { setupIpcHandlers } from '../ipcHandlers';
import { setupAuthHandlers, setupAuthInterception } from '../handlers/authHandlers';
import { setupLoggerHandlers } from '../handlers/loggerHandlers';
import { ensureDataDirectoryAsync, loadConfigAsync, saveConfigAsync } from '../dataUtils';
import { validateDataPath } from '../utils/pathValidation';
import { loggers } from '../logger';
import { getSecureOrigin, isTrustedGeolocationOrigin } from '../securityPolicy';
import type { AppConfig } from '../config/AppConfig';
import type { PocketBaseProcess } from '../pocketbase/PocketBaseProcess';
import type { BackupManager } from '../pocketbase/BackupManager';
import type { RetentionManager } from '../pocketbase/RetentionManager';
import type PocketBase from 'pocketbase';
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
  pbClient: PocketBase | null;
  offlineCache: OfflineCache | null;
  pendingChanges: PendingChanges | null;
  syncManager: SyncManager | null;
}

const state: AppState = {
  mainWindow: null,
  currentDataRoot: '',
  appConfig: null,
  pbProcess: null,
  backupManager: null,
  retentionManager: null,
  pbClient: null,
  offlineCache: null,
  pendingChanges: null,
  syncManager: null,
};

const log = loggers.main;

// --- Getters ---
export function getMainWindow() {
  return state.mainWindow;
}
export function getCurrentDataRoot() {
  return state.currentDataRoot;
}
export function getAppConfig() {
  return state.appConfig;
}
export function getPbProcess() {
  return state.pbProcess;
}
export function getBackupManager() {
  return state.backupManager;
}
export function getRetentionManager() {
  return state.retentionManager;
}
export function getPbClient() {
  return state.pbClient;
}
export function getOfflineCache() {
  return state.offlineCache;
}
export function getPendingChanges() {
  return state.pendingChanges;
}
export function getSyncManager() {
  return state.syncManager;
}

// --- Setters ---
export function setMainWindow(win: BrowserWindow | null) {
  log.debug('appState.mainWindow changed');
  state.mainWindow = win;
}
export function setCurrentDataRoot(root: string) {
  log.debug('appState.currentDataRoot changed', { path: root });
  state.currentDataRoot = root;
}
export function setAppConfig(config: AppConfig | null) {
  log.debug('appState.appConfig changed');
  state.appConfig = config;
}
export function setPbProcess(proc: PocketBaseProcess | null) {
  log.debug('appState.pbProcess changed');
  state.pbProcess = proc;
}
export function setBackupManager(mgr: BackupManager | null) {
  log.debug('appState.backupManager changed');
  state.backupManager = mgr;
}
export function setRetentionManager(mgr: RetentionManager | null) {
  log.debug('appState.retentionManager changed');
  state.retentionManager = mgr;
}
export function setPbClient(client: PocketBase | null) {
  log.debug('appState.pbClient changed');
  state.pbClient = client;
}
export function setOfflineCache(cache: OfflineCache | null) {
  log.debug('appState.offlineCache changed');
  state.offlineCache = cache;
}
export function setPendingChanges(changes: PendingChanges | null) {
  log.debug('appState.pendingChanges changed');
  state.pendingChanges = changes;
}
export function setSyncManager(mgr: SyncManager | null) {
  log.debug('appState.syncManager changed');
  state.syncManager = mgr;
}

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
      await ensureDataDirectoryAsync(root);
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

  await ensureDataDirectoryAsync(newPath);
  await saveConfigAsync({ dataRoot: newPath });

  // Update cached root and invalidate the deferred promise
  state.currentDataRoot = newPath;
  dataRootPromise = null;
}

export function setupIpc(
  createAuxWindow?: (route: string) => void,
  restartPb?: () => Promise<boolean>,
) {
  setupIpcHandlers({
    getMainWindow: () => state.mainWindow,
    getDataRoot,
    createAuxWindow,
    getAppConfig: () => state.appConfig,
    getCache: () => state.offlineCache,
    getPendingChanges: () => state.pendingChanges,
    getSyncManager: () => state.syncManager,
    getBackupManager: () => state.backupManager,
    restartPb,
  });
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
