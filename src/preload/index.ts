import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  type BridgeAPI,
  type AppData,
  type AuthRequest,
  type RadarSnapshot,
  type DataError,
} from '@shared/ipc';

const api: BridgeAPI = {
  openPath: (path) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_PATH, path),
  openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL, url),
  importGroupsFromCsv: () => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_GROUPS_FROM_CSV),
  subscribeToData: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: AppData) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.DATA_UPDATED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DATA_UPDATED, handler);
  },

  onReloadStart: (callback) => {
    const handler = () => callback();
    ipcRenderer.on(IPC_CHANNELS.DATA_RELOAD_STARTED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DATA_RELOAD_STARTED, handler);
  },

  onReloadComplete: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, success: boolean) => callback(success);
    ipcRenderer.on(IPC_CHANNELS.DATA_RELOAD_COMPLETED, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DATA_RELOAD_COMPLETED, handler);
  },

  onDataError: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, error: DataError) => callback(error);
    ipcRenderer.on(IPC_CHANNELS.DATA_ERROR, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.DATA_ERROR, handler);
  },

  getInitialData: () => ipcRenderer.invoke(IPC_CHANNELS.DATA_GET_INITIAL),
  reloadData: () => ipcRenderer.invoke(IPC_CHANNELS.DATA_RELOAD),

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

  subscribeToRadar: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, data: RadarSnapshot) => callback(data);
    ipcRenderer.on(IPC_CHANNELS.RADAR_DATA, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.RADAR_DATA, handler);
  },

  logBridge: (groups) => ipcRenderer.send(IPC_CHANNELS.LOG_BRIDGE, groups),
  getWeather: (lat, lon) => ipcRenderer.invoke(IPC_CHANNELS.GET_WEATHER, lat, lon),
  searchLocation: (query) => ipcRenderer.invoke(IPC_CHANNELS.SEARCH_LOCATION, query),
  getWeatherAlerts: (lat, lon) => ipcRenderer.invoke(IPC_CHANNELS.GET_WEATHER_ALERTS, lat, lon),
  addContact: (contact) => ipcRenderer.invoke(IPC_CHANNELS.ADD_CONTACT, contact),
  removeContact: (email) => ipcRenderer.invoke(IPC_CHANNELS.REMOVE_CONTACT, email),
  addServer: (server) => ipcRenderer.invoke(IPC_CHANNELS.ADD_SERVER, server),
  removeServer: (name) => ipcRenderer.invoke(IPC_CHANNELS.REMOVE_SERVER, name),
  changeDataFolder: () => ipcRenderer.invoke(IPC_CHANNELS.CHANGE_DATA_FOLDER),
  resetDataFolder: () => ipcRenderer.invoke(IPC_CHANNELS.RESET_DATA_FOLDER),
  getDataPath: () => ipcRenderer.invoke(IPC_CHANNELS.GET_DATA_PATH),
  registerRadarUrl: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.REGISTER_RADAR_URL, url),
  updateOnCallTeam: (team, rows) => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_ONCALL_TEAM, team, rows),
  removeOnCallTeam: (team) => ipcRenderer.invoke(IPC_CHANNELS.REMOVE_ONCALL_TEAM, team),
  renameOnCallTeam: (oldName, newName) =>
    ipcRenderer.invoke(IPC_CHANNELS.RENAME_ONCALL_TEAM, oldName, newName),
  reorderOnCallTeams: (teamOrder, layout) =>
    ipcRenderer.invoke(IPC_CHANNELS.REORDER_ONCALL_TEAMS, teamOrder, layout),
  saveAllOnCall: (rows) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_ALL_ONCALL, rows),
  generateDummyData: () => ipcRenderer.invoke(IPC_CHANNELS.GENERATE_DUMMY_DATA),
  getIpLocation: () => ipcRenderer.invoke(IPC_CHANNELS.GET_IP_LOCATION),
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

  // Bridge Groups
  getGroups: () => ipcRenderer.invoke(IPC_CHANNELS.GET_GROUPS),
  saveGroup: (group) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_GROUP, group),
  updateGroup: (id, updates) => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_GROUP, id, updates),
  deleteGroup: (id) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_GROUP, id),
  // Bridge History
  getBridgeHistory: () => ipcRenderer.invoke(IPC_CHANNELS.GET_BRIDGE_HISTORY),
  addBridgeHistory: (entry) => ipcRenderer.invoke(IPC_CHANNELS.ADD_BRIDGE_HISTORY, entry),
  deleteBridgeHistory: (id) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_BRIDGE_HISTORY, id),
  clearBridgeHistory: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_BRIDGE_HISTORY),
  // Notes
  getNotes: () => ipcRenderer.invoke(IPC_CHANNELS.GET_NOTES),
  setContactNote: (email, note, tags) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_CONTACT_NOTE, email, note, tags),
  setServerNote: (name, note, tags) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_SERVER_NOTE, name, note, tags),
  // Saved Locations
  getSavedLocations: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SAVED_LOCATIONS),
  saveLocation: (location) => ipcRenderer.invoke(IPC_CHANNELS.SAVE_LOCATION, location),
  deleteLocation: (id) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_LOCATION, id),
  setDefaultLocation: (id) => ipcRenderer.invoke(IPC_CHANNELS.SET_DEFAULT_LOCATION, id),
  clearDefaultLocation: (id) => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_DEFAULT_LOCATION, id),
  updateLocation: (id, updates) => ipcRenderer.invoke(IPC_CHANNELS.UPDATE_LOCATION, id, updates),
  // Contact Records (JSON)
  getContacts: () => ipcRenderer.invoke(IPC_CHANNELS.GET_CONTACTS),
  addContactRecord: (contact) => ipcRenderer.invoke(IPC_CHANNELS.ADD_CONTACT_RECORD, contact),
  updateContactRecord: (id, updates) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_CONTACT_RECORD, id, updates),
  deleteContactRecord: (id) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_CONTACT_RECORD, id),
  // Server Records (JSON)
  getServers: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SERVERS),
  addServerRecord: (server) => ipcRenderer.invoke(IPC_CHANNELS.ADD_SERVER_RECORD, server),
  updateServerRecord: (id, updates) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_SERVER_RECORD, id, updates),
  deleteServerRecord: (id) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_SERVER_RECORD, id),
  // OnCall Records (JSON)
  getOnCall: () => ipcRenderer.invoke(IPC_CHANNELS.GET_ONCALL),
  addOnCallRecord: (record) => ipcRenderer.invoke(IPC_CHANNELS.ADD_ONCALL_RECORD, record),
  updateOnCallRecord: (id, updates) =>
    ipcRenderer.invoke(IPC_CHANNELS.UPDATE_ONCALL_RECORD, id, updates),
  deleteOnCallRecord: (id) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_ONCALL_RECORD, id),
  deleteOnCallByTeam: (team) => ipcRenderer.invoke(IPC_CHANNELS.DELETE_ONCALL_BY_TEAM, team),
  // Data Manager
  exportData: (options) => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_DATA, options),
  importData: (category) => ipcRenderer.invoke(IPC_CHANNELS.IMPORT_DATA, category),
  getDataStats: () => ipcRenderer.invoke(IPC_CHANNELS.GET_DATA_STATS),
  // Clipboard
  writeClipboard: (text) => ipcRenderer.invoke(IPC_CHANNELS.CLIPBOARD_WRITE, text),
  windowMinimize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE),
  windowMaximize: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE),
  windowClose: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE),
  isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),
  onMaximizeChange: (callback) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) =>
      callback(_event, maximized);
    ipcRenderer.on(IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGE, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGE, handler);
  },
  openAuxWindow: (route) => ipcRenderer.send(IPC_CHANNELS.WINDOW_OPEN_AUX, route),
  platform: process.platform,
};

contextBridge.exposeInMainWorld('api', api);
