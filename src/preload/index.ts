import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type BridgeAPI, type AuthRequest } from '@shared/ipc';
import type { DynatraceDashboardState } from '@shared/dynatrace';

const api: BridgeAPI = {
  /** Path validation and sandboxing constraints are enforced on the main process side. */
  openPath: (path) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_PATH, path),
  openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL, url),

  onAuthRequested: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, request: AuthRequest) => {
      callback(request);
    };
    ipcRenderer.on(IPC_CHANNELS.AUTH_REQUESTED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.AUTH_REQUESTED, handler);
  },

  submitAuth: (nonce, username, password, remember) => {
    return ipcRenderer.invoke(IPC_CHANNELS.AUTH_SUBMIT, { nonce, username, password, remember });
  },

  cancelAuth: (nonce) => {
    ipcRenderer.send(IPC_CHANNELS.AUTH_CANCEL, { nonce });
  },

  useCachedAuth: (nonce) => {
    return ipcRenderer.invoke(IPC_CHANNELS.AUTH_USE_CACHED, { nonce });
  },

  logBridge: (groups) => ipcRenderer.send(IPC_CHANNELS.LOG_BRIDGE, groups),
  getCloudStatus: () => ipcRenderer.invoke(IPC_CHANNELS.GET_CLOUD_STATUS),
  logToMain: (entry) => ipcRenderer.send(IPC_CHANNELS.LOG_TO_MAIN, entry),

  // Dynatrace dashboards
  listDynatraceDashboards: () => ipcRenderer.invoke(IPC_CHANNELS.DYNATRACE_LIST_DASHBOARDS),
  addDynatraceDashboard: (input) => ipcRenderer.invoke(IPC_CHANNELS.DYNATRACE_ADD_DASHBOARD, input),
  updateDynatraceDashboard: (id, input) =>
    ipcRenderer.invoke(IPC_CHANNELS.DYNATRACE_UPDATE_DASHBOARD, id, input),
  removeDynatraceDashboard: (id) => ipcRenderer.invoke(IPC_CHANNELS.DYNATRACE_REMOVE_DASHBOARD, id),
  openDynatraceDashboard: (id) => ipcRenderer.invoke(IPC_CHANNELS.DYNATRACE_OPEN_DASHBOARD, id),
  clearDynatraceSession: () => ipcRenderer.invoke(IPC_CHANNELS.DYNATRACE_CLEAR_SESSION),
  onDynatraceDashboardsChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, dashboards: DynatraceDashboardState[]) =>
      callback(dashboards);
    ipcRenderer.on(IPC_CHANNELS.DYNATRACE_DASHBOARDS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DYNATRACE_DASHBOARDS_CHANGED, handler);
  },
  getDynatraceProblemsSettings: () =>
    ipcRenderer.invoke(IPC_CHANNELS.DYNATRACE_PROBLEMS_GET_SETTINGS),
  saveDynatraceProblemsSettings: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.DYNATRACE_PROBLEMS_SAVE_SETTINGS, input),
  testDynatraceProblemsSettings: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.DYNATRACE_PROBLEMS_TEST_SETTINGS, input),
  clearDynatraceProblemsSettings: () =>
    ipcRenderer.invoke(IPC_CHANNELS.DYNATRACE_PROBLEMS_CLEAR_SETTINGS),
  syncDynatraceProblems: () => ipcRenderer.invoke(IPC_CHANNELS.DYNATRACE_PROBLEMS_SYNC),
  saveDynatraceProblemProfileFilter: (alertingProfiles) =>
    ipcRenderer.invoke(IPC_CHANNELS.DYNATRACE_PROBLEMS_SAVE_PROFILE_FILTER, alertingProfiles),
  // Relay operators
  createRelayOperator: (input) => ipcRenderer.invoke(IPC_CHANNELS.RELAY_OPERATOR_CREATE, input),
  renameRelayOperator: (input) => ipcRenderer.invoke(IPC_CHANNELS.RELAY_OPERATOR_RENAME, input),
  setRelayOperatorActive: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.RELAY_OPERATOR_SET_ACTIVE, input),
  // Privileged access
  getPrivilegedSession: () => ipcRenderer.invoke(IPC_CHANNELS.PRIVILEGED_GET_SESSION),
  loginPrivileged: (input) => ipcRenderer.invoke(IPC_CHANNELS.PRIVILEGED_LOGIN, input),
  logoutPrivileged: () => ipcRenderer.invoke(IPC_CHANNELS.PRIVILEGED_LOGOUT),
  lockPrivileged: () => ipcRenderer.invoke(IPC_CHANNELS.PRIVILEGED_LOCK),
  reauthenticatePrivileged: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.PRIVILEGED_REAUTHENTICATE, input),
  createPrivilegedPairingChallenge: (targetAccountId) =>
    ipcRenderer.invoke(IPC_CHANNELS.PRIVILEGED_CREATE_PAIRING_CHALLENGE, targetAccountId),
  completePrivilegedPairing: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.PRIVILEGED_COMPLETE_PAIRING, input),
  submitPrivilegedCommand: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.PRIVILEGED_SUBMIT_COMMAND, input),
  setupInitialAdministratorCredential: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.PRIVILEGED_SETUP_INITIAL_ADMIN, input),
  setupPrivilegedCredential: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.PRIVILEGED_SETUP_CREDENTIAL, input),
  onPrivilegedSessionChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, view: Parameters<typeof callback>[0]) =>
      callback(view);
    ipcRenderer.on(IPC_CHANNELS.PRIVILEGED_SESSION_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PRIVILEGED_SESSION_CHANGED, handler);
  },

  // Drag Sync
  notifyDragStart: () => ipcRenderer.send(IPC_CHANNELS.DRAG_STARTED),
  notifyDragStop: () => ipcRenderer.send(IPC_CHANNELS.DRAG_STOPPED),
  onDragStateChange: (callback) => {
    const startHandler = () => callback(true);
    const stopHandler = () => callback(false);
    ipcRenderer.on(IPC_CHANNELS.DRAG_STARTED, startHandler);
    ipcRenderer.on(IPC_CHANNELS.DRAG_STOPPED, stopHandler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.DRAG_STARTED, startHandler);
      ipcRenderer.removeListener(IPC_CHANNELS.DRAG_STOPPED, stopHandler);
    };
  },

  // On-Call Alert Dismissal Sync
  notifyAlertDismissed: (type) => ipcRenderer.send(IPC_CHANNELS.ONCALL_ALERT_DISMISSED, type),
  onAlertDismissed: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, type: string) => callback(type);
    ipcRenderer.on(IPC_CHANNELS.ONCALL_ALERT_DISMISSED, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.ONCALL_ALERT_DISMISSED, handler);
    };
  },

  // Clipboard
  writeClipboard: (text) => ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD_WRITE, text),
  optimizeAlertImage: (dataUrl) => ipcRenderer.invoke(IPC_CHANNELS.OPTIMIZE_ALERT_IMAGE, dataUrl),
  // Alerts
  playAlertSound: () => ipcRenderer.invoke(IPC_CHANNELS.ALERT_PLAY_SOUND),
  selectReminderSound: () => ipcRenderer.invoke(IPC_CHANNELS.ALERT_SELECT_REMINDER_SOUND),
  saveAlertImage: (dataUrl, suggestedName) =>
    ipcRenderer.invoke(IPC_CHANNELS.SAVE_ALERT_IMAGE, dataUrl, suggestedName),
  selectAlertBodyImage: () => ipcRenderer.invoke(IPC_CHANNELS.SELECT_ALERT_BODY_IMAGE),
  saveAndOpenAlertDraft: (content) =>
    ipcRenderer.invoke(IPC_CHANNELS.ALERT_DRAFT_SAVE_AND_OPEN, content),
  // Schedule Bridge (.ics)
  saveAndOpenIcs: (content) => ipcRenderer.invoke(IPC_CHANNELS.ICS_SAVE_AND_OPEN, content),
  saveCompanyLogo: () => ipcRenderer.invoke(IPC_CHANNELS.SAVE_COMPANY_LOGO),
  getCompanyLogo: () => ipcRenderer.invoke(IPC_CHANNELS.GET_COMPANY_LOGO),
  removeCompanyLogo: () => ipcRenderer.invoke(IPC_CHANNELS.REMOVE_COMPANY_LOGO),
  saveFooterLogo: () => ipcRenderer.invoke(IPC_CHANNELS.SAVE_FOOTER_LOGO),
  getFooterLogo: () => ipcRenderer.invoke(IPC_CHANNELS.GET_FOOTER_LOGO),
  removeFooterLogo: () => ipcRenderer.invoke(IPC_CHANNELS.REMOVE_FOOTER_LOGO),
  // Setup
  getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.SETUP_GET_CONFIG),
  getConnectionSecret: () => ipcRenderer.invoke(IPC_CHANNELS.SETUP_GET_CONNECTION_CREDENTIAL),
  getClientHostname: () => ipcRenderer.invoke(IPC_CHANNELS.CLIENT_GET_HOSTNAME),
  saveConfig: (config: unknown) => ipcRenderer.invoke(IPC_CHANNELS.SETUP_SAVE_CONFIG, config),
  clearConfig: () => ipcRenderer.invoke(IPC_CHANNELS.SETUP_CLEAR_CONFIG),
  isConfigured: () => ipcRenderer.invoke(IPC_CHANNELS.SETUP_IS_CONFIGURED),
  testConnection: (payload) => ipcRenderer.invoke(IPC_CHANNELS.SETUP_TEST_CONNECTION, payload),
  discoverServers: () => ipcRenderer.invoke(IPC_CHANNELS.SETUP_DISCOVER_SERVERS),
  // Cache (offline)
  cacheRead: (collection: string) => ipcRenderer.invoke(IPC_CHANNELS.CACHE_READ, collection),
  cacheWrite: (collection: string, action: string, record: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.CACHE_WRITE, collection, action, record),
  cacheSnapshot: (collection: string, signature: string, records: unknown[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.CACHE_SNAPSHOT, collection, signature, records),
  mutateOffline: (input) => ipcRenderer.invoke(IPC_CHANNELS.OFFLINE_MUTATE, input),
  onOfflineMutationApplied: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, mutation: Parameters<typeof callback>[0]) =>
      callback(mutation);
    ipcRenderer.on(IPC_CHANNELS.OFFLINE_MUTATION_APPLIED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.OFFLINE_MUTATION_APPLIED, handler);
  },
  getPendingSyncStatus: () => ipcRenderer.invoke(IPC_CHANNELS.OFFLINE_PENDING_STATUS),
  onPendingSyncStatusChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, status: Parameters<typeof callback>[0]) =>
      callback(status);
    ipcRenderer.on(IPC_CHANNELS.OFFLINE_PENDING_STATUS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.OFFLINE_PENDING_STATUS_CHANGED, handler);
  },
  // Knowledge Base
  getKnowledgePdf: (request) => ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_GET_PDF, request),
  getKnowledgeIndexStatus: () => ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_GET_INDEX_STATUS),
  onKnowledgeIndexStatusChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, status: Parameters<typeof callback>[0]) =>
      callback(status);
    ipcRenderer.on(IPC_CHANNELS.KNOWLEDGE_INDEX_STATUS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.KNOWLEDGE_INDEX_STATUS_CHANGED, handler);
  },
  openKnowledgeWebLink: (url) => ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_OPEN_WEB_LINK, url),
  selectAndQueueKnowledgePdfs: () => ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_SELECT_AND_STAGE),
  getKnowledgeUploadQueue: () => ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_UPLOAD_QUEUE_GET),
  pauseKnowledgeUploadBatch: (batchId) =>
    ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_UPLOAD_BATCH_PAUSE, batchId),
  resumeKnowledgeUploadBatch: (batchId) =>
    ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_UPLOAD_BATCH_RESUME, batchId),
  retryKnowledgeUpload: (uploadId) =>
    ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_UPLOAD_RETRY, uploadId),
  reselectKnowledgeUploadSource: (uploadId) =>
    ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_UPLOAD_RESELECT, uploadId),
  cancelKnowledgeUpload: (uploadId) =>
    ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_UPLOAD_FILE_CANCEL, uploadId),
  cancelKnowledgeUploadBatch: (batchId) =>
    ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_UPLOAD_BATCH_CANCEL, batchId),
  onKnowledgeUploadQueueChanged: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, queue: Parameters<typeof callback>[0]) =>
      callback(queue);
    ipcRenderer.on(IPC_CHANNELS.KNOWLEDGE_UPLOAD_QUEUE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.KNOWLEDGE_UPLOAD_QUEUE_CHANGED, handler);
  },
  // Sync
  syncPending: () => ipcRenderer.invoke(IPC_CHANNELS.SYNC_PENDING),
  // PocketBase
  getPbConnection: () => ipcRenderer.invoke(IPC_CHANNELS.PB_GET_CONNECTION),
  refreshPbConnection: () => ipcRenderer.invoke(IPC_CHANNELS.PB_REFRESH_CONNECTION),
  startPocketBase: () => ipcRenderer.invoke(IPC_CHANNELS.PB_START),
  relaunchApp: () => ipcRenderer.invoke(IPC_CHANNELS.APP_RELAUNCH),

  // Backups
  listBackups: () => ipcRenderer.invoke(IPC_CHANNELS.BACKUP_LIST),
  createBackup: () => ipcRenderer.invoke(IPC_CHANNELS.BACKUP_CREATE),
  restoreBackup: (name: string) => ipcRenderer.invoke(IPC_CHANNELS.BACKUP_RESTORE, name),

  windowMinimize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE),
  windowMaximize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE),
  windowClose: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE),
  isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),
  onMaximizeChange: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized);
    ipcRenderer.on(IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGE, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGE, handler);
  },
  onErrorNotification: (callback) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      notification: { title: string; message: string },
    ) => callback(notification);
    ipcRenderer.on(IPC_CHANNELS.APP_ERROR_NOTIFICATION, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.APP_ERROR_NOTIFICATION, handler);
  },
  onPbCrashed: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, info: { error: string }) => callback(info);
    ipcRenderer.on(IPC_CHANNELS.PB_CRASHED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.PB_CRASHED, handler);
  },
  openAuxWindow: (route) => ipcRenderer.send(IPC_CHANNELS.WINDOW_OPEN_AUX, route),
  platform: process.platform,
};

contextBridge.exposeInMainWorld('api', api);
