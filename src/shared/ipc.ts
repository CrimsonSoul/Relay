import type { DynatraceDashboardInput, DynatraceDashboardState } from './dynatrace';
import type {
  DynatraceProblemsPublicSettings,
  DynatraceProblemsSettingsInput,
  DynatraceProblemsTestResult,
} from './dynatraceProblems';
import type { PrivilegedPairingChallengeView, PrivilegedSessionView } from './privilegedAccess';
import type { EffectivePrivilegedRole, StoredRoleAccountRole } from './roleAccounts';
import type {
  PrivilegedCommandResult,
  PrivilegedCommandPayloadMap,
  PublicPrivilegedCommandName,
} from './privilegedCommands';
import type {
  KnowledgeIndexStatus,
  KnowledgeCoverRequest,
  KnowledgeCoverResult,
  KnowledgeOpenWebLinkResult,
  KnowledgePdfDownloadRequest,
  KnowledgePdfDownloadResult,
  KnowledgePdfRequest,
  KnowledgePdfResult,
  KnowledgeUploadQueueView,
  KnowledgeUploadSelectionResult,
} from './knowledge';
import type { KnowledgeSearchRequest, KnowledgeSearchResponse } from './knowledgeSearch';
import type { OfflineWritableCollection } from './offlineCollections';
import type { RelayRuntimeDescriptor } from './runtime';
import type { RelayReleaseNotes, RelayUpdateCheck, RelayUpdateSnapshot } from './releases';
import type {
  RelayRecoveryRepairInput,
  RelayRecoveryRollbackInput,
  RelayRecoveryState,
} from './recovery';
import type { WorkstationAwakeState } from './workstationAwake';

export {
  OFFLINE_WRITABLE_COLLECTIONS,
  isOfflineWritableCollection,
  type OfflineWritableCollection,
} from './offlineCollections';

export type CachedQueryMembership = {
  recordIds: string[];
  totalItems: number;
  complete: boolean;
};

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
  teamId: string;
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

export type PrivilegedIpcError =
  | 'invalid-input'
  | 'invalid-credentials'
  | 'unauthorized'
  | 'locked'
  | 'offline'
  | 'pairing-required'
  | 'conflict'
  | 'rate-limited'
  | 'approval-required'
  | 'server-error';

export type PrivilegedApprovalOperation = 'initial-owner-credential' | 'credential-recovery';
export type PrivilegedApprovalRequestView = {
  requestId: string;
  operation: PrivilegedApprovalOperation;
  sourceLabel: string;
  createdAt: string;
  expiresAt: string;
};
export type PrivilegedApprovalCodeView = {
  request: PrivilegedApprovalRequestView;
  code: string;
};

export type PrivilegedIpcResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: PrivilegedIpcError;
      approvalRequest?: PrivilegedApprovalRequestView;
    };

export type PrivilegedLoginInput = { username: string; password: string };
export type PrivilegedReauthenticationInput = { password: string };
export type PrivilegedInitialOwnerSetupInput = {
  username: string;
  password: string;
  passwordConfirm: string;
  approvalRequestId?: string;
  approvalCode?: string;
};
export type PrivilegedCredentialSetupInput = {
  accountId: string;
  password: string;
  passwordConfirm: string;
  approvalRequestId?: string;
  approvalCode?: string;
};
export type PrivilegedCredentialSetupView = {
  accountId: string;
  username: string;
  displayName: string;
  storedRole: StoredRoleAccountRole;
  role: EffectivePrivilegedRole;
  credentialState: 'configured';
  credentialVersion: number;
};
export type PrivilegedReauthenticationProof = { proofId: string; expiresAt: string };
export type PrivilegedPairingChallengeTarget = {
  accountId: string;
  username: string;
  displayName: string;
  role: EffectivePrivilegedRole;
};
export type PrivilegedPairingCompletionInput = {
  challengeId: string;
  code: string;
  deviceLabel: string;
};
export type PrivilegedPairingCompletionView = {
  deviceId: string;
  fingerprint: string;
  pairedAt: string;
};
export type PublicPrivilegedCommandRequest<
  K extends PublicPrivilegedCommandName = PublicPrivilegedCommandName,
> = {
  command: K;
  payload: PrivilegedCommandPayloadMap[K];
  expectedRevision: number | null;
};

export type BackupEntry = {
  name: string;
  date: string;
  size: number;
};

export const TAB_NAMES = [
  'Compose',
  'Alerts',
  'Personnel',
  'Knowledge',
  'Status',
  'Problems',
  'Radar',
  'Settings',
] as const;

export type TabName = (typeof TAB_NAMES)[number];

// Cloud Status Types
export const LEGACY_CLOUD_STATUS_PROVIDER_ORDER = [
  'aws',
  'azure',
  'm365',
  'jira',
  'github',
  'cloudflare',
  'google',
  'anthropic',
  'openai',
  'salesforce',
] as const;

export const MIST_CLOUD_STATUS_PROVIDER_ORDER = [
  'mist_global',
  'mist_emea',
  'mist_apac',
  'mist_federal',
] as const;

export const EXTENSION_CLOUD_STATUS_PROVIDER_ORDER = [
  'dynatrace',
  'proofpoint',
  'crowdstrike',
  'dropbox',
  'equinix',
] as const;

export const CLOUD_STATUS_PROVIDER_ORDER = [
  'aws',
  'azure',
  'm365',
  'dropbox',
  'proofpoint',
  'crowdstrike',
  'jira',
  'github',
  'cloudflare',
  'equinix',
  ...MIST_CLOUD_STATUS_PROVIDER_ORDER,
  'dynatrace',
  'google',
  'anthropic',
  'openai',
  'salesforce',
] as const;

export type LegacyCloudStatusProvider = (typeof LEGACY_CLOUD_STATUS_PROVIDER_ORDER)[number];
export type MistCloudStatusProvider = (typeof MIST_CLOUD_STATUS_PROVIDER_ORDER)[number];
export type ExtensionCloudStatusProvider = (typeof EXTENSION_CLOUD_STATUS_PROVIDER_ORDER)[number];
export type CloudStatusProvider = (typeof CLOUD_STATUS_PROVIDER_ORDER)[number];

export type CloudStatusSeverity = 'info' | 'warning' | 'error' | 'resolved';

export type CloudStatusItem<P extends CloudStatusProvider = CloudStatusProvider> = {
  id: string;
  provider: P;
  title: string;
  description: string;
  pubDate: string;
  link: string;
  severity: CloudStatusSeverity;
  affectedScopes?: string[];
};

export type CloudStatusPartition<P extends CloudStatusProvider> = {
  providers: { [K in P]: CloudStatusItem<K>[] };
  lastUpdated: number;
  errors: { provider: P; message: string }[];
};

export type LegacyCloudStatusData = CloudStatusPartition<LegacyCloudStatusProvider>;
export type MistCloudStatusData = CloudStatusPartition<MistCloudStatusProvider>;
export type ExtensionCloudStatusData = CloudStatusPartition<ExtensionCloudStatusProvider>;
export type CloudStatusData = CloudStatusPartition<CloudStatusProvider>;

type CloudStatusSnapshotMetadata = {
  id: string;
  key: 'current';
  contentHash: string;
  created: string;
  updated: string;
};

export type LegacyCloudStatusSnapshotRecord = LegacyCloudStatusData & CloudStatusSnapshotMetadata;
export type MistCloudStatusSnapshotRecord = MistCloudStatusData & CloudStatusSnapshotMetadata;
export type ExtensionCloudStatusSnapshotRecord = ExtensionCloudStatusData &
  CloudStatusSnapshotMetadata;

export type CloudStatusSnapshotRecord = CloudStatusData & CloudStatusSnapshotMetadata;

// Dispatcher Radar Types

/**
 * The Radar page paints one `<td class="<color> statusBar">` as its overall
 * signal, and reuses the same colour classes per row. `unknown` covers a cell
 * that parsed but carried no recognised colour.
 */
export type RadarStatusColor = 'green' | 'yellow' | 'red' | 'magenta' | 'unknown';

/**
 * Every tone is paired with a word wherever it is rendered, so the state never
 * depends on telling the swatch colours apart. Lives beside the type so the
 * sidebar can label the status without pulling in the lazy Radar tab chunk.
 */
export const RADAR_STATUS_LABELS: Record<RadarStatusColor, string> = {
  green: 'Healthy',
  yellow: 'Warning',
  red: 'Critical',
  magenta: 'Attention',
  unknown: 'Unknown',
};

/** A queue or message-type row: a name and its depth. */
export type RadarRow = {
  name: string;
  depth: number;
};

export type RadarDispatcher = {
  name: string;
  tone: RadarStatusColor;
  lastScheduleDate: string;
  lastPubSubDate: string;
  queues: RadarRow[];
};

/**
 * A single-line figure from the board, e.g. `Cardservices Requests (Last Hour)`.
 * `value` is null for rows that carry only a colour, such as the EDW daily load
 * status.
 */
export type RadarMetric = {
  label: string;
  value: string | null;
  tone: RadarStatusColor;
};

export type RadarXCenterCounts = {
  ok: number | null;
  pending: number | null;
};

/** Everything Relay reconstructs from one fetch of the dashboard. */
export type RadarBoard = {
  color: RadarStatusColor;
  dispatchers: RadarDispatcher[];
  papa: RadarRow[];
  metrics: RadarMetric[];
  xcenter: RadarXCenterCounts;
  currentTime: string | null;
};

export type RadarSnapshot = RadarBoard & {
  /** Epoch ms of the last successful parse; 0 before the first one lands. */
  lastUpdated: number;
  /**
   * Set when the poller reached the dashboard but got the SSO form back. The
   * renderer offers a sign-in window instead of showing a stale board as live.
   */
  signInRequired: boolean;
  /** Human-readable reason the most recent refresh failed, if it did. */
  error: string | null;
};

export const CLOUD_STATUS_PROVIDERS: Record<
  CloudStatusProvider,
  {
    label: string;
    shortLabel?: string;
    statusUrl: string;
    statusSourceLabel?: string;
    officialSupportUrl?: string;
    twitterHandle?: string;
    downdetectorSlug?: string;
  }
> = {
  aws: {
    label: 'AWS',
    statusUrl: 'https://status.aws.amazon.com/',
    twitterHandle: 'AWSCloud',
    downdetectorSlug: 'aws-amazon-web-services',
  },
  azure: {
    label: 'Azure',
    statusUrl: 'https://status.azure.com/',
    twitterHandle: 'AzureSupport',
    downdetectorSlug: 'windows-azure',
  },
  m365: {
    label: 'Microsoft 365',
    shortLabel: 'M365',
    statusUrl: 'https://status.cloud.microsoft',
    twitterHandle: 'MSFT365Status',
    downdetectorSlug: 'microsoft-365',
  },
  dropbox: {
    label: 'Dropbox',
    statusUrl: 'https://status.dropbox.com/',
  },
  proofpoint: {
    label: 'Proofpoint',
    statusUrl: 'https://proofpoint.my.site.com/community/s/proofpoint-current-incidents',
  },
  crowdstrike: {
    label: 'CrowdStrike',
    statusUrl: 'https://statusgator.com/services/crowdstrike',
    statusSourceLabel: 'StatusGator',
    officialSupportUrl: 'https://supportportal.crowdstrike.com/s/get-help',
    downdetectorSlug: 'crowdstrike',
  },
  jira: {
    label: 'Jira',
    statusUrl: 'https://jira-software.status.atlassian.com/',
    twitterHandle: 'Atlassian',
    downdetectorSlug: 'jira',
  },
  github: {
    label: 'GitHub',
    statusUrl: 'https://www.githubstatus.com/',
    twitterHandle: 'githubstatus',
    downdetectorSlug: 'github',
  },
  cloudflare: {
    label: 'Cloudflare',
    statusUrl: 'https://www.cloudflarestatus.com/',
    twitterHandle: 'CloudflareHelp',
    downdetectorSlug: 'cloudflare',
  },
  equinix: {
    label: 'Equinix',
    statusUrl: 'https://equinixproductstatus.statuspage.io/',
  },
  mist_global: {
    label: 'Juniper Mist Global',
    statusUrl: 'https://status.mist.com/',
  },
  mist_emea: {
    label: 'Juniper Mist EMEA',
    statusUrl: 'https://status.mist.com/',
  },
  mist_apac: {
    label: 'Juniper Mist APAC',
    statusUrl: 'https://status.mist.com/',
  },
  mist_federal: {
    label: 'Juniper Mist Federal',
    statusUrl: 'https://status.mist.com/',
  },
  dynatrace: {
    label: 'Dynatrace',
    statusUrl: 'https://dynatrace.status.io/',
  },
  google: {
    label: 'Google Cloud',
    shortLabel: 'Google',
    statusUrl: 'https://status.cloud.google.com/',
    twitterHandle: 'googlecloud',
    downdetectorSlug: 'google-cloud',
  },
  anthropic: {
    label: 'Claude',
    statusUrl: 'https://status.anthropic.com/',
    downdetectorSlug: 'claude-ai',
  },
  openai: {
    label: 'ChatGPT',
    statusUrl: 'https://status.openai.com/',
    twitterHandle: 'OpenAIDevs',
    downdetectorSlug: 'chatgpt',
  },
  salesforce: {
    label: 'Salesforce',
    shortLabel: 'SFDC',
    statusUrl: 'https://status.salesforce.com/',
    downdetectorSlug: 'salesforce',
  },
};

export function downdetectorUrl(slug: string): string {
  return `https://downdetector.com/status/${slug}/`;
}

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

export type PbAuthSession = {
  token: string;
  record: Record<string, unknown> | null;
};

export type PbConnection = {
  pbUrl: string;
  auth: PbAuthSession;
};

export type PbConnectionResult =
  | { ok: true; connection: PbConnection }
  | {
      ok: false;
      error: 'pb-unavailable';
      offlineAvailable: true;
      pbUrl: string;
      lastSyncAt: number;
    }
  | {
      ok: false;
      error: 'not-configured' | 'invalid-config' | 'auth-failed' | 'pb-unavailable';
      offlineAvailable?: false;
    };

export type SetupTestConnectionResult =
  { ok: true } | { ok: false; error: 'invalid-url' | 'unreachable' | 'auth-failed' };

export type DiscoveredRelayServer = { name: string; host: string; port: number; url: string };

export type ServerWebConfig = {
  enabled: boolean;
  port: number;
};

export type RelayWebServerPublicState = {
  enabled: boolean;
  status: 'disabled' | 'starting' | 'available' | 'conflict' | 'failed';
  port: number;
  url?: string;
  error?: 'port-conflict' | 'startup-failed' | 'unavailable';
};

export type PublicRelayConfig =
  | {
      mode: 'server';
      port: number;
      bindHost?: '127.0.0.1' | '0.0.0.0';
      lanIp?: string;
      web?: ServerWebConfig;
    }
  | { mode: 'client'; serverUrl: string; allowInsecureHttp?: boolean };

/**
 * Detailed outcome of a setup save. Pointing Relay at a different server voids
 * the offline queue, so the handler may report how many unsynced mutations that
 * cost the operator. Older handlers answer with a bare boolean; see
 * {@link readSaveConfigResult} for the normalizer both shapes flow through.
 */
export type SaveRelayConfigResult = {
  ok: boolean;
  discardedPendingCount?: number;
};

export function readSaveConfigResult(
  result: boolean | SaveRelayConfigResult,
): Required<SaveRelayConfigResult> {
  if (typeof result === 'boolean') return { ok: result, discardedPendingCount: 0 };
  return { ok: result.ok, discardedPendingCount: result.discardedPendingCount ?? 0 };
}

export type OfflineMutationInput = {
  collection: OfflineWritableCollection;
  action: 'create' | 'update' | 'delete';
  recordId?: string;
  data?: Record<string, unknown>;
};

export type OfflineMutationApplied = {
  mutationId: string;
  collection: OfflineWritableCollection;
  action: 'create' | 'update' | 'delete';
  record: Record<string, unknown> & { id: string };
  pendingCount: number;
};

export type OfflineMutationResult =
  ({ ok: true } & OfflineMutationApplied) | { ok: false; error: string };

export type PendingSyncStatus = {
  pendingCount: number;
  issueCount?: number;
  lastError?: string;
};

export type PendingMutationOverlay = {
  collection: OfflineWritableCollection;
  action: 'create' | 'update' | 'delete';
  record: Record<string, unknown> & { id: string };
};

export type StartupPhase = 'launching' | 'preparing-data' | 'ready' | 'failed';

export type StartupSnapshot = {
  generation: number;
  sequence: number;
  phase: StartupPhase;
  message: string;
  recoveryMode?: 'probation';
  launchIntent?: 'recovery';
};

export type BridgeAPI = {
  /** Identifies the active transport and its explicit UI capabilities. */
  readonly runtime: RelayRuntimeDescriptor;
  /** Desktop-only startup coordination. Web implementations intentionally omit these methods. */
  getStartupState?: () => Promise<StartupSnapshot>;
  onStartupStateChanged?: (callback: (snapshot: StartupSnapshot) => void) => () => void;
  markStartupRendererMounted?: () => void;
  /** Desktop-only packaged application version and GitHub release discovery. */
  getAppVersion?: () => Promise<string | null>;
  checkForUpdates?: () => Promise<IpcResult<RelayUpdateCheck>>;
  getCachedReleaseNotes?: () => Promise<RelayReleaseNotes[]>;
  refreshReleaseNotes?: () => Promise<IpcResult<RelayReleaseNotes[]>>;
  getUpdateState?: () => Promise<RelayUpdateSnapshot | null>;
  downloadUpdate?: () => Promise<IpcResult<RelayUpdateSnapshot>>;
  cancelUpdateDownload?: () => Promise<IpcResult<RelayUpdateSnapshot>>;
  revealUpdateInstaller?: () => Promise<IpcResult<RelayUpdateSnapshot>>;
  getRecoveryState?: () => Promise<RelayRecoveryState>;
  rollbackToRecoveryBuild?: (input: RelayRecoveryRollbackInput) => Promise<IpcResult<boolean>>;
  repairRecoveryBuild?: (input: RelayRecoveryRepairInput) => Promise<IpcResult<boolean>>;
  onUpdateStateChanged?: (callback: (snapshot: RelayUpdateSnapshot) => void) => () => void;
  openReleasesPage?: (version?: string) => Promise<boolean>;
  /** Resolves true when the URL was opened; false when blocked, invalid, or no handler exists. */
  openExternal: (url: string) => Promise<boolean>;
  /** Opens an operator-selected HTTPS ticket link through the narrower Service Desk capability. */
  openServiceDeskUrl: (url: string) => Promise<boolean>;
  onAuthRequested: (callback: (request: AuthRequest) => void) => () => void;
  submitAuth: (
    nonce: string,
    username: string,
    password: string,
    remember?: boolean,
  ) => Promise<boolean>;
  cancelAuth: (nonce: string) => void;
  useCachedAuth: (nonce: string) => Promise<boolean>;
  logBridge: (groups: string[]) => void;
  getCloudStatus: () => Promise<CloudStatusData>;
  // Dispatcher Radar
  getRadarSnapshot: () => Promise<RadarSnapshot>;
  refreshRadar: () => Promise<RadarSnapshot>;
  openRadarSignIn: () => Promise<boolean>;
  onRadarSnapshot: (callback: (snapshot: RadarSnapshot) => void) => () => void;
  // Dynatrace dashboards
  listDynatraceDashboards: () => Promise<DynatraceDashboardState[]>;
  addDynatraceDashboard: (
    input: DynatraceDashboardInput,
  ) => Promise<IpcResult<DynatraceDashboardState>>;
  updateDynatraceDashboard: (
    id: string,
    input: DynatraceDashboardInput,
  ) => Promise<IpcResult<DynatraceDashboardState>>;
  removeDynatraceDashboard: (id: string) => Promise<IpcResult>;
  openDynatraceDashboard: (id: string) => Promise<boolean>;
  clearDynatraceSession: () => Promise<IpcResult>;
  onDynatraceDashboardsChanged: (
    callback: (dashboards: DynatraceDashboardState[]) => void,
  ) => () => void;
  // Dynatrace Problems — server configuration only; problem records flow through PocketBase.
  getDynatraceProblemsSettings: () => Promise<DynatraceProblemsPublicSettings>;
  saveDynatraceProblemsSettings: (
    input: DynatraceProblemsSettingsInput,
  ) => Promise<IpcResult<DynatraceProblemsPublicSettings>>;
  testDynatraceProblemsSettings: (
    input: DynatraceProblemsSettingsInput,
  ) => Promise<IpcResult<DynatraceProblemsTestResult>>;
  clearDynatraceProblemsSettings: () => Promise<IpcResult>;
  syncDynatraceProblems: () => Promise<IpcResult<{ count: number }>>;
  saveDynatraceProblemProfileFilter: (
    alertingProfiles: string[],
  ) => Promise<IpcResult<{ count: number }>>;
  // Privileged access — public session metadata only; secrets remain in main.
  getPrivilegedSession: () => Promise<PrivilegedSessionView>;
  loginPrivileged: (
    input: PrivilegedLoginInput,
  ) => Promise<PrivilegedIpcResult<PrivilegedSessionView>>;
  logoutPrivileged: () => Promise<PrivilegedSessionView>;
  reauthenticatePrivileged: (
    input: PrivilegedReauthenticationInput,
  ) => Promise<PrivilegedIpcResult<PrivilegedReauthenticationProof>>;
  createPrivilegedPairingChallenge: (
    targetAccountId: string,
  ) => Promise<PrivilegedIpcResult<PrivilegedPairingChallengeView>>;
  completePrivilegedPairing: (
    input: PrivilegedPairingCompletionInput,
  ) => Promise<PrivilegedIpcResult<PrivilegedPairingCompletionView>>;
  submitPrivilegedCommand: (
    input: PublicPrivilegedCommandRequest,
  ) => Promise<PrivilegedCommandResult>;
  setupInitialAdministratorCredential: (
    input: PrivilegedInitialOwnerSetupInput,
  ) => Promise<PrivilegedIpcResult<PrivilegedCredentialSetupView>>;
  setupPrivilegedCredential: (
    input: PrivilegedCredentialSetupInput,
  ) => Promise<PrivilegedIpcResult<PrivilegedCredentialSetupView>>;
  onPrivilegedSessionChanged: (callback: (view: PrivilegedSessionView) => void) => () => void;
  listWebApprovalRequests: () => Promise<PrivilegedApprovalRequestView[]>;
  generateWebApprovalCode: (
    requestId: string,
  ) => Promise<PrivilegedIpcResult<PrivilegedApprovalCodeView>>;
  cancelWebApprovalRequest: (requestId: string) => Promise<boolean>;
  onWebApprovalRequestsChanged: (
    callback: (requests: PrivilegedApprovalRequestView[]) => void,
  ) => () => void;
  windowMinimize: () => void;
  windowMaximize: () => void;
  windowClose: () => void;
  isMaximized: () => Promise<boolean>;
  onMaximizeChange: (callback: (maximized: boolean) => void) => () => void;
  onErrorNotification: (
    callback: (notification: { title: string; message: string }) => void,
  ) => () => void;
  onPbCrashed: (callback: (info: { error: string }) => void) => () => void;
  /** Windows desktop-only local workstation inactivity protection. */
  getWorkstationAwakeState?: () => Promise<WorkstationAwakeState>;
  setWorkstationAwakeEnabled?: (enabled: boolean) => Promise<IpcResult<WorkstationAwakeState>>;
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
  /** Losslessly prepares PNG data URLs for Outlook with 96-DPI metadata. */
  optimizeAlertImage: (dataUrl: string) => Promise<IpcResult<string>>;
  // Alerts
  playAlertSound: () => Promise<boolean>;
  selectReminderSound: () => Promise<IpcResult<string>>;
  saveAlertImage: (dataUrl: string, suggestedName: string) => Promise<IpcResult<string>>;
  selectAlertBodyImage: () => Promise<IpcResult<string>>;
  /** Writes an unsent alert EML draft to temp storage and opens it in Outlook. */
  saveAndOpenAlertDraft: (content: string) => Promise<boolean>;
  // Schedule Bridge (.ics)
  saveAndOpenIcs: (content: string) => Promise<boolean>;
  saveCompanyLogo: () => Promise<IpcResult<string>>;
  getCompanyLogo: () => Promise<string | null>;
  removeCompanyLogo: () => Promise<IpcResult>;
  saveFooterLogo: () => Promise<IpcResult<string>>;
  getFooterLogo: () => Promise<string | null>;
  removeFooterLogo: () => Promise<IpcResult>;
  // Setup
  getConfig: () => Promise<PublicRelayConfig | null>;
  getConnectionSecret: () => Promise<string | null>;
  getClientHostname: () => Promise<string | null>;
  saveConfig: (config: unknown) => Promise<boolean | SaveRelayConfigResult>;
  clearConfig: () => Promise<boolean>;
  isConfigured: () => Promise<boolean>;
  testConnection: (payload: {
    serverUrl: string;
    secret: string;
    allowInsecureHttp?: boolean;
  }) => Promise<SetupTestConnectionResult>;
  discoverServers: () => Promise<DiscoveredRelayServer[]>;
  // Relay Web — desktop server configuration only.
  getWebServerState: () => Promise<RelayWebServerPublicState>;
  saveWebServerConfig: (input: ServerWebConfig) => Promise<IpcResult<RelayWebServerPublicState>>;
  retryWebServer: () => Promise<IpcResult<RelayWebServerPublicState>>;
  // Cache (offline)
  cacheRead: (collection: string) => Promise<Record<string, unknown>[]>;
  cacheQueryRead: (collection: string, queryKey: string) => Promise<CachedQueryMembership | null>;
  cacheQuerySnapshot: (
    collection: string,
    queryKey: string,
    membership: CachedQueryMembership,
  ) => Promise<void>;
  cacheWrite: (collection: string, action: string, record: unknown) => Promise<void>;
  cacheSnapshot: (collection: string, signature: string, records: unknown[]) => Promise<void>;
  mutateOffline: (input: OfflineMutationInput) => Promise<OfflineMutationResult>;
  onOfflineMutationApplied: (callback: (event: OfflineMutationApplied) => void) => () => void;
  getPendingSyncStatus: () => Promise<PendingSyncStatus>;
  onPendingSyncStatusChanged: (callback: (status: PendingSyncStatus) => void) => () => void;
  // Knowledge Base — metadata flows through PocketBase; PDF bytes stay behind this narrow bridge.
  getKnowledgePdf: (request: KnowledgePdfRequest) => Promise<KnowledgePdfResult>;
  downloadKnowledgePdf: (
    request: KnowledgePdfDownloadRequest,
  ) => Promise<KnowledgePdfDownloadResult>;
  getKnowledgeCover: (request: KnowledgeCoverRequest) => Promise<KnowledgeCoverResult>;
  getKnowledgeIndexStatus: () => Promise<KnowledgeIndexStatus>;
  searchKnowledge: (request: KnowledgeSearchRequest) => Promise<KnowledgeSearchResponse>;
  cancelKnowledgeSearch: (requestId: string) => void;
  onKnowledgeIndexStatusChanged: (callback: (status: KnowledgeIndexStatus) => void) => () => void;
  openKnowledgeWebLink: (url: string) => Promise<KnowledgeOpenWebLinkResult>;
  selectAndQueueKnowledgePdfs: (
    replacementDocumentId?: string,
  ) => Promise<KnowledgeUploadSelectionResult>;
  getKnowledgeUploadQueue: () => Promise<KnowledgeUploadQueueView>;
  pauseKnowledgeUploadBatch: (batchId: string) => Promise<boolean>;
  resumeKnowledgeUploadBatch: (batchId: string) => Promise<boolean>;
  retryKnowledgeUpload: (uploadId: string) => Promise<boolean>;
  reselectKnowledgeUploadSource: (uploadId: string) => Promise<boolean>;
  cancelKnowledgeUpload: (uploadId: string) => Promise<boolean>;
  cancelKnowledgeUploadBatch: (batchId: string) => Promise<boolean>;
  onKnowledgeUploadQueueChanged: (
    callback: (queue: KnowledgeUploadQueueView) => void,
  ) => () => void;
  // Sync
  syncPending: () => Promise<{
    total: number;
    conflicts: number;
    errors: string[];
    remaining?: number;
    remainingChanges?: PendingMutationOverlay[];
  }>;
  // PocketBase
  getPbConnection: () => Promise<PbConnectionResult>;
  refreshPbConnection: () => Promise<PbConnectionResult>;
  startPocketBase: () => Promise<boolean>;
  relaunchApp: () => Promise<void>;
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

/** Email identity of the single PocketBase app user Relay authenticates as. */
export const RELAY_APP_USER_EMAIL = 'relay@relay.app';

/**
 * Hard cap for image data URLs crossing the IPC boundary. The main-process
 * clipboard/optimize/save handlers reject anything larger, so renderer capture
 * paths must stay under it (falling back to a smaller capture when needed).
 */
export const MAX_IMAGE_DATA_URL_LENGTH = 10 * 1024 * 1024;

export const IPC_CHANNELS = {
  STARTUP_GET_STATE: 'startup:getState',
  STARTUP_STATE_CHANGED: 'startup:stateChanged',
  STARTUP_RENDERER_MOUNTED: 'startup:rendererMounted',
  APP_GET_VERSION: 'app:getVersion',
  APP_CHECK_FOR_UPDATES: 'app:checkForUpdates',
  APP_RELEASE_NOTES_GET_CACHED: 'app:releaseNotesGetCached',
  APP_RELEASE_NOTES_REFRESH: 'app:releaseNotesRefresh',
  APP_UPDATE_GET_STATE: 'app:updateGetState',
  APP_UPDATE_DOWNLOAD: 'app:updateDownload',
  APP_UPDATE_CANCEL_DOWNLOAD: 'app:updateCancelDownload',
  APP_UPDATE_REVEAL_INSTALLER: 'app:updateRevealInstaller',
  APP_RECOVERY_GET_STATE: 'app:recoveryGetState',
  APP_RECOVERY_ROLLBACK: 'app:recoveryRollback',
  APP_RECOVERY_REPAIR: 'app:recoveryRepair',
  APP_UPDATE_STATE_CHANGED: 'app:updateStateChanged',
  APP_OPEN_RELEASES: 'app:openReleases',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:isMaximized',
  WINDOW_MAXIMIZE_CHANGE: 'window:maximizeChange',
  OPEN_EXTERNAL: 'shell:openExternal',
  OPEN_SERVICE_DESK_URL: 'shell:openServiceDeskUrl',
  AUTH_REQUESTED: 'auth:requested',
  AUTH_SUBMIT: 'auth:submit',
  AUTH_CANCEL: 'auth:cancel',
  AUTH_USE_CACHED: 'auth:useCached',
  LOG_BRIDGE: 'metrics:logBridge',
  GET_CLOUD_STATUS: 'cloudstatus:get',
  // Dispatcher Radar
  RADAR_GET_SNAPSHOT: 'radar:getSnapshot',
  RADAR_REFRESH: 'radar:refresh',
  RADAR_OPEN_SIGN_IN: 'radar:openSignIn',
  RADAR_SNAPSHOT_CHANGED: 'radar:snapshotChanged',
  LOG_TO_MAIN: 'logger:toMain',
  // Dynatrace dashboards
  DYNATRACE_LIST_DASHBOARDS: 'dynatrace:listDashboards',
  DYNATRACE_ADD_DASHBOARD: 'dynatrace:addDashboard',
  DYNATRACE_UPDATE_DASHBOARD: 'dynatrace:updateDashboard',
  DYNATRACE_REMOVE_DASHBOARD: 'dynatrace:removeDashboard',
  DYNATRACE_OPEN_DASHBOARD: 'dynatrace:openDashboard',
  DYNATRACE_CLEAR_SESSION: 'dynatrace:clearSession',
  DYNATRACE_DASHBOARDS_CHANGED: 'dynatrace:dashboardsChanged',
  DYNATRACE_PROBLEMS_GET_SETTINGS: 'dynatraceProblems:getSettings',
  DYNATRACE_PROBLEMS_SAVE_SETTINGS: 'dynatraceProblems:saveSettings',
  DYNATRACE_PROBLEMS_TEST_SETTINGS: 'dynatraceProblems:testSettings',
  DYNATRACE_PROBLEMS_CLEAR_SETTINGS: 'dynatraceProblems:clearSettings',
  DYNATRACE_PROBLEMS_SYNC: 'dynatraceProblems:sync',
  DYNATRACE_PROBLEMS_SAVE_PROFILE_FILTER: 'dynatraceProblems:saveProfileFilter',
  // Privileged access
  PRIVILEGED_GET_SESSION: 'privileged:getSession',
  PRIVILEGED_LOGIN: 'privileged:login',
  PRIVILEGED_LOGOUT: 'privileged:logout',
  PRIVILEGED_REAUTHENTICATE: 'privileged:reauthenticate',
  PRIVILEGED_CREATE_PAIRING_CHALLENGE: 'privileged:createPairingChallenge',
  PRIVILEGED_COMPLETE_PAIRING: 'privileged:completePairing',
  PRIVILEGED_SUBMIT_COMMAND: 'privileged:submitCommand',
  PRIVILEGED_SETUP_INITIAL_ADMIN: 'privileged:setupInitialAdministrator',
  PRIVILEGED_SETUP_CREDENTIAL: 'privileged:setupCredential',
  PRIVILEGED_SESSION_CHANGED: 'privileged:sessionChanged',
  PRIVILEGED_APPROVAL_LIST: 'privileged:approval:list',
  PRIVILEGED_APPROVAL_GENERATE: 'privileged:approval:generate',
  PRIVILEGED_APPROVAL_CANCEL: 'privileged:approval:cancel',
  PRIVILEGED_APPROVAL_CHANGED: 'privileged:approval:changed',
  // Clipboard
  CLIPBOARD_WRITE: 'clipboard:write',
  OPTIMIZE_ALERT_IMAGE: 'alert:optimizeImage',
  // Alerts
  ALERT_PLAY_SOUND: 'alert:playSound',
  ALERT_SELECT_REMINDER_SOUND: 'alert:selectReminderSound',
  SAVE_ALERT_IMAGE: 'alert:saveImage',
  SELECT_ALERT_BODY_IMAGE: 'alert:selectBodyImage',
  ALERT_DRAFT_SAVE_AND_OPEN: 'alert:saveAndOpenDraft',
  // Schedule Bridge (.ics)
  ICS_SAVE_AND_OPEN: 'ics:saveAndOpen',
  SAVE_COMPANY_LOGO: 'alert:saveCompanyLogo',
  GET_COMPANY_LOGO: 'alert:getCompanyLogo',
  REMOVE_COMPANY_LOGO: 'alert:removeCompanyLogo',
  SAVE_FOOTER_LOGO: 'alert:saveFooterLogo',
  GET_FOOTER_LOGO: 'alert:getFooterLogo',
  REMOVE_FOOTER_LOGO: 'alert:removeFooterLogo',
  // Drag Sync
  DRAG_STARTED: 'drag:started',
  DRAG_STOPPED: 'drag:stopped',
  // On-Call Alert Dismissal Sync
  ONCALL_ALERT_DISMISSED: 'oncall:alertDismissed',
  // Setup
  SETUP_GET_CONFIG: 'setup:getConfig',
  SETUP_GET_CONNECTION_CREDENTIAL: 'setup:getConnectionCredential',
  CLIENT_GET_HOSTNAME: 'client:getHostname',
  SETUP_SAVE_CONFIG: 'setup:saveConfig',
  SETUP_CLEAR_CONFIG: 'setup:clearConfig',
  SETUP_IS_CONFIGURED: 'setup:isConfigured',
  SETUP_TEST_CONNECTION: 'setup:testConnection',
  SETUP_DISCOVER_SERVERS: 'setup:discoverServers',
  // Relay Web server controls
  WEB_SERVER_GET_STATE: 'webServer:getState',
  WEB_SERVER_SAVE_CONFIG: 'webServer:saveConfig',
  WEB_SERVER_RETRY: 'webServer:retry',
  // Cache (offline mode)
  CACHE_READ: 'cache:read',
  CACHE_QUERY_READ: 'cache:queryRead',
  CACHE_QUERY_SNAPSHOT: 'cache:querySnapshot',
  CACHE_WRITE: 'cache:write',
  CACHE_SNAPSHOT: 'cache:snapshot',
  OFFLINE_MUTATE: 'offline:mutate',
  OFFLINE_MUTATION_APPLIED: 'offline:mutationApplied',
  OFFLINE_PENDING_STATUS: 'offline:pendingStatus',
  OFFLINE_PENDING_STATUS_CHANGED: 'offline:pendingStatusChanged',
  // Knowledge Base
  KNOWLEDGE_GET_PDF: 'knowledge:getPdf',
  KNOWLEDGE_DOWNLOAD_PDF: 'knowledge:downloadPdf',
  KNOWLEDGE_GET_COVER: 'knowledge:getCover',
  KNOWLEDGE_GET_INDEX_STATUS: 'knowledge:getIndexStatus',
  KNOWLEDGE_SEARCH: 'knowledge:search',
  KNOWLEDGE_SEARCH_CANCEL: 'knowledge:searchCancel',
  KNOWLEDGE_INDEX_STATUS_CHANGED: 'knowledge:indexStatusChanged',
  KNOWLEDGE_OPEN_WEB_LINK: 'knowledge:openWebLink',
  KNOWLEDGE_SELECT_AND_STAGE: 'knowledge:selectAndStage',
  KNOWLEDGE_UPLOAD_QUEUE_GET: 'knowledge:uploadQueue',
  KNOWLEDGE_UPLOAD_BATCH_PAUSE: 'knowledge:uploadBatchPause',
  KNOWLEDGE_UPLOAD_BATCH_RESUME: 'knowledge:uploadBatchResume',
  KNOWLEDGE_UPLOAD_RETRY: 'knowledge:uploadRetry',
  KNOWLEDGE_UPLOAD_RESELECT: 'knowledge:uploadReselect',
  KNOWLEDGE_UPLOAD_FILE_CANCEL: 'knowledge:uploadFileCancel',
  KNOWLEDGE_UPLOAD_BATCH_CANCEL: 'knowledge:uploadBatchCancel',
  KNOWLEDGE_UPLOAD_QUEUE_CHANGED: 'knowledge:uploadQueueChanged',
  // PocketBase
  PB_GET_CONNECTION: 'pb:getConnection',
  PB_REFRESH_CONNECTION: 'pb:refreshConnection',
  PB_START: 'pb:start',
  PB_CRASHED: 'pb:crashed',
  APP_ERROR_NOTIFICATION: 'app:error-notification',
  APP_RELAUNCH: 'app:relaunch',
  WORKSTATION_AWAKE_GET_STATE: 'workstationAwake:getState',
  WORKSTATION_AWAKE_SET_ENABLED: 'workstationAwake:setEnabled',
  // Backups
  BACKUP_LIST: 'backup:list',
  BACKUP_CREATE: 'backup:create',
  BACKUP_RESTORE: 'backup:restore',
  // Sync
  SYNC_PENDING: 'sync:pending',
} as const;

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

export type ImportProgress = {
  processed: number;
  total: number;
  imported: number;
  updated: number;
  errors: number;
};

export type DataStats = {
  contacts: { count: number; lastUpdated: number } | number;
  servers: { count: number; lastUpdated: number } | number;
  oncall: { count: number; lastUpdated: number } | number;
  groups: { count: number; lastUpdated: number } | number;
  [key: string]: unknown;
};
