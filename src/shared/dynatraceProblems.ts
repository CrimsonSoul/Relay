export const DYNATRACE_PROBLEMS_COLLECTION = 'dynatrace_problems';
export const DYNATRACE_PROBLEM_STATES_COLLECTION = 'dynatrace_problem_states';
export const DYNATRACE_PROBLEM_NOTES_COLLECTION = 'dynatrace_problem_notes';
export const DYNATRACE_PROBLEM_SYNC_COLLECTION = 'dynatrace_problem_sync';
export const DYNATRACE_PROBLEM_SYNC_KEY = 'primary';
export const DYNATRACE_PROBLEM_HISTORY_RETENTION_DAYS = 365;
/** One analyst in the Analyst select. `email` is empty only on the built-in fallback list. */
export type DynatraceNocAnalyst = { email: string; name: string };

/** Fallback analysts, used only until the shared Dynatrace roster has been read once. */
export const DYNATRACE_PROBLEM_RESOLVERS: readonly DynatraceNocAnalyst[] = [
  'Paris',
  'Tristan',
  'Connor',
  'Weston',
  'Vlad',
  'Ryan',
].map((name) => ({ email: '', name }));
export const MAX_DYNATRACE_PROBLEM_RESOLVERS = 500;
export const MAX_DYNATRACE_PROBLEM_RESOLVER_LENGTH = 254;

/** The value the select stores and remembers: the email, or the name on the fallback list. */
export function dynatraceAnalystKey(analyst: DynatraceNocAnalyst): string {
  return analyst.email || analyst.name;
}

/** A well-formed analyst key or name; list membership is enforced by the resolver select. */
export function isDynatraceProblemResolver(value: string): boolean {
  const name = value.trim();
  return (
    name.length > 0 &&
    name === value &&
    name.length <= MAX_DYNATRACE_PROBLEM_RESOLVER_LENGTH &&
    !hasUnsafeControlCharacter(name) &&
    !/[\r\n\t]/.test(name)
  );
}

/** The synced Dynatrace roster, or the fallback list before the first roster read. */
export function getDynatraceProblemResolvers(
  sync: Pick<DynatraceProblemSyncRecord, 'nocAnalysts'> | null | undefined,
): readonly DynatraceNocAnalyst[] {
  const analysts = normalizeDynatraceNocAnalysts(sync?.nocAnalysts);
  return analysts.length ? analysts : DYNATRACE_PROBLEM_RESOLVERS;
}

export function normalizeDynatraceNocAnalysts(value: unknown): DynatraceNocAnalyst[] {
  if (!Array.isArray(value)) return [];
  const byEmail = new Map<string, DynatraceNocAnalyst>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { email, name } = entry as Record<string, unknown>;
    if (typeof email !== 'string' || typeof name !== 'string') continue;
    const analyst = { email: email.trim().toLowerCase(), name: name.trim() };
    if (
      !/^[^\s@]+@[^\s@]+$/.test(analyst.email) ||
      !isDynatraceProblemResolver(analyst.email) ||
      !isDynatraceProblemResolver(analyst.name)
    )
      continue;
    byEmail.set(analyst.email, analyst);
  }
  return [...byEmail.values()]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .slice(0, MAX_DYNATRACE_PROBLEM_RESOLVERS);
}

/** Bizevent contract shared with Infra Health (RELAY-SYNC / NOC-NOTES-SPEC). Grail is the master. */
export const DYNATRACE_NOC_NOTE_EVENT_TYPE = 'noc.note';
export const DYNATRACE_NOC_ACK_EVENT_TYPE = 'noc.ack';
export const DYNATRACE_NOC_EVENT_PROVIDER = 'cwgs.relay';
export const DYNATRACE_NOC_SOURCE = 'relay';
export const DYNATRACE_NOC_ANALYSTS_LOOKUP_PATH = '/lookups/noc_analysts';
export const MAX_DYNATRACE_NOC_NOTE_LENGTH = 4_000;

export type DynatraceNocNoteState = 'active' | 'deleted';
export type DynatraceNocAckState = 'addressed' | 'cleared';
/** Empty on rows written before the shared sync, which stay local and are never sent. */
export type DynatraceNocSyncStatus = 'pending' | 'synced' | 'error' | '';

const NOC_SOURCE_LABELS: Record<string, string> = {
  infra: 'Infra Health',
  relay: 'Relay',
  sdp: 'ServiceDesk',
  'outage-monitor': 'Outage monitor',
};

export function getDynatraceNocSourceLabel(source: string | undefined): string {
  return (source && NOC_SOURCE_LABELS[source]) || '';
}

const MAX_ENTERED_BY_PART_LENGTH = 64;

function enteredByPart(value: string | null | undefined): string {
  const cleaned = (value ?? '')
    .trim()
    .replace(/[^\w.\-$]/g, '_')
    .slice(0, MAX_ENTERED_BY_PART_LENGTH);
  return cleaned || 'unknown';
}

/** Identifies which workstation wrote a note or ack, since every install shares one OAuth client. */
export function buildRelayEnteredBy(
  user: string | null | undefined,
  host: string | null | undefined,
) {
  return `relay:${enteredByPart(user)}@${enteredByPart(host)}`;
}

/** Random v4 UUID; also works where `crypto.randomUUID` is unavailable (plain-HTTP Relay Web). */
export function createNocRecordId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Infra Health's ack-in-force rule, minus its row-status check: the newest ack is `addressed`
 * and every entity the problem now affects was in scope when it was acked.
 */
export function isDynatraceAckInForce(
  state: Pick<DynatraceProblemStateRecord, 'addressed' | 'scopeEntities'> | undefined,
  problem?: Pick<DynatraceProblemRecord, 'affectedEntities'>,
): boolean {
  if (state?.addressed !== true) return false;
  const scope = state.scopeEntities;
  if (!problem || !Array.isArray(scope) || scope.length === 0) return true;
  const inScope = new Set(scope);
  return problem.affectedEntities.every((entity) => inScope.has(entity.id));
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
  /** Raw name from the latest DAVIS_PROBLEM event matching NOC workflow scope; fallback, not the rendered email subject. */
  workflowTitle?: string;
  /** Exact rendered email subject read from an existing NOC workflow execution, never a local naming rule. */
  notificationTitle?: string;
  notificationStatus?: DynatraceProblemStatus;
  notificationUpdatedAt?: number;
  /** Bounded operator context from the matching workflow event. */
  workflowDescription?: string;
  /** Event tags used by the NOC workflow matcher. */
  workflowTags?: string[];
  /** Affected entity types observed on the matching workflow event. */
  workflowAffectedEntityTypes?: string[];
  /** Preserved locally but hidden from the active scope after an administrative scope change. */
  scopeExcluded?: boolean;
  /** Transition time used for the one-year grace period on excluded records. */
  scopeExcludedAt?: string;
  environmentUrl: string;
  syncedAt: string;
  created?: string;
  updated?: string;
};
export function getDynatraceProblemDisplayTitle(
  problem: Pick<DynatraceProblemRecord, 'title' | 'workflowTitle'> &
    Partial<Pick<DynatraceProblemRecord, 'status' | 'notificationTitle' | 'notificationStatus'>>,
): string {
  if (problem.status && problem.notificationStatus === problem.status) {
    const subject = problem.notificationTitle?.trim().replace(/^(?:[🟥🟩]\uFE0F?\s*)+/u, '');
    if (subject) return subject;
  }
  return problem.workflowTitle?.trim() || problem.title;
}

export type DynatraceProblemStateRecord = {
  id: string;
  problemId: string;
  addressed: boolean;
  addressedAt?: string;
  operatorId?: string;
  addressedBy?: string;
  /** Newest `noc.ack` for this problem. `addressed` mirrors `ackState` for older clients. */
  ackId?: string;
  ackState?: DynatraceNocAckState;
  /** Lowercased analyst email; `addressedBy` holds the analyst name. */
  analyst?: string;
  enteredBy?: string;
  source?: string;
  noteId?: string;
  /** Affected entity IDs at ack time; a new entity outside them lapses the ack. */
  scopeEntities?: string[];
  grailTs?: string;
  sync?: DynatraceNocSyncStatus;
  syncError?: string;
  created?: string;
  updated?: string;
};

export type DynatraceProblemNoteRecord = {
  id: string;
  problemId: string;
  note: string;
  operatorId?: string;
  author?: string;
  /** `note_id`, shared by every problem the note names and kept across edits. */
  noteId?: string;
  displayIds?: string[];
  /** Lowercased analyst email; `author` holds the analyst name. */
  analyst?: string;
  enteredBy?: string;
  source?: string;
  state?: DynatraceNocNoteState;
  /** Grail ingest time; the newest record per note wins. */
  grailTs?: string;
  sync?: DynatraceNocSyncStatus;
  syncError?: string;
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
  /** Active analysts from the Grail roster lookup. */
  nocAnalysts?: DynatraceNocAnalyst[];
  /** Largest Grail timestamp imported; the next read starts five minutes before it. */
  nocCursor?: string;
  nocSyncedAt?: string;
  nocSyncError?: string;
  /** Notes and acks still waiting to reach Dynatrace. */
  nocPendingCount?: number;
  created?: string;
  updated?: string;
};

export type DynatraceProblemsPublicSettings = {
  configured: boolean;
  environmentUrl: string;
  profileFilterConfigured: boolean;
  selectedAlertingProfiles: string[];
};

export type DynatraceOAuthCredentials = {
  clientId: string;
  clientSecret: string;
  accountUuid: string;
};

/** Read-only scopes requested by Relay's server-side OAuth client. */
export const DYNATRACE_OAUTH_SCOPES = [
  'environment-api:problems:read',
  'storage:events:read',
  'storage:buckets:read',
  'storage:bizevents:read',
  'automation:workflows:read',
] as const;

/** Extra scopes for shared NOC notes: sending bizevents and reading the analyst lookup. */
export const DYNATRACE_NOC_OAUTH_SCOPES = [
  ...DYNATRACE_OAUTH_SCOPES,
  'storage:events:write',
  'storage:files:read',
] as const;

export function normalizeDynatraceOAuthCredentials(
  value: unknown,
): DynatraceOAuthCredentials | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).length !== 3) return null;
  const { clientId, clientSecret, accountUuid } = fields;
  if (
    typeof clientId !== 'string' ||
    !/^[\w.-]{1,256}$/.test(clientId.trim()) ||
    typeof clientSecret !== 'string' ||
    !clientSecret.trim() ||
    clientSecret.length > 4096 ||
    /\s/.test(clientSecret.trim()) ||
    typeof accountUuid !== 'string' ||
    !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(accountUuid.trim())
  )
    return null;
  return {
    clientId: clientId.trim(),
    clientSecret: clientSecret.trim(),
    accountUuid: accountUuid.trim().toLowerCase(),
  };
}

export type DynatraceProblemsSettingsInput = {
  environmentUrl: string;
  /** Omit both credential fields, or leave apiToken blank, to preserve current authentication. */
  apiToken?: string;
  oauth?: DynatraceOAuthCredentials;
};

export type DynatraceProblemsTestResult = {
  reachable: boolean;
  problemCount: number;
};

export type DynatraceProblemScopeInput = {
  alertingProfiles: string[];
  customDqlMatcher: string;
  /** Editor preferences only; never an additional active scope filter. */
  rememberedAlertingProfiles?: string[];
  /** Standard workflow whose trigger covers the live DQL scope. Protected administration only. */
  workflowId?: string;
  /** Undefined keeps manual DQL; empty discovers a single suitable task. */
  workflowDqlTask?: string | null;
};

export function getDynatraceWorkflowIdError(value: unknown): string | null {
  return typeof value === 'string' && (value === '' || /^[A-Za-z0-9_-]{1,128}$/.test(value))
    ? null
    : 'Enter a valid Dynatrace workflow ID (not its URL).';
}

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
  if (
    /\[\s*(?:fetch|data|timeseries|smartscapeNodes|smartscapeEdges|describe)\b/i.test(
      scanned.unquoted,
    )
  ) {
    return 'Use a per-event filter expression without subqueries.';
  }
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

export function validWorkflowDqlTask(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === 'string' && /^[A-Za-z0-9_-]{0,100}$/.test(value));
}

export function workflowDqlSelection<T extends string | null | undefined>(
  task: T,
): { workflowDqlTask?: T } {
  return task === undefined ? {} : { workflowDqlTask: task };
}
