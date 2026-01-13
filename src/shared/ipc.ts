export type Contact = {
  name: string;
  email: string;
  phone: string;
  title: string;
  _searchString: string;
  raw: Record<string, unknown>;
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
  raw: Record<string, unknown>;
};

export type OnCallRow = {
  id: string;
  team: string;
  role: string;
  name: string;
  contact: string;
  timeWindow?: string;
};

export type OnCallData = OnCallRow[];

export type OnCallEntry = {
  team: string;
  primary: string;  // email
  backup: string;   // email
  backupLabel?: string;
};

export type AppData = {
  groups: BridgeGroup[];
  contacts: Contact[];
  servers: Server[];
  onCall: OnCallData;
  lastUpdated: number;
};

export type AuthRequest = {
  host: string;
  isProxy: boolean;
  nonce: string; // One-time token for secure auth response
  hasCachedCredentials?: boolean; // Whether credentials are available from cache
};

export type RadarCounters = {
  ok?: number;
  pending?: number;
  internalError?: number;
};

export type RadarStatusVariant = "success" | "warning" | "danger" | "info";

export type RadarSnapshot = {
  counters: RadarCounters;
  statusText?: string;
  statusColor?: string;
  statusVariant?: RadarStatusVariant;
  lastUpdated: number;
};

export type DataError = {
  type: "validation" | "parse" | "write" | "read";
  message: string;
  file?: string;
  details?: unknown;
};

export type ImportProgress = {
  stage: "reading" | "validating" | "processing" | "writing" | "complete";
  totalRows: number;
  processedRows: number;
  percentage: number;
  message: string;
};

// Weather and Location Types
export type WeatherData = {
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
} | null;

export type LocationSearchResult = {
  results?: {
    name: string;
    lat: number;
    lon: number;
    admin1?: string;
    country_code: string;
  }[];
};

export type IpLocationResult = {
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
  openContactsFile: () => Promise<void>;
  importGroupsFromCsv: () => Promise<boolean>;
  importContactsFile: () => Promise<boolean>;
  importServersFile: () => Promise<boolean>;
  subscribeToData: (callback: (data: AppData) => void) => () => void;
  onReloadStart: (callback: () => void) => () => void;
  onReloadComplete: (callback: (success: boolean) => void) => () => void;
  onDataError: (callback: (error: DataError) => void) => () => void;
  onImportProgress: (callback: (progress: ImportProgress) => void) => () => void;
  reloadData: () => Promise<void>;
  onAuthRequested: (callback: (request: AuthRequest) => void) => void;
  submitAuth: (
    nonce: string,
    username: string,
    password: string,
    remember?: boolean
  ) => Promise<boolean>;
  cancelAuth: (nonce: string) => void;
  useCachedAuth: (nonce: string) => Promise<boolean>;
  subscribeToRadar: (callback: (data: RadarSnapshot) => void) => void;
  logBridge: (groups: string[]) => void;
  getWeather: (lat: number, lon: number) => Promise<WeatherData>;
  searchLocation: (query: string) => Promise<LocationSearchResult>;
  getWeatherAlerts: (lat: number, lon: number) => Promise<WeatherAlert[]>;
  addContact: (contact: Partial<Contact>) => Promise<boolean>;
  removeContact: (email: string) => Promise<boolean>;
  addServer: (server: Partial<Server>) => Promise<boolean>;
  removeServer: (name: string) => Promise<boolean>;
  importContactsWithMapping: () => Promise<boolean>;
  changeDataFolder: () => Promise<boolean>;
  resetDataFolder: () => Promise<boolean>;
  getDataPath: () => Promise<string>;
  updateOnCallTeam: (team: string, rows: OnCallRow[]) => Promise<boolean>;
  removeOnCallTeam: (team: string) => Promise<boolean>;
  renameOnCallTeam: (oldName: string, newName: string) => Promise<boolean>;
  saveAllOnCall: (rows: OnCallRow[]) => Promise<boolean>;
  windowMinimize: () => void;
  windowMaximize: () => void;
  windowClose: () => void;
  isMaximized: () => Promise<boolean>;
  onMaximizeChange: (
    callback: (event: unknown, maximized: boolean) => void
  ) => void;
  removeMaximizeListener: () => void;
  generateDummyData: () => Promise<boolean>;
  getIpLocation: () => Promise<IpLocationResult>;
  logToMain: (entry: LogEntry) => void;
  // Bridge Groups
  getGroups: () => Promise<BridgeGroup[]>;
  saveGroup: (group: Omit<BridgeGroup, 'id' | 'createdAt' | 'updatedAt'>) => Promise<BridgeGroup | null>;
  updateGroup: (id: string, updates: Partial<Omit<BridgeGroup, 'id' | 'createdAt'>>) => Promise<boolean>;
  deleteGroup: (id: string) => Promise<boolean>;
  // Bridge History
  getBridgeHistory: () => Promise<BridgeHistoryEntry[]>;
  addBridgeHistory: (entry: Omit<BridgeHistoryEntry, 'id' | 'timestamp'>) => Promise<BridgeHistoryEntry | null>;
  deleteBridgeHistory: (id: string) => Promise<boolean>;
  clearBridgeHistory: () => Promise<boolean>;
  // Notes
  getNotes: () => Promise<NotesData>;
  setContactNote: (email: string, note: string, tags: string[]) => Promise<boolean>;
  setServerNote: (name: string, note: string, tags: string[]) => Promise<boolean>;
  // Saved Locations
  getSavedLocations: () => Promise<SavedLocation[]>;
  saveLocation: (location: Omit<SavedLocation, 'id'>) => Promise<SavedLocation | null>;
  deleteLocation: (id: string) => Promise<boolean>;
  setDefaultLocation: (id: string) => Promise<boolean>;
  clearDefaultLocation: (id: string) => Promise<boolean>;
  updateLocation: (id: string, updates: Partial<Omit<SavedLocation, 'id'>>) => Promise<boolean>;
  // Contact Records (JSON)
  getContacts: () => Promise<ContactRecord[]>;
  addContactRecord: (contact: Omit<ContactRecord, 'id' | 'createdAt' | 'updatedAt'>) => Promise<ContactRecord | null>;
  updateContactRecord: (id: string, updates: Partial<Omit<ContactRecord, 'id' | 'createdAt'>>) => Promise<boolean>;
  deleteContactRecord: (id: string) => Promise<boolean>;
  // Server Records (JSON)
  getServers: () => Promise<ServerRecord[]>;
  addServerRecord: (server: Omit<ServerRecord, 'id' | 'createdAt' | 'updatedAt'>) => Promise<ServerRecord | null>;
  updateServerRecord: (id: string, updates: Partial<Omit<ServerRecord, 'id' | 'createdAt'>>) => Promise<boolean>;
  deleteServerRecord: (id: string) => Promise<boolean>;
  // OnCall Records (JSON)
  getOnCall: () => Promise<OnCallRecord[]>;
  addOnCallRecord: (record: Omit<OnCallRecord, 'id' | 'createdAt' | 'updatedAt'>) => Promise<OnCallRecord | null>;
  updateOnCallRecord: (id: string, updates: Partial<Omit<OnCallRecord, 'id' | 'createdAt'>>) => Promise<boolean>;
  deleteOnCallRecord: (id: string) => Promise<boolean>;
  deleteOnCallByTeam: (team: string) => Promise<boolean>;
  // Data Manager
  exportData: (options: ExportOptions) => Promise<boolean>;
  importData: (category: DataCategory) => Promise<ImportResult>;
  getDataStats: () => Promise<DataStats>;
  migrateFromCsv: () => Promise<MigrationResult>;
  // Clipboard
  writeClipboard: (text: string) => Promise<boolean>;
};

export const IPC_CHANNELS = {
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_MAXIMIZE: "window:maximize",
  WINDOW_CLOSE: "window:close",
  WINDOW_IS_MAXIMIZED: "window:isMaximized",
  WINDOW_MAXIMIZE_CHANGE: "window:maximizeChange",
  CHANGE_DATA_FOLDER: "config:changeDataFolder",
  RESET_DATA_FOLDER: "config:resetDataFolder",
  GET_DATA_PATH: "config:getDataPath",
  OPEN_PATH: "fs:openPath",
  OPEN_EXTERNAL: "shell:openExternal",
  OPEN_CONTACTS_FILE: "fs:openContactsFile",
  IMPORT_GROUPS_FROM_CSV: "fs:importGroupsFromCsv",
  IMPORT_CONTACTS_FILE: "fs:importContactsFile",
  IMPORT_SERVERS_FILE: "fs:importServersFile",
  ADD_CONTACT: "data:addContact",
  REMOVE_CONTACT: "data:removeContact",
  ADD_SERVER: "data:addServer",
  REMOVE_SERVER: "data:removeServer",
  UPDATE_ONCALL_TEAM: "data:updateOnCallTeam",
  REMOVE_ONCALL_TEAM: "data:removeOnCallTeam",
  RENAME_ONCALL_TEAM: "data:renameOnCallTeam",
  SAVE_ALL_ONCALL: "data:saveAllOnCall",
  IMPORT_CONTACTS_WITH_MAPPING: "data:importContactsWithMapping",
  GENERATE_DUMMY_DATA: "data:generateDummyData",
  DATA_UPDATED: "data:updated",
  DATA_RELOAD: "data:reload",
  DATA_RELOAD_STARTED: "data:reload-started",
  DATA_RELOAD_COMPLETED: "data:reload-completed",
  DATA_ERROR: "data:error",
  IMPORT_PROGRESS: "data:importProgress",
  AUTH_REQUESTED: "auth:requested",
  AUTH_SUBMIT: "auth:submit",
  AUTH_CANCEL: "auth:cancel",
  AUTH_USE_CACHED: "auth:useCached",
  RADAR_DATA: "radar:data",
  LOG_BRIDGE: "metrics:logBridge",
  GET_WEATHER: "weather:get",
  SEARCH_LOCATION: "weather:search",
  GET_WEATHER_ALERTS: "weather:alerts",
  GET_IP_LOCATION: "location:ip",
  LOG_TO_MAIN: "logger:toMain",
  // Bridge Groups
  GET_GROUPS: "groups:get",
  SAVE_GROUP: "groups:save",
  UPDATE_GROUP: "groups:update",
  DELETE_GROUP: "groups:delete",
  // Bridge History
  GET_BRIDGE_HISTORY: "history:get",
  ADD_BRIDGE_HISTORY: "history:add",
  DELETE_BRIDGE_HISTORY: "history:delete",
  CLEAR_BRIDGE_HISTORY: "history:clear",
  // Notes
  GET_NOTES: "notes:get",
  SET_CONTACT_NOTE: "notes:setContact",
  SET_SERVER_NOTE: "notes:setServer",
  // Saved Locations
  GET_SAVED_LOCATIONS: "locations:get",
  SAVE_LOCATION: "locations:save",
  DELETE_LOCATION: "locations:delete",
  SET_DEFAULT_LOCATION: "locations:setDefault",
  CLEAR_DEFAULT_LOCATION: "locations:clearDefault",
  UPDATE_LOCATION: "locations:update",
  // Contact Records (JSON)
  GET_CONTACTS: "contacts:get",
  ADD_CONTACT_RECORD: "contacts:add",
  UPDATE_CONTACT_RECORD: "contacts:update",
  DELETE_CONTACT_RECORD: "contacts:delete",
  // Server Records (JSON)
  GET_SERVERS: "servers:get",
  ADD_SERVER_RECORD: "servers:add",
  UPDATE_SERVER_RECORD: "servers:update",
  DELETE_SERVER_RECORD: "servers:delete",
  // OnCall Records (JSON)
  GET_ONCALL: "oncall:get",
  ADD_ONCALL_RECORD: "oncall:add",
  UPDATE_ONCALL_RECORD: "oncall:update",
  DELETE_ONCALL_RECORD: "oncall:delete",
  DELETE_ONCALL_BY_TEAM: "oncall:deleteByTeam",
  // Data Manager
  EXPORT_DATA: "data:export",
  IMPORT_DATA: "data:import",
  GET_DATA_STATS: "data:stats",
  MIGRATE_CSV_TO_JSON: "data:migrate",
  // Clipboard
  CLIPBOARD_WRITE: "clipboard:write",
} as const;

export type BridgeEvent = {
  timestamp: number;
  groups: string[];
};

export type WeatherAlert = {
  id: string;
  event: string;
  headline: string;
  description: string;
  severity: "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";
  urgency: "Immediate" | "Expected" | "Future" | "Past" | "Unknown";
  certainty: "Observed" | "Likely" | "Possible" | "Unlikely" | "Unknown";
  effective: string;
  expires: string;
  senderName: string;
  areaDesc: string;
};

export type LogEntry = {
  level: string;
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

export type ExportFormat = "json" | "csv";
export type DataCategory = "contacts" | "servers" | "oncall" | "groups" | "all";

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

export type MigrationResult = {
  success: boolean;
  contacts: { migrated: number; errors: string[] };
  servers: { migrated: number; errors: string[] };
  oncall: { migrated: number; errors: string[] };
  backupPath?: string;
};

export type DataStats = {
  contacts: { count: number; lastUpdated: number };
  servers: { count: number; lastUpdated: number };
  oncall: { count: number; lastUpdated: number };
  groups: { count: number; lastUpdated: number };
  hasCsvFiles: boolean;
};
