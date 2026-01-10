import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type BridgeAPI, type AppData, type AuthRequest, type RadarSnapshot, type MetricsData, type DataError, type ImportProgress, type WeatherAlert } from '@shared/ipc';

const api: BridgeAPI = {
  openPath: (path) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_PATH, path),
  openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL, url),
  openGroupsFile: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_GROUPS_FILE),
  openContactsFile: () => ipcRenderer.invoke(IPC_CHANNELS.OPEN_CONTACTS_FILE),
  importGroupsFile: () => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_GROUPS_FILE),
  importContactsFile: () => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_CONTACTS_FILE),
  importServersFile: () => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_SERVERS_FILE),

  subscribeToData: (callback) => {
    ipcRenderer.removeAllListeners(IPC_CHANNELS.DATA_UPDATED);
    const handler = (_event: Electron.IpcRendererEvent, data: AppData) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.DATA_UPDATED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DATA_UPDATED, handler);
  },

  onReloadStart: (callback) => {
    ipcRenderer.removeAllListeners(IPC_CHANNELS.DATA_RELOAD_STARTED);
    const handler = () => callback();
    ipcRenderer.on(IPC_CHANNELS.DATA_RELOAD_STARTED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DATA_RELOAD_STARTED, handler);
  },

  onReloadComplete: (callback) => {
    ipcRenderer.removeAllListeners(IPC_CHANNELS.DATA_RELOAD_COMPLETED);
    const handler = (_event: Electron.IpcRendererEvent, success: boolean) => callback(success);
    ipcRenderer.on(IPC_CHANNELS.DATA_RELOAD_COMPLETED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DATA_RELOAD_COMPLETED, handler);
  },

  onDataError: (callback) => {
    ipcRenderer.removeAllListeners(IPC_CHANNELS.DATA_ERROR);
    const handler = (_event: Electron.IpcRendererEvent, error: DataError) => callback(error);
    ipcRenderer.on(IPC_CHANNELS.DATA_ERROR, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DATA_ERROR, handler);
  },

  onImportProgress: (callback) => {
    ipcRenderer.removeAllListeners(IPC_CHANNELS.IMPORT_PROGRESS);
    const handler = (_event: Electron.IpcRendererEvent, progress: ImportProgress) => {
      callback(progress);
    };
    ipcRenderer.on(IPC_CHANNELS.IMPORT_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.IMPORT_PROGRESS, handler);
  },

  reloadData: () => ipcRenderer.invoke(IPC_CHANNELS.DATA_RELOAD),

  onAuthRequested: (callback) => {
    ipcRenderer.removeAllListeners(IPC_CHANNELS.AUTH_REQUESTED);
    ipcRenderer.on(IPC_CHANNELS.AUTH_REQUESTED, (_event, request: AuthRequest) => {
      callback(request);
    });
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

  subscribeToRadar: (callback) => {
    ipcRenderer.removeAllListeners(IPC_CHANNELS.RADAR_DATA);
    ipcRenderer.on(IPC_CHANNELS.RADAR_DATA, (_event, data: RadarSnapshot) => {
      callback(data);
    });
  },

  logBridge: (groups) => ipcRenderer.send(IPC_CHANNELS.LOG_BRIDGE, groups),
  getWeather: (lat, lon) => ipcRenderer.invoke(IPC_CHANNELS.GET_WEATHER, lat, lon),
  searchLocation: (query) => ipcRenderer.invoke(IPC_CHANNELS.SEARCH_LOCATION, query),
  getWeatherAlerts: (lat, lon) => ipcRenderer.invoke(IPC_CHANNELS.GET_WEATHER_ALERTS, lat, lon),
  addContact: (contact) => ipcRenderer.invoke(IPC_CHANNELS.ADD_CONTACT, contact),
  removeContact: (email) => ipcRenderer.invoke(IPC_CHANNELS.REMOVE_CONTACT, email),
  addServer: (server) => ipcRenderer.invoke(IPC_CHANNELS.ADD_SERVER, server),
  removeServer: (name) => ipcRenderer.invoke(IPC_CHANNELS.REMOVE_SERVER, name),
  addGroup: (groupName) => ipcRenderer.invoke(IPC_CHANNELS.ADD_GROUP, groupName),
  addContactToGroup: (groupName, email) => ipcRenderer.invoke(IPC_CHANNELS.ADD_CONTACT_TO_GROUP, groupName, email),
  removeContactFromGroup: (groupName, email) => ipcRenderer.invoke(IPC_CHANNELS.REMOVE_CONTACT_FROM_GROUP, groupName, email),
  importContactsWithMapping: () => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_CONTACTS_WITH_MAPPING),
  changeDataFolder: () => ipcRenderer.invoke(IPC_CHANNELS.CHANGE_DATA_FOLDER),
  resetDataFolder: () => ipcRenderer.invoke(IPC_CHANNELS.RESET_DATA_FOLDER),
  getDataPath: () => ipcRenderer.invoke(IPC_CHANNELS.GET_DATA_PATH),
  removeGroup: (groupName) => ipcRenderer.invoke(IPC_CHANNELS.REMOVE_GROUP, groupName),
  renameGroup: (oldName, newName) => ipcRenderer.invoke(IPC_CHANNELS.RENAME_GROUP, oldName, newName),
  updateOnCallTeam: (team, rows) => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_ONCALL_TEAM, team, rows),
  removeOnCallTeam: (team) => ipcRenderer.invoke(IPC_CHANNELS.REMOVE_ONCALL_TEAM, team),
  renameOnCallTeam: (oldName, newName) => ipcRenderer.invoke(IPC_CHANNELS.RENAME_ONCALL_TEAM, oldName, newName),
  saveAllOnCall: (rows) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_ALL_ONCALL, rows),
  generateDummyData: () => ipcRenderer.invoke(IPC_CHANNELS.GENERATE_DUMMY_DATA),
  getIpLocation: () => ipcRenderer.invoke(IPC_CHANNELS.GET_IP_LOCATION),
  logToMain: (entry) => ipcRenderer.send(IPC_CHANNELS.LOG_TO_MAIN, entry),
  windowMinimize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE),
  windowMaximize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE),
  windowClose: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE),
  isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),
  onMaximizeChange: (callback) => {
    ipcRenderer.removeAllListeners(IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGE);
    ipcRenderer.on(IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGE, callback);
  },
  removeMaximizeListener: () => {
    ipcRenderer.removeAllListeners(IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGE);
  },
  platform: process.platform
};

contextBridge.exposeInMainWorld('api', api);
