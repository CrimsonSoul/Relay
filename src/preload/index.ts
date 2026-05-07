import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type BridgeAPI, type AuthRequest } from '@shared/ipc';

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
  writeClipboardImage: (dataUrl) => ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD_WRITE_IMAGE, dataUrl),
  // Alerts
  saveAlertImage: (dataUrl, suggestedName) =>
    ipcRenderer.invoke(IPC_CHANNELS.SAVE_ALERT_IMAGE, dataUrl, suggestedName),
  saveCompanyLogo: () => ipcRenderer.invoke(IPC_CHANNELS.SAVE_COMPANY_LOGO),
  getCompanyLogo: () => ipcRenderer.invoke(IPC_CHANNELS.GET_COMPANY_LOGO),
  removeCompanyLogo: () => ipcRenderer.invoke(IPC_CHANNELS.REMOVE_COMPANY_LOGO),
  saveFooterLogo: () => ipcRenderer.invoke(IPC_CHANNELS.SAVE_FOOTER_LOGO),
  getFooterLogo: () => ipcRenderer.invoke(IPC_CHANNELS.GET_FOOTER_LOGO),
  removeFooterLogo: () => ipcRenderer.invoke(IPC_CHANNELS.REMOVE_FOOTER_LOGO),
  // Setup
  getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.SETUP_GET_CONFIG),
  saveConfig: (config: unknown) => ipcRenderer.invoke(IPC_CHANNELS.SETUP_SAVE_CONFIG, config),
  clearConfig: () => ipcRenderer.invoke(IPC_CHANNELS.SETUP_CLEAR_CONFIG),
  isConfigured: () => ipcRenderer.invoke(IPC_CHANNELS.SETUP_IS_CONFIGURED),
  // Cache (offline)
  cacheRead: (collection: string) => ipcRenderer.invoke(IPC_CHANNELS.CACHE_READ, collection),
  cacheWrite: (collection: string, action: string, record: unknown) =>
    ipcRenderer.invoke(IPC_CHANNELS.CACHE_WRITE, collection, action, record),
  cacheSnapshot: (collection: string, records: unknown[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.CACHE_SNAPSHOT, collection, records),
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
  openAuxWindow: (route) => ipcRenderer.send(IPC_CHANNELS.WINDOW_OPEN_AUX, route),
  platform: process.platform,
};

contextBridge.exposeInMainWorld('api', api);
