import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { setupIpcHandlers } from '../ipcHandlers';
import { setupAuthHandlers, setupAuthInterception } from '../handlers/authHandlers';
import { setupLoggerHandlers } from '../handlers/loggerHandlers';
import { ensureDataDirectoryAsync, loadConfigAsync } from '../dataUtils';
import { loggers } from '../logger';
import type { AppConfig } from '../config/AppConfig';
import type { PocketBaseProcess } from '../pocketbase/PocketBaseProcess';
import type { BackupManager } from '../pocketbase/BackupManager';
import type { RetentionManager } from '../pocketbase/RetentionManager';
import type PocketBase from 'pocketbase';
import type { OfflineCache } from '../cache/OfflineCache';
import type { PendingChanges } from '../cache/PendingChanges';
import type { SyncManager } from '../cache/SyncManager';
import type { DynatraceWindowManager } from '../dynatrace/DynatraceWindowManager';
import type { DynatraceProblemsManager } from '../dynatrace/DynatraceProblemsManager';
import type { CloudStatusManager } from '../handlers/cloudStatus/CloudStatusManager';
import type { RadarManager } from '../handlers/radar/RadarManager';
import type { KnowledgePdfService } from '../knowledge/KnowledgePdfService';
import type { KnowledgeCoverService } from '../knowledge/KnowledgeCoverService';
import type { KnowledgeUploadService } from '../knowledge/KnowledgeUploadService';
import type { KnowledgeSearchService } from '../knowledge/KnowledgeSearchService';
import type { PrivilegedRuntime } from '../privileged/privilegedRuntime';
import type { ProductionPrivilegedHost } from '../privileged/ProductionPrivilegedHost';
import type { PrivilegedSessionView } from '@shared/privilegedAccess';
import type { PrivilegedApprovalRequestView } from '@shared/ipc';
import type { RelayWebServerManager } from '../web/RelayWebServerManager';
import type { WorkstationAwakeService } from '../power/WorkstationAwakeService';

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
  dynatraceWindowManager: DynatraceWindowManager | null;
  dynatraceProblemsManager: DynatraceProblemsManager | null;
  cloudStatusManager: CloudStatusManager | null;
  radarManager: RadarManager | null;
  knowledgePdfService: KnowledgePdfService | null;
  knowledgeCoverService: KnowledgeCoverService | null;
  knowledgeUploadService: KnowledgeUploadService | null;
  knowledgeSearchService: KnowledgeSearchService | null;
  privilegedRuntime: PrivilegedRuntime | null;
  privilegedHost: ProductionPrivilegedHost | null;
  relayWebServerManager: RelayWebServerManager | null;
  workstationAwakeService: WorkstationAwakeService | null;
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
  dynatraceWindowManager: null,
  dynatraceProblemsManager: null,
  cloudStatusManager: null,
  radarManager: null,
  knowledgePdfService: null,
  knowledgeCoverService: null,
  knowledgeUploadService: null,
  knowledgeSearchService: null,
  privilegedRuntime: null,
  privilegedHost: null,
  relayWebServerManager: null,
  workstationAwakeService: null,
};

const privilegedSessionListeners = new Set<(view: PrivilegedSessionView) => void>();
let stopPrivilegedRuntimeSubscription: (() => void) | null = null;
const privilegedApprovalListeners = new Set<(requests: PrivilegedApprovalRequestView[]) => void>();
let stopPrivilegedApprovalSubscription: (() => void) | null = null;

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
export function getDynatraceWindowManager() {
  return state.dynatraceWindowManager;
}
export function getDynatraceProblemsManager() {
  return state.dynatraceProblemsManager;
}
export function getRadarManager() {
  return state.radarManager;
}

export function setRadarManager(mgr: RadarManager | null) {
  log.debug('appState.radarManager changed');
  state.radarManager = mgr;
}

export function getCloudStatusManager() {
  return state.cloudStatusManager;
}
export function getKnowledgePdfService() {
  return state.knowledgePdfService;
}
export function getKnowledgeCoverService() {
  return state.knowledgeCoverService;
}
export function getKnowledgeUploadService() {
  return state.knowledgeUploadService;
}
export function notifyKnowledgeUploadSessionChanged(view: PrivilegedSessionView): void {
  state.knowledgeUploadService?.handleSessionChanged(view);
}
export function getKnowledgeSearchService() {
  return state.knowledgeSearchService;
}
export function getPrivilegedRuntime() {
  return state.privilegedRuntime;
}
export function getPrivilegedHost() {
  return state.privilegedHost;
}
export function getRelayWebServerManager() {
  return state.relayWebServerManager;
}
export function getWorkstationAwakeService() {
  return state.workstationAwakeService;
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
export function setDynatraceWindowManager(mgr: DynatraceWindowManager | null) {
  log.debug('appState.dynatraceWindowManager changed');
  state.dynatraceWindowManager = mgr;
}
export function setDynatraceProblemsManager(mgr: DynatraceProblemsManager | null) {
  log.debug('appState.dynatraceProblemsManager changed');
  state.dynatraceProblemsManager = mgr;
}
export function setCloudStatusManager(mgr: CloudStatusManager | null) {
  log.debug('appState.cloudStatusManager changed');
  state.cloudStatusManager = mgr;
}
export function setKnowledgePdfService(service: KnowledgePdfService | null) {
  log.debug('appState.knowledgePdfService changed');
  state.knowledgePdfService = service;
}
export function setKnowledgeCoverService(service: KnowledgeCoverService | null) {
  log.debug('appState.knowledgeCoverService changed');
  state.knowledgeCoverService = service;
}
export function setKnowledgeUploadService(service: KnowledgeUploadService | null) {
  log.debug('appState.knowledgeUploadService changed');
  state.knowledgeUploadService = service;
}
export function setKnowledgeSearchService(service: KnowledgeSearchService | null) {
  log.debug('appState.knowledgeSearchService changed');
  state.knowledgeSearchService = service;
}
export function setPrivilegedRuntime(runtime: PrivilegedRuntime | null) {
  stopPrivilegedRuntimeSubscription?.();
  stopPrivilegedRuntimeSubscription = null;
  state.privilegedRuntime = runtime;
  if (runtime) {
    stopPrivilegedRuntimeSubscription = runtime.onSessionChanged((view) => {
      for (const listener of privilegedSessionListeners) listener(view);
    });
  }
  log.debug('appState.privilegedRuntime changed');
}
export function setPrivilegedHost(host: ProductionPrivilegedHost | null) {
  stopPrivilegedApprovalSubscription?.();
  stopPrivilegedApprovalSubscription = null;
  state.privilegedHost = host;
  if (host) {
    stopPrivilegedApprovalSubscription = host.approvalCodes.subscribe((requests) => {
      for (const listener of privilegedApprovalListeners) listener(requests);
    });
  }
  log.debug('appState.privilegedHost changed');
}
export function setRelayWebServerManager(manager: RelayWebServerManager | null) {
  state.relayWebServerManager = manager;
  log.debug('appState.relayWebServerManager changed');
}
export function setWorkstationAwakeService(service: WorkstationAwakeService | null) {
  state.workstationAwakeService = service;
  log.debug('appState.workstationAwakeService changed');
}

export function subscribePrivilegedSessionChanged(
  listener: (view: PrivilegedSessionView) => void,
): () => void {
  privilegedSessionListeners.add(listener);
  return () => privilegedSessionListeners.delete(listener);
}

export function subscribeWebApprovalRequestsChanged(
  listener: (requests: PrivilegedApprovalRequestView[]) => void,
): () => void {
  privilegedApprovalListeners.add(listener);
  return () => privilegedApprovalListeners.delete(listener);
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

export async function setupIpc(restartPb?: () => Promise<boolean>): Promise<void> {
  await setupIpcHandlers({
    getMainWindow: () => state.mainWindow,
    getDataRoot,
    getAppConfig: () => state.appConfig,
    getCache: () => state.offlineCache,
    getPendingChanges: () => state.pendingChanges,
    getSyncManager: () => state.syncManager,
    getBackupManager: () => state.backupManager,
    getDynatraceWindowManager: () => state.dynatraceWindowManager,
    getDynatraceProblemsManager: () => state.dynatraceProblemsManager,
    getPbClient: () => state.pbClient,
    getKnowledgePdfService: () => state.knowledgePdfService,
    getKnowledgeCoverService: () => state.knowledgeCoverService,
    getKnowledgeUploadService: () => state.knowledgeUploadService,
    getKnowledgeSearchService: () => state.knowledgeSearchService,
    getPrivilegedRuntime: () => state.privilegedRuntime,
    getWebApprovalCodes: () => state.privilegedHost?.approvalCodes ?? null,
    getRelayWebServerManager: () => state.relayWebServerManager,
    getWorkstationAwakeService: () => state.workstationAwakeService,
    subscribePrivilegedSessionChanged,
    subscribeWebApprovalRequestsChanged,
    onPrivilegedCredentialChanged: (accountId) =>
      state.privilegedHost?.handleAuthorityChanged([accountId]),
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
      loggers.security.warn('Blocked geolocation permission request', {
        requestingUrl: details.requestingUrl,
      });
      callback(false);
      return;
    }

    if (permission === 'media') {
      loggers.security.warn('Blocked media permission request', {
        requestingUrl: details.requestingUrl,
        isMainWindow,
      });
      callback(false);
      return;
    }

    callback(false);
  });

  sess.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const mainWindowWebContents = state.mainWindow?.webContents;
    const canCompareById =
      typeof mainWindowWebContents?.id === 'number' && typeof webContents?.id === 'number';
    const isMainWindowById = canCompareById && mainWindowWebContents?.id === webContents?.id;
    const isMainWindow = isMainWindowById;

    if (permission === 'geolocation') {
      loggers.security.warn('Blocked geolocation permission check', { requestingOrigin });
      return false;
    }

    if (permission === 'media') {
      loggers.security.warn('Blocked media permission check', {
        requestingOrigin,
        isMainWindow,
      });
      return false;
    }

    return false;
  });
}
