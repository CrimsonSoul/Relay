export const DYNATRACE_PROBLEMS_COLLECTION = 'dynatrace_problems';
export const DYNATRACE_PROBLEM_STATES_COLLECTION = 'dynatrace_problem_states';
export const DYNATRACE_PROBLEM_NOTES_COLLECTION = 'dynatrace_problem_notes';
export const DYNATRACE_PROBLEM_SYNC_COLLECTION = 'dynatrace_problem_sync';
export const DYNATRACE_PROBLEM_SYNC_KEY = 'primary';
export const DYNATRACE_PROBLEM_HISTORY_RETENTION_DAYS = 365;
export const DYNATRACE_PROBLEM_RESOLVERS = [
  'Paris',
  'Tristan',
  'Connor',
  'Weston',
  'Vlad',
  'Ryan',
] as const;

export type DynatraceProblemResolver = (typeof DYNATRACE_PROBLEM_RESOLVERS)[number];

export function isDynatraceProblemResolver(value: string): value is DynatraceProblemResolver {
  return (DYNATRACE_PROBLEM_RESOLVERS as readonly string[]).includes(value);
}

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
  'APPLICATION' | 'ENVIRONMENT' | 'INFRASTRUCTURE' | 'SERVICES';

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
  /** Preserved locally but hidden from the active scope after an administrative scope change. */
  scopeExcluded?: boolean;
  /** Transition time used for the one-year grace period on excluded records. */
  scopeExcludedAt?: string;
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
  operatorId?: string;
  addressedBy?: string;
  created?: string;
  updated?: string;
};

export type DynatraceProblemNoteRecord = {
  id: string;
  problemId: string;
  note: string;
  operatorId?: string;
  author?: string;
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
  scopeSource?: 'unfiltered' | 'alerting-profile' | 'custom-dql' | 'combined';
  profileFieldHealthy?: boolean;
  profileCatalogCount?: number;
  matchedProfileCount?: number;
  consecutiveFailures?: number;
  nextRetryAt?: string;
  staleSince?: string;
  resultTruncated?: boolean;
  /** A full scope reconciliation failed and must be retried before incremental polling resumes. */
  reconciliationPending?: boolean;
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

export type DynatraceProblemScopeInput = {
  alertingProfiles: string[];
  customDqlMatcher: string;
};

export type DynatraceProblemScopeTestResult =
  { valid: true; problemCount: number } | { valid: false; error: string };

const MAX_DYNATRACE_URL_LENGTH = 2048;
const MAX_DYNATRACE_PROBLEM_ID_LENGTH = 512;
export const MAX_DYNATRACE_API_TOKEN_LENGTH = 4096;
export const MAX_DYNATRACE_ALERTING_PROFILES = 250;
export const MAX_DYNATRACE_ALERTING_PROFILE_LENGTH = 512;
export const MAX_DYNATRACE_CUSTOM_DQL_MATCHER_LENGTH = 16_000;

const DQL_PIPELINE_COMMAND_PATTERN =
  /^(?:fetch|filter|fields(?:add|remove|rename)?|sort|limit|dedup|summarize|append|join|lookup)\b/i;

function hasUnsafeControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 8 ||
        codePoint === 11 ||
        codePoint === 12 ||
        (codePoint >= 14 && codePoint <= 31) ||
        codePoint === 127)
    ) {
      return true;
    }
  }
  return false;
}

function isEscapedQuote(value: string, quoteIndex: number): boolean {
  let slashCount = 0;
  for (let index = quoteIndex - 1; index >= 0 && value[index] === '\\'; index -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function isDqlCommentStart(character: string, next: string): boolean {
  return (
    (character === '/' && (next === '/' || next === '*')) || (character === '*' && next === '/')
  );
}

function scanDynatraceCustomDqlMatcher(
  matcher: string,
): { valid: true; unquoted: string } | { valid: false; error: string } {
  let quoted = false;
  let unquoted = '';
  for (let index = 0; index < matcher.length; index += 1) {
    const character = matcher.charAt(index);
    if (character === '"' && !isEscapedQuote(matcher, index)) {
      quoted = !quoted;
      unquoted += ' ';
      continue;
    }
    if (quoted) {
      unquoted += ' ';
      continue;
    }
    if (isDqlCommentStart(character, matcher.charAt(index + 1))) {
      return { valid: false, error: 'Comments are not allowed in the custom DQL matcher.' };
    }
    if (character === '|' || character === ';') {
      return {
        valid: false,
        error: 'Enter only a DQL matcher expression, without fetch or pipeline commands.',
      };
    }
    unquoted += character;
  }
  return quoted
    ? { valid: false, error: 'Close every quoted string in the custom DQL matcher.' }
    : { valid: true, unquoted };
}

export function normalizeDynatraceCustomDqlMatcher(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

/**
 * Enforces Relay's expression-only boundary before a matcher can be embedded in a server-owned
 * Grail query. Dynatrace remains authoritative for the complete DQL grammar during the test query.
 */
export function getDynatraceCustomDqlMatcherError(value: string): string | null {
  const matcher = normalizeDynatraceCustomDqlMatcher(value);
  if (!matcher) return null;
  if (matcher.length > MAX_DYNATRACE_CUSTOM_DQL_MATCHER_LENGTH) {
    return `The custom DQL matcher is too long. Keep it under ${MAX_DYNATRACE_CUSTOM_DQL_MATCHER_LENGTH.toLocaleString()} characters.`;
  }
  if (hasUnsafeControlCharacter(matcher)) {
    return 'Remove control characters from the custom DQL matcher.';
  }
  if (DQL_PIPELINE_COMMAND_PATTERN.test(matcher)) {
    return 'Enter only a DQL matcher expression, without fetch or pipeline commands.';
  }

  const scanned = scanDynatraceCustomDqlMatcher(matcher);
  if (!scanned.valid) return scanned.error;
  return null;
}

export function normalizeDynatraceProblemScopeTestResult(
  value: unknown,
): DynatraceProblemScopeTestResult | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.valid === true) {
    return Number.isSafeInteger(record.problemCount) && (record.problemCount as number) >= 0
      ? { valid: true, problemCount: record.problemCount as number }
      : null;
  }
  if (record.valid === false) {
    return typeof record.error === 'string' && record.error.length > 0 && record.error.length <= 512
      ? { valid: false, error: record.error }
      : null;
  }
  return null;
}

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
