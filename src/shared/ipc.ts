/** Index signature is intentional: raw stores arbitrary provider-specific fields from upstream data sources. */
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

/** Index signature is intentional: raw stores arbitrary provider-specific fields from upstream data sources. */
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

export type IpcResult<T = void> = {
  success: boolean;
  data?: T;
  error?: string;
  rateLimited?: boolean;
};

export type BackupEntry = {
  name: string;
  date: string;
  size: number;
};

export type TabName =
  | 'Compose'
  | 'Alerts'
  | 'Personnel'
  | 'People'
  | 'Servers'
  | 'Radar'
  | 'Weather'
  | 'Notes'
  | 'Status';

// Cloud Status Types
export type CloudStatusProvider =
  | 'aws'
  | 'azure'
  | 'm365'
  | 'github'
  | 'cloudflare'
  | 'google'
  | 'anthropic'
  | 'openai'
  | 'salesforce';

export type CloudStatusSeverity = 'info' | 'warning' | 'error' | 'resolved';

export type CloudStatusItem = {
  id: string;
  provider: CloudStatusProvider;
  title: string;
  description: string;
  pubDate: string;
  link: string;
  severity: CloudStatusSeverity;
};

export type CloudStatusData = {
  providers: Record<CloudStatusProvider, CloudStatusItem[]>;
  lastUpdated: number;
  errors: { provider: CloudStatusProvider; message: string }[];
};

/** Display order for provider cards and filters. */
export const CLOUD_STATUS_PROVIDER_ORDER: CloudStatusProvider[] = [
  'aws',
  'azure',
  'm365',
  'github',
  'cloudflare',
  'google',
  'anthropic',
  'openai',
  'salesforce',
];

export const CLOUD_STATUS_PROVIDERS: Record<
  CloudStatusProvider,
  { label: string; shortLabel?: string; statusUrl: string; twitterHandle?: string }
> = {
  aws: {
    label: 'AWS',
    statusUrl: 'https://status.aws.amazon.com/',
    twitterHandle: 'AWSCloud',
  },
  azure: {
    label: 'Azure',
    statusUrl: 'https://status.azure.com/',
    twitterHandle: 'AzureSupport',
  },
  m365: {
    label: 'Microsoft 365',
    shortLabel: 'M365',
    statusUrl: 'https://status.cloud.microsoft',
    twitterHandle: 'MSFT365Status',
  },
  github: {
    label: 'GitHub',
    statusUrl: 'https://www.githubstatus.com/',
    twitterHandle: 'githubstatus',
  },
  cloudflare: {
    label: 'Cloudflare',
    statusUrl: 'https://www.cloudflarestatus.com/',
    twitterHandle: 'CloudflareHelp',
  },
  google: {
    label: 'Google Cloud',
    shortLabel: 'Google',
    statusUrl: 'https://status.cloud.google.com/',
    twitterHandle: 'googlecloud',
  },
  anthropic: {
    label: 'Claude',
    statusUrl: 'https://status.anthropic.com/',
  },
  openai: {
    label: 'ChatGPT',
    statusUrl: 'https://status.openai.com/',
    twitterHandle: 'OpenAIDevs',
  },
  salesforce: {
    label: 'Salesforce',
    shortLabel: 'SFDC',
    statusUrl: 'https://status.salesforce.com/',
  },
};

export type NoteColor = 'amber' | 'blue' | 'green' | 'red' | 'purple' | 'slate';

export type StandaloneNote = {
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  tags: string[];
  createdAt: number;
  updatedAt: number;
};

export type AppData = {
  groups: BridgeGroup[];
  contacts: Contact[];
  servers: Server[];
  onCall: OnCallRow[];
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
  /** Opens a file path. Path validation and sandboxing constraints are enforced on the main process side. */
  openPath: (path: string) => Promise<void>;
  openExternal: (url: string) => Promise<void>;
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
  getCloudStatus: () => Promise<CloudStatusData>;
  getWeather: (lat: number, lon: number) => Promise<WeatherData | null>;
  searchLocation: (query: string) => Promise<LocationSearchResult>;
  getWeatherAlerts: (lat: number, lon: number) => Promise<WeatherAlert[]>;
  registerRadarUrl: (url: string) => Promise<void>;
  windowMinimize: () => void;
  windowMaximize: () => void;
  windowClose: () => void;
  isMaximized: () => Promise<boolean>;
  onMaximizeChange: (callback: (maximized: boolean) => void) => () => void;
  openAuxWindow: (route: string) => void;
  getIpLocation: () => Promise<IpLocationResult>;
  logToMain: (entry: LogEntry) => void;
  // Drag and Drop Sync
  notifyDragStart: () => void;
  notifyDragStop: () => void;
  onDragStateChange: (callback: (isDragging: boolean) => void) => () => void;
  // On-Call Alert Dismissal Sync
  notifyAlertDismissed: (type: string) => void;
  onAlertDismissed: (callback: (type: string) => void) => () => void;
  // Clipboard
  writeClipboard: (text: string) => Promise<boolean>;
  /** Accepts PNG data URLs only. This is intentional: clipboard operations use PNG format. */
  writeClipboardImage: (dataUrl: string) => Promise<boolean>;
  // Alerts
  saveAlertImage: (dataUrl: string, suggestedName: string) => Promise<IpcResult<string>>;
  saveCompanyLogo: () => Promise<IpcResult<string>>;
  getCompanyLogo: () => Promise<string | null>;
  removeCompanyLogo: () => Promise<IpcResult>;
  // Setup
  getConfig: () => Promise<unknown>;
  saveConfig: (config: unknown) => Promise<boolean>;
  isConfigured: () => Promise<boolean>;
  // Cache (offline)
  cacheRead: (collection: string) => Promise<Record<string, unknown>[]>;
  cacheWrite: (collection: string, action: string, record: unknown) => Promise<void>;
  cacheSnapshot: (collection: string, records: unknown[]) => Promise<void>;
  // Sync
  syncPending: () => Promise<{ total: number; conflicts: number; errors: string[] }>;
  // PocketBase
  getPbUrl: () => Promise<string | null>;
  getPbSecret: () => Promise<string | null>;
  startPocketBase: () => Promise<boolean>;
  // Backups
  listBackups: () => Promise<BackupEntry[]>;
  createBackup: () => Promise<IpcResult<string>>;
  restoreBackup: (name: string) => Promise<IpcResult>;
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
  OPEN_PATH: 'fs:openPath',
  OPEN_EXTERNAL: 'shell:openExternal',
  AUTH_REQUESTED: 'auth:requested',
  AUTH_SUBMIT: 'auth:submit',
  AUTH_CANCEL: 'auth:cancel',
  AUTH_USE_CACHED: 'auth:useCached',
  RADAR_DATA: 'radar:data',
  REGISTER_RADAR_URL: 'config:registerRadarUrl',
  LOG_BRIDGE: 'metrics:logBridge',
  GET_CLOUD_STATUS: 'cloudstatus:get',
  GET_WEATHER: 'weather:get',
  SEARCH_LOCATION: 'weather:search',
  GET_WEATHER_ALERTS: 'weather:alerts',
  GET_IP_LOCATION: 'location:ip',
  LOG_TO_MAIN: 'logger:toMain',
  // Clipboard
  CLIPBOARD_WRITE: 'clipboard:write',
  CLIPBOARD_WRITE_IMAGE: 'clipboard:writeImage',
  // Alerts
  SAVE_ALERT_IMAGE: 'alert:saveImage',
  SAVE_COMPANY_LOGO: 'alert:saveCompanyLogo',
  GET_COMPANY_LOGO: 'alert:getCompanyLogo',
  REMOVE_COMPANY_LOGO: 'alert:removeCompanyLogo',
  // Drag Sync
  DRAG_STARTED: 'drag:started',
  DRAG_STOPPED: 'drag:stopped',
  // On-Call Alert Dismissal Sync
  ONCALL_ALERT_DISMISSED: 'oncall:alertDismissed',
  // Setup
  SETUP_GET_CONFIG: 'setup:getConfig',
  SETUP_SAVE_CONFIG: 'setup:saveConfig',
  SETUP_IS_CONFIGURED: 'setup:isConfigured',
  // Cache (offline mode)
  CACHE_READ: 'cache:read',
  CACHE_WRITE: 'cache:write',
  CACHE_SNAPSHOT: 'cache:snapshot',
  // PocketBase
  PB_GET_URL: 'pb:getUrl',
  PB_GET_SECRET: 'pb:getSecret',
  PB_START: 'pb:start',
  // Backups
  BACKUP_LIST: 'backup:list',
  BACKUP_CREATE: 'backup:create',
  BACKUP_RESTORE: 'backup:restore',
  // Sync
  SYNC_PENDING: 'sync:pending',
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
  timestamp?: string;
  errorContext?: import('./logging').ErrorContext;
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

// Alert History - log of past alert compositions
export type AlertHistoryEntry = {
  id: string;
  timestamp: number;
  severity: 'ISSUE' | 'MAINTENANCE' | 'INFO' | 'RESOLVED';
  subject: string;
  bodyHtml: string;
  sender: string;
  recipient: string;
  pinned?: boolean;
  label?: string;
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
// Record Types (with IDs and timestamps)
// ============================================

/** Contact record */
export type ContactRecord = {
  id: string;
  name: string;
  email: string;
  phone: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

/** Server record */
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

/** OnCall record */
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

export type ExportFormat = 'json' | 'csv' | 'excel';
export type DataCategory =
  | 'contacts'
  | 'servers'
  | 'oncall'
  | 'groups'
  | 'bridge_history'
  | 'alert_history'
  | 'notes'
  | 'saved_locations'
  | 'standalone_notes'
  | 'all';

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
  contacts: { count: number; lastUpdated: number } | number;
  servers: { count: number; lastUpdated: number } | number;
  oncall: { count: number; lastUpdated: number } | number;
  groups: { count: number; lastUpdated: number } | number;
  [key: string]: unknown;
};
