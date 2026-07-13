export const DYNATRACE_PROBLEMS_COLLECTION = 'dynatrace_problems';
export const DYNATRACE_PROBLEM_STATES_COLLECTION = 'dynatrace_problem_states';
export const DYNATRACE_PROBLEM_NOTES_COLLECTION = 'dynatrace_problem_notes';
export const DYNATRACE_PROBLEM_SYNC_COLLECTION = 'dynatrace_problem_sync';
export const DYNATRACE_PROBLEM_SYNC_KEY = 'primary';
export const DYNATRACE_PROBLEM_HISTORY_RETENTION_DAYS = 365;

export type DynatraceProblemStatus = 'OPEN' | 'CLOSED';

export type DynatraceProblemSeverity =
  | 'AVAILABILITY'
  | 'CUSTOM_ALERT'
  | 'ERROR'
  | 'INFO'
  | 'MONITORING_UNAVAILABLE'
  | 'PERFORMANCE'
  | 'RESOURCE_CONTENTION';

export type DynatraceProblemImpactLevel =
  | 'APPLICATION'
  | 'ENVIRONMENT'
  | 'INFRASTRUCTURE'
  | 'SERVICES';

export type DynatraceEntityRef = {
  id: string;
  type: string;
  name: string;
};

export type DynatraceManagementZone = {
  id: string;
  name: string;
};

export type DynatraceProblemRecord = {
  id: string;
  problemId: string;
  displayId: string;
  title: string;
  status: DynatraceProblemStatus;
  severity: DynatraceProblemSeverity;
  impactLevel: DynatraceProblemImpactLevel;
  startTime: number;
  endTime: number;
  rootCauseName: string;
  affectedEntities: DynatraceEntityRef[];
  impactedEntities: DynatraceEntityRef[];
  managementZones: DynatraceManagementZone[];
  alertingProfiles: string[];
  environmentUrl: string;
  syncedAt: string;
  created?: string;
  updated?: string;
};

export type DynatraceProblemStateRecord = {
  id: string;
  problemId: string;
  addressed: boolean;
  addressedAt?: string;
  addressedBy?: string;
  created?: string;
  updated?: string;
};

export type DynatraceProblemNoteRecord = {
  id: string;
  problemId: string;
  note: string;
  author: string;
  created: string;
  updated?: string;
};

export type DynatraceProblemSyncState = 'disabled' | 'syncing' | 'ok' | 'error';

export type DynatraceProblemSyncRecord = {
  id: string;
  key: typeof DYNATRACE_PROBLEM_SYNC_KEY;
  state: DynatraceProblemSyncState;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastReconciledAt?: string;
  error?: string;
  availableAlertingProfiles?: string[];
  selectedAlertingProfiles?: string[];
  profileFilterConfigured?: boolean;
  created?: string;
  updated?: string;
};

export type DynatraceProblemsPublicSettings = {
  configured: boolean;
  environmentUrl: string;
  profileFilterConfigured: boolean;
  selectedAlertingProfiles: string[];
};

export type DynatraceProblemsSettingsInput = {
  environmentUrl: string;
  /** Omit or leave blank to preserve the currently stored platform token. */
  apiToken?: string;
};

export type DynatraceProblemsTestResult = {
  reachable: boolean;
  problemCount: number;
};

const MAX_DYNATRACE_URL_LENGTH = 2048;
const MAX_DYNATRACE_PROBLEM_ID_LENGTH = 512;
export const MAX_DYNATRACE_API_TOKEN_LENGTH = 4096;
export const MAX_DYNATRACE_ALERTING_PROFILES = 250;
export const MAX_DYNATRACE_ALERTING_PROFILE_LENGTH = 512;

export function normalizeDynatraceEnvironmentUrl(value: string): string {
  try {
    const parsed = new URL(value.trim());
    if (getDynatraceEnvironmentUrlError(parsed.toString())) return '';
    const hostname = parsed.hostname
      .toLowerCase()
      .replace(/\.live\.dynatrace\.com$/, '.apps.dynatrace.com');
    const portSuffix = parsed.port ? `:${parsed.port}` : '';
    return `https://${hostname}${portSuffix}`;
  } catch {
    return '';
  }
}

export function buildDynatraceProblemUrl(environmentUrl: string, problemId: string): string | null {
  const id = problemId.trim();
  if (!id || id.length > MAX_DYNATRACE_PROBLEM_ID_LENGTH) return null;

  let source: URL;
  try {
    source = new URL(environmentUrl.trim());
  } catch {
    return null;
  }
  if (source.username || source.password) return null;

  const normalizedOrigin = normalizeDynatraceEnvironmentUrl(source.origin);
  if (!normalizedOrigin) return null;

  const url = new URL(normalizedOrigin);
  url.pathname = `/ui/apps/dynatrace.davis.problems/problem/${encodeURIComponent(id)}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function getDynatraceEnvironmentUrlError(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Enter the Dynatrace environment URL.';
  if (trimmed.length > MAX_DYNATRACE_URL_LENGTH) return 'The Dynatrace URL is too long.';

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return 'Enter a valid Dynatrace environment URL.';
  }

  if (parsed.protocol !== 'https:') return 'Dynatrace requires an HTTPS environment URL.';
  if (parsed.username || parsed.password) return 'Remove credentials from the Dynatrace URL.';
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    return 'Use the Dynatrace environment origin without a path, query, or fragment.';
  }

  const hostname = parsed.hostname.toLowerCase();
  const isAppsEnvironment =
    hostname.endsWith('.apps.dynatrace.com') && hostname !== 'apps.dynatrace.com';
  const isClassicEnvironment =
    hostname.endsWith('.live.dynatrace.com') && hostname !== 'live.dynatrace.com';
  if (!isAppsEnvironment && !isClassicEnvironment) {
    return 'Use a Dynatrace SaaS environment ending in .apps.dynatrace.com.';
  }

  return null;
}

export function getDynatraceApiTokenError(value: string): string | null {
  const token = value.trim();
  if (!token) return 'Enter a Dynatrace platform token.';
  if (token.length > MAX_DYNATRACE_API_TOKEN_LENGTH) {
    return 'The Dynatrace platform token is too long.';
  }
  if (/\s/.test(token)) return 'The Dynatrace platform token cannot contain whitespace.';
  return null;
}
