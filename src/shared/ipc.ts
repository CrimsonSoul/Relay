type ContactRaw = {
  id?: string;
  createdAt?: number;
  updatedAt?: number;
  [key: string]: unknown;
};

export type Contact = {
  name: string;
  email: string;
  phone: string;
  title: string;
  _searchString: string;
  raw: ContactRaw;
};

type ServerRaw = {
  id?: string;
  createdAt?: number;
  updatedAt?: number;
  [key: string]: unknown;
};

export type Server = {
  name: string;
  businessArea: string;
  lob: string;
  comment: string;
  owner: string; // Email
  contact: string; // Email
  os: string;
  _searchString: string;
  raw: ServerRaw;
};

export type OnCallRow = {
  id: string;
  team: string;
  role: string;
  name: string;
  contact: string;
  timeWindow?: string;
};

type OnCallData = OnCallRow[];

export type IpcResult<T = void> = {
  success: boolean;
  data?: T;
  error?: string;
  rateLimited?: boolean;
};

export type OnCallEntry = {
  team: string;
  primary: string; // email
  backup: string; // email
  backupLabel?: string;
};

export type TeamLayout = {
  [teamName: string]: { x: number; y: number; w?: number; h?: number; static?: boolean };
};

export type AppData = {
  groups: BridgeGroup[];
  contacts: Contact[];
  servers: Server[];
  onCall: OnCallData;
  teamLayout?: TeamLayout;
  lastUpdated: number;
};

export type AuthRequest = {
  host: string;
  isProxy: boolean;
  nonce: string; // One-time token for secure auth response
  hasCachedCredentials?: boolean; // Whether credentials are available from cache
};

type RadarCounters = {
  ok?: number;
  pending?: number;
  internalError?: number;
};

type RadarStatusVariant = 'success' | 'warning' | 'danger' | 'info';

export type RadarSnapshot = {
  counters: RadarCounters;
  statusText?: string;
  statusColor?: string;
  statusVariant?: RadarStatusVariant;
  lastUpdated: number;
};

export type DataError = {
  type: 'validation' | 'parse' | 'write' | 'read' | 'persistence';
  message: string;
  file?: string;
  details?: unknown;
};

// Weather and Location Types
export type WeatherData = {
  timezone?: string;
  utc_offset_seconds?: number;
  current_weather: {
    temperature: number;
    windspeed: number;
    winddirection: number;
    weathercode: number;
    time: string;
  };
  hourly: {
    time: string[];
    temperature_2m: number[];
    weathercode: number[];
    precipitation_probability: number[];
  };
  daily: {
    time: string[];
    weathercode: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    wind_speed_10m_max: number[];
    precipitation_probability_max: number[];
  };
};

type LocationSearchResult = {
  results?: {
    name: string;
    lat: number;
    lon: number;
    admin1?: string;
    country_code: string;
  }[];
};

type IpLocationResult = {
  lat: number;
  lon: number;
  city: string;
  region: string;
  country: string;
  timezone?: string;
} | null;

export type BridgeAPI = {
  openPath: (path: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  importGroupsFromCsv: () => Promise<IpcResult>;
  subscribeToData: (callback: (data: AppData) => void) => () => void;
  onReloadStart: (callback: () => void) => () => void;
  onReloadComplete: (callback: (success: boolean) => void) => () => void;
  onDataError: (callback: (error: DataError) => void) => () => void;
  getInitialData: () => Promise<AppData>;
  reloadData: () => Promise<void>;
  onAuthRequested: (callback: (request: AuthRequest) => void) => () => void;
  submitAuth: (
    nonce: string,
    username: string,
    password: string,
    remember?: boolean,
  ) => Promise<boolean>;
  cancelAuth: (nonce: string) => void;
  useCachedAuth: (nonce: string) => Promise<boolean>;
  subscribeToRadar: (callback: (data: RadarSnapshot) => void) => () => void;
  logBridge: (groups: string[]) => void;
  getWeather: (lat: number, lon: number) => Promise<WeatherData | null>;
  searchLocation: (query: string) => Promise<LocationSearchResult>;
  getWeatherAlerts: (lat: number, lon: number) => Promise<WeatherAlert[]>;
  addContact: (contact: Partial<Contact>) => Promise<IpcResult>;
  removeContact: (email: string) => Promise<IpcResult>;
  addServer: (server: Partial<Server>) => Promise<IpcResult>;
  removeServer: (name: string) => Promise<IpcResult>;
  changeDataFolder: () => Promise<boolean>;
  resetDataFolder: () => Promise<boolean>;
  getDataPath: () => Promise<string>;
  registerRadarUrl: (url: string) => Promise<void>;
  updateOnCallTeam: (team: string, rows: OnCallRow[]) => Promise<IpcResult>;
  removeOnCallTeam: (team: string) => Promise<IpcResult>;
  renameOnCallTeam: (oldName: string, newName: string) => Promise<IpcResult>;
  reorderOnCallTeams: (teamOrder: string[], layout?: TeamLayout) => Promise<IpcResult>;
  saveAllOnCall: (rows: OnCallRow[]) => Promise<IpcResult>;
  windowMinimize: () => void;
  windowMaximize: () => void;
  windowClose: () => void;
  isMaximized: () => Promise<boolean>;
  onMaximizeChange: (callback: (event: unknown, maximized: boolean) => void) => () => void;
  openAuxWindow: (route: string) => void;
  generateDummyData: () => Promise<IpcResult>;
  getIpLocation: () => Promise<IpLocationResult>;
  logToMain: (entry: LogEntry) => void;
  // Drag and Drop Sync
  notifyDragStart: () => void;
  notifyDragStop: () => void;
  onDragStateChange: (callback: (isDragging: boolean) => void) => () => void;
  // Bridge Groups
  getGroups: () => Promise<BridgeGroup[]>;
  saveGroup: (
    group: Omit<BridgeGroup, 'id' | 'createdAt' | 'updatedAt'>,
  ) => Promise<IpcResult<BridgeGroup>>;
  updateGroup: (
    id: string,
    updates: Partial<Omit<BridgeGroup, 'id' | 'createdAt'>>,
  ) => Promise<IpcResult>;
  deleteGroup: (id: string) => Promise<IpcResult>;
  // Bridge History
  getBridgeHistory: () => Promise<BridgeHistoryEntry[]>;
  addBridgeHistory: (
    entry: Omit<BridgeHistoryEntry, 'id' | 'timestamp'>,
  ) => Promise<IpcResult<BridgeHistoryEntry>>;
  deleteBridgeHistory: (id: string) => Promise<IpcResult>;
  clearBridgeHistory: () => Promise<IpcResult>;
  // Notes
  getNotes: () => Promise<NotesData>;
  setContactNote: (email: string, note: string, tags: string[]) => Promise<IpcResult>;
  setServerNote: (name: string, note: string, tags: string[]) => Promise<IpcResult>;
  // Saved Locations
  getSavedLocations: () => Promise<SavedLocation[]>;
  saveLocation: (location: Omit<SavedLocation, 'id'>) => Promise<IpcResult<SavedLocation>>;
  deleteLocation: (id: string) => Promise<IpcResult>;
  setDefaultLocation: (id: string) => Promise<IpcResult>;
  clearDefaultLocation: (id: string) => Promise<IpcResult>;
  updateLocation: (id: string, updates: Partial<Omit<SavedLocation, 'id'>>) => Promise<IpcResult>;
  // Contact Records (JSON)
  getContacts: () => Promise<ContactRecord[]>;
  addContactRecord: (
    contact: Omit<ContactRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ) => Promise<IpcResult<ContactRecord>>;
  updateContactRecord: (
    id: string,
    updates: Partial<Omit<ContactRecord, 'id' | 'createdAt'>>,
  ) => Promise<IpcResult>;
  deleteContactRecord: (id: string) => Promise<IpcResult>;
  // Server Records (JSON)
  getServers: () => Promise<ServerRecord[]>;
  addServerRecord: (
    server: Omit<ServerRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ) => Promise<IpcResult<ServerRecord>>;
  updateServerRecord: (
    id: string,
    updates: Partial<Omit<ServerRecord, 'id' | 'createdAt'>>,
  ) => Promise<IpcResult>;
  deleteServerRecord: (id: string) => Promise<IpcResult>;
  // OnCall Records (JSON)
  getOnCall: () => Promise<OnCallRecord[]>;
  addOnCallRecord: (
    record: Omit<OnCallRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ) => Promise<IpcResult<OnCallRecord>>;
  updateOnCallRecord: (
    id: string,
    updates: Partial<Omit<OnCallRecord, 'id' | 'createdAt'>>,
  ) => Promise<IpcResult>;
  deleteOnCallRecord: (id: string) => Promise<IpcResult>;
  deleteOnCallByTeam: (team: string) => Promise<IpcResult>;
  // Data Manager
  exportData: (options: ExportOptions) => Promise<IpcResult>;
  importData: (category: DataCategory) => Promise<IpcResult<ImportResult>>;
  getDataStats: () => Promise<DataStats>;
  // Clipboard
  writeClipboard: (text: string) => Promise<boolean>;
  platform:
    | 'aix'
    | 'android'
    | 'darwin'
    | 'freebsd'
    | 'haiku'
    | 'linux'
    | 'openbsd'
    | 'sunos'
    | 'win32'
    | 'cygwin'
    | 'netbsd';
};

export const IPC_CHANNELS = {
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:isMaximized',
  WINDOW_MAXIMIZE_CHANGE: 'window:maximizeChange',
  WINDOW_OPEN_AUX: 'window:openAux',
  CHANGE_DATA_FOLDER: 'config:changeDataFolder',
  RESET_DATA_FOLDER: 'config:resetDataFolder',
  GET_DATA_PATH: 'config:getDataPath',
  OPEN_PATH: 'fs:openPath',
  OPEN_EXTERNAL: 'shell:openExternal',
  IMPORT_GROUPS_FROM_CSV: 'fs:importGroupsFromCsv',
  ADD_CONTACT: 'data:addContact',
  REMOVE_CONTACT: 'data:removeContact',
  ADD_SERVER: 'data:addServer',
  REMOVE_SERVER: 'data:removeServer',
  UPDATE_ONCALL_TEAM: 'data:updateOnCallTeam',
  REMOVE_ONCALL_TEAM: 'data:removeOnCallTeam',
  RENAME_ONCALL_TEAM: 'data:renameOnCallTeam',
  REORDER_ONCALL_TEAMS: 'data:reorderOnCallTeams',
  SAVE_ALL_ONCALL: 'data:saveAllOnCall',
  GENERATE_DUMMY_DATA: 'data:generateDummyData',
  DATA_GET_INITIAL: 'data:getInitial',
  DATA_UPDATED: 'data:updated',
  DATA_RELOAD: 'data:reload',
  DATA_RELOAD_STARTED: 'data:reload-started',
  DATA_RELOAD_COMPLETED: 'data:reload-completed',
  DATA_ERROR: 'data:error',
  AUTH_REQUESTED: 'auth:requested',
  AUTH_SUBMIT: 'auth:submit',
  AUTH_CANCEL: 'auth:cancel',
  AUTH_USE_CACHED: 'auth:useCached',
  RADAR_DATA: 'radar:data',
  REGISTER_RADAR_URL: 'config:registerRadarUrl',
  LOG_BRIDGE: 'metrics:logBridge',
  GET_WEATHER: 'weather:get',
  SEARCH_LOCATION: 'weather:search',
  GET_WEATHER_ALERTS: 'weather:alerts',
  GET_IP_LOCATION: 'location:ip',
  LOG_TO_MAIN: 'logger:toMain',
  // Bridge Groups
  GET_GROUPS: 'groups:get',
  SAVE_GROUP: 'groups:save',
  UPDATE_GROUP: 'groups:update',
  DELETE_GROUP: 'groups:delete',
  // Bridge History
  GET_BRIDGE_HISTORY: 'history:get',
  ADD_BRIDGE_HISTORY: 'history:add',
  DELETE_BRIDGE_HISTORY: 'history:delete',
  CLEAR_BRIDGE_HISTORY: 'history:clear',
  // Notes
  GET_NOTES: 'notes:get',
  SET_CONTACT_NOTE: 'notes:setContact',
  SET_SERVER_NOTE: 'notes:setServer',
  // Saved Locations
  GET_SAVED_LOCATIONS: 'locations:get',
  SAVE_LOCATION: 'locations:save',
  DELETE_LOCATION: 'locations:delete',
  SET_DEFAULT_LOCATION: 'locations:setDefault',
  CLEAR_DEFAULT_LOCATION: 'locations:clearDefault',
  UPDATE_LOCATION: 'locations:update',
  // Contact Records (JSON)
  GET_CONTACTS: 'contacts:get',
  ADD_CONTACT_RECORD: 'contacts:add',
  UPDATE_CONTACT_RECORD: 'contacts:update',
  DELETE_CONTACT_RECORD: 'contacts:delete',
  // Server Records (JSON)
  GET_SERVERS: 'servers:get',
  ADD_SERVER_RECORD: 'servers:add',
  UPDATE_SERVER_RECORD: 'servers:update',
  DELETE_SERVER_RECORD: 'servers:delete',
  // OnCall Records (JSON)
  GET_ONCALL: 'oncall:get',
  ADD_ONCALL_RECORD: 'oncall:add',
  UPDATE_ONCALL_RECORD: 'oncall:update',
  DELETE_ONCALL_RECORD: 'oncall:delete',
  DELETE_ONCALL_BY_TEAM: 'oncall:deleteByTeam',
  // Data Manager
  EXPORT_DATA: 'data:export',
  IMPORT_DATA: 'data:import',
  GET_DATA_STATS: 'data:stats',
  // Clipboard
  CLIPBOARD_WRITE: 'clipboard:write',
  // Drag Sync
  DRAG_STARTED: 'drag:started',
  DRAG_STOPPED: 'drag:stopped',
} as const;

export type WeatherAlert = {
  id: string;
  event: string;
  headline: string;
  description: string;
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
  urgency: 'Immediate' | 'Expected' | 'Future' | 'Past' | 'Unknown';
  certainty: 'Observed' | 'Likely' | 'Possible' | 'Unlikely' | 'Unknown';
  effective: string;
  expires: string;
  senderName: string;
  areaDesc: string;
};

export type LogEntry = {
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  module: string;
  message: string;
  data?: unknown;
};

// Bridge Groups - saved recipient lists with metadata
export type BridgeGroup = {
  id: string;
  name: string;
  contacts: string[]; // Email addresses in this group
  createdAt: number;
  updatedAt: number;
};

// Bridge History - log of past bridge compositions
export type BridgeHistoryEntry = {
  id: string;
  timestamp: number;
  note: string;
  groups: string[]; // Names of groups used
  contacts: string[]; // All contact emails in the composition
  recipientCount: number;
};

// Notes overlay for contacts and servers
export type NoteEntry = { note: string; tags: string[]; updatedAt: number };

export type NotesData = {
  contacts: Record<string, NoteEntry>;
  servers: Record<string, NoteEntry>;
};

// Saved weather locations
export type SavedLocation = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  isDefault: boolean;
};

// ============================================
// JSON Record Types (with IDs and timestamps)
// ============================================

/** Contact record stored in contacts.json */
export type ContactRecord = {
  id: string;
  name: string;
  email: string;
  phone: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

/** Server record stored in servers.json */
export type ServerRecord = {
  id: string;
  name: string;
  businessArea: string;
  lob: string;
  comment: string;
  owner: string;
  contact: string;
  os: string;
  createdAt: number;
  updatedAt: number;
};

/** OnCall record stored in oncall.json */
export type OnCallRecord = {
  id: string;
  team: string;
  role: string;
  name: string;
  contact: string;
  timeWindow?: string;
  createdAt: number;
  updatedAt: number;
};

// ============================================
// Import/Export Types
// ============================================

export type ExportFormat = 'json' | 'csv';
export type DataCategory = 'contacts' | 'servers' | 'oncall' | 'groups' | 'all';

export type ExportOptions = {
  format: ExportFormat;
  category: DataCategory;
  includeMetadata?: boolean;
};

export type ImportResult = {
  success: boolean;
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
};

export type DataStats = {
  contacts: { count: number; lastUpdated: number };
  servers: { count: number; lastUpdated: number };
  oncall: { count: number; lastUpdated: number };
  groups: { count: number; lastUpdated: number };
};
