import { z } from 'zod';
import type {
  DynatraceEntityRef,
  DynatraceProblemImpactLevel,
  DynatraceProblemRecord,
  DynatraceProblemSeverity,
} from '@shared/dynatraceProblems';
import type { DynatraceProblemsConfig } from './DynatraceProblemsConfigStore';

const REQUEST_TIMEOUT_MS = 15_000;
const QUERY_WAIT_TIMEOUT_MS = 12_000;
const POLL_INTERVAL_MS = 250;
const MAX_PROBLEMS = 10_000;

export type DynatraceProblemsQueryScope =
  { mode: 'reconcile' } | { mode: 'incremental'; lookbackMinutes: number };

const DEFAULT_PROBLEMS_QUERY_SCOPE: Readonly<DynatraceProblemsQueryScope> = {
  mode: 'reconcile',
};

const PROBLEMS_QUERY_FIELDS = `| fields problemId=event.id,
    displayId=display_id,
    title=event.name,
    status=event.status,
    severity=event.category,
    impactLevel=dt.davis.impact_level,
    startTime=event.start,
    endTime=event.end,
    rootCause=root_cause.smartscape_entity,
    rootCauseEntityName=root_cause_entity_name,
    affectedEntities=smartscape.affected_entities,
    affectedEntityIds=affected_entity_ids,
    affectedEntityNames=affected_entity_names,
    affectedEntityTypes=affected_entity_types,
    relatedEntities=smartscape.related_entities,
    alertingProfiles=labels.alerting_profile
| sort startTime desc
| limit ${MAX_PROBLEMS}`;

const ALERTING_PROFILES_QUERY = `fetch dt.davis.problems, from:-365d
| dedup event.id, sort:{timestamp desc}
| filter not(dt.davis.is_duplicate)
| expand alertingProfile=labels.alerting_profile
| filter isNotNull(alertingProfile)
| summarize problemCount=countDistinct(event.id), by:{alertingProfile}
| fields alertingProfile
| sort alertingProfile asc`;

const CONNECTION_TEST_QUERY = `fetch dt.davis.problems, from:-2h
| filter not(dt.davis.is_duplicate)
| summarize problemCount=count()`;

const ALERTING_PROFILE_FIELD_HEALTH_QUERY = `fetch dt.davis.problems, from:-365d
| dedup event.id, sort:{timestamp desc}
| filter not(dt.davis.is_duplicate)
| summarize problemCount=count(), profiledProblemCount=countIf(isNotNull(labels.alerting_profile))`;

const entitySchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string().nullish(),
});

const timestampSchema = z.union([z.string(), z.number()]);
const stringListSchema = z.union([z.string(), z.array(z.string())]);

const problemSchema = z.object({
  problemId: z.string().min(1),
  displayId: z.string().nullish(),
  title: z.string().min(1),
  status: z.enum(['ACTIVE', 'CLOSED']),
  severity: z.string().nullish(),
  impactLevel: z.union([z.string(), z.array(z.string())]).nullish(),
  startTime: timestampSchema,
  endTime: timestampSchema.nullish(),
  rootCause: entitySchema.nullish(),
  rootCauseEntityName: z.string().nullish(),
  affectedEntities: z.array(entitySchema).nullish(),
  affectedEntityIds: stringListSchema.nullish(),
  affectedEntityNames: stringListSchema.nullish(),
  affectedEntityTypes: stringListSchema.nullish(),
  relatedEntities: z.array(entitySchema).nullish(),
  alertingProfiles: stringListSchema.nullish(),
});

const queryNotificationSchema = z.looseObject({
  notificationType: z.string().nullish(),
  message: z.string().nullish(),
});

const queryResultSchema = z.looseObject({
  records: z
    .array(z.record(z.string(), z.unknown()).nullable())
    .transform((records) => records.filter((record) => record !== null)),
  metadata: z
    .looseObject({
      grail: z
        .looseObject({
          notifications: z.array(queryNotificationSchema).nullish(),
        })
        .nullish(),
    })
    .nullish(),
});

const queryResponseSchema = z.looseObject({
  state: z.string().min(1),
  requestToken: z.string().min(1).nullish(),
  result: z.unknown().nullish(),
});

type GrailProblem = z.infer<typeof problemSchema>;
type QueryResponse = z.infer<typeof queryResponseSchema>;
type QueryResult = z.infer<typeof queryResultSchema>;
type FetchLike = typeof fetch;

export type DynatraceProblemsFetchResult = {
  problems: Omit<DynatraceProblemRecord, 'id' | 'created' | 'updated'>[];
  totalCount: number;
  resultTruncated: boolean;
};

export type DynatraceAlertingProfileFieldHealth = {
  problemCount: number;
  profiledProblemCount: number;
  healthy: boolean;
};

export function getDynatraceRetryAfterMs(error: unknown): number | null {
  const retryAfterMs = error instanceof Error ? error.cause : null;
  return typeof retryAfterMs === 'number' && Number.isFinite(retryAfterMs) && retryAfterMs >= 0
    ? retryAfterMs
    : null;
}

function dqlStringLiteral(value: string): string {
  const escaped = value.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`);
  return `"${escaped}"`;
}

function buildProblemsQuery(
  alertingProfiles: string[] | null,
  scope: DynatraceProblemsQueryScope,
): string {
  const timeframe =
    scope.mode === 'reconcile' ? '-365d' : `-${Math.max(1, Math.ceil(scope.lookbackMinutes))}m`;
  const profileFilter = alertingProfiles?.length
    ? `\n| filter iAny(in(labels.alerting_profile[], array(${alertingProfiles
        .map(dqlStringLiteral)
        .join(', ')})))`
    : '';
  return `fetch dt.davis.problems, from:${timeframe}
| dedup event.id, sort:{timestamp desc}
| filter not(dt.davis.is_duplicate)${profileFilter}
${PROBLEMS_QUERY_FIELDS}`;
}

function toEntityRef(entity: z.infer<typeof entitySchema>): DynatraceEntityRef {
  return {
    id: entity.id,
    type: entity.type,
    name: entity.name?.trim() || entity.id,
  };
}

function normalizeStringList(
  value: string | string[] | null | undefined,
  deduplicate = true,
): string[] {
  let values: string[] = [];
  if (Array.isArray(value)) values = value;
  else if (value) values = [value];
  const normalized = values.map((item) => item.trim()).filter(Boolean);
  return deduplicate ? [...new Set(normalized)] : normalized;
}

function classicAffectedEntities(problem: GrailProblem): DynatraceEntityRef[] {
  const ids = normalizeStringList(problem.affectedEntityIds, false);
  const names = normalizeStringList(problem.affectedEntityNames, false);
  const types = normalizeStringList(problem.affectedEntityTypes, false);
  const count = Math.max(ids.length, names.length);
  const typesAreAligned = types.length === count;

  return Array.from({ length: count }, (_, index) => {
    const id = ids[index] || names[index];
    const name = names[index] || id;
    if (!id || !name) return null;
    return {
      id,
      name,
      type: typesAreAligned ? types[index] || 'ENTITY' : 'ENTITY',
    };
  }).filter((entity): entity is DynatraceEntityRef => entity !== null);
}

function affectedEntityRefs(problem: GrailProblem): DynatraceEntityRef[] {
  const smartscapeEntities = (problem.affectedEntities ?? []).map(toEntityRef);
  const classicEntities = classicAffectedEntities(problem);
  const classicById = new Map(classicEntities.map((entity) => [entity.id, entity]));
  const seen = new Set<string>();

  const merged = smartscapeEntities.map((entity) => {
    seen.add(entity.id);
    const classicEntity = classicById.get(entity.id);
    if (classicEntity && entity.name === entity.id && classicEntity.name !== classicEntity.id) {
      return { ...entity, name: classicEntity.name };
    }
    return entity;
  });

  for (const entity of classicEntities) {
    if (!seen.has(entity.id)) merged.push(entity);
  }
  return merged;
}

function rootCauseName(problem: GrailProblem): string {
  const smartscapeRoot = problem.rootCause ? toEntityRef(problem.rootCause) : null;
  const classicName = problem.rootCauseEntityName?.trim() || '';
  if (smartscapeRoot && smartscapeRoot.name !== smartscapeRoot.id) return smartscapeRoot.name;
  return classicName || smartscapeRoot?.name || '';
}

function normalizeNumericTimestamp(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const absolute = Math.abs(value);
  if (absolute >= 1e17) return Math.round(value / 1e6); // nanoseconds
  if (absolute >= 1e14) return Math.round(value / 1e3); // microseconds
  if (absolute >= 1e11) return Math.round(value); // milliseconds
  return Math.round(value * 1_000); // seconds
}

function timestampToMilliseconds(
  value: string | number | null | undefined,
  fallback: number,
): number {
  if (typeof value === 'number') return normalizeNumericTimestamp(value) ?? fallback;
  if (typeof value !== 'string' || !value.trim()) return fallback;

  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return normalizeNumericTimestamp(Number(trimmed)) ?? fallback;
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSeverity(value: string | null | undefined): DynatraceProblemSeverity {
  switch (value?.trim().toUpperCase()) {
    case 'AVAILABILITY':
      return 'AVAILABILITY';
    case 'CUSTOM_ALERT':
      return 'CUSTOM_ALERT';
    case 'ERROR':
      return 'ERROR';
    case 'MONITORING_UNAVAILABLE':
      return 'MONITORING_UNAVAILABLE';
    case 'RESOURCE_CONTENTION':
      return 'RESOURCE_CONTENTION';
    case 'SLOWDOWN':
    case 'PERFORMANCE':
      return 'PERFORMANCE';
    default:
      return 'INFO';
  }
}

function normalizeImpactLevel(
  value: string | string[] | null | undefined,
): DynatraceProblemImpactLevel {
  const candidate = (Array.isArray(value) ? value[0] : value)?.trim().toUpperCase();
  switch (candidate) {
    case 'APPLICATION':
      return 'APPLICATION';
    case 'INFRASTRUCTURE':
      return 'INFRASTRUCTURE';
    case 'SERVICES':
      return 'SERVICES';
    case 'ENVIRONMENT':
    default:
      // Grail can also report SYNTHETIC. Relay's existing storage contract has
      // no synthetic impact level, so retain the problem under the neutral
      // environment grouping instead of dropping it.
      return 'ENVIRONMENT';
  }
}

function toRecord(
  problem: GrailProblem,
  environmentUrl: string,
  syncedAt: string,
): Omit<DynatraceProblemRecord, 'id' | 'created' | 'updated'> {
  return {
    problemId: problem.problemId,
    displayId: problem.displayId?.trim() || problem.problemId,
    title: problem.title,
    status: problem.status === 'ACTIVE' ? 'OPEN' : 'CLOSED',
    severity: normalizeSeverity(problem.severity),
    impactLevel: normalizeImpactLevel(problem.impactLevel),
    startTime: timestampToMilliseconds(problem.startTime, Date.now()),
    endTime:
      problem.status === 'ACTIVE' ? -1 : timestampToMilliseconds(problem.endTime, Date.now()),
    rootCauseName: rootCauseName(problem),
    affectedEntities: affectedEntityRefs(problem),
    impactedEntities: (problem.relatedEntities ?? []).map(toEntityRef),
    managementZones: [],
    alertingProfiles: normalizeStringList(problem.alertingProfiles),
    scopeExcluded: false,
    scopeExcludedAt: '',
    environmentUrl,
    syncedAt,
  };
}

function apiErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return 'Dynatrace rejected the platform token. Confirm that it is active and assigned to this environment.';
    case 403:
      return 'Dynatrace denied the Grail query. The platform token and its user need storage:events:read and storage:buckets:read access.';
    case 404:
      return 'Dynatrace Grail Query API was not found. Use the SaaS environment URL ending in .apps.dynatrace.com.';
    case 429:
      return 'Dynatrace rate-limited the Grail query. Relay will retry automatically.';
    default:
      return `Dynatrace Grail Query API returned HTTP ${status}.`;
  }
}

function queryStateError(state: string): Error {
  if (state === 'CANCELLED') return new Error('Dynatrace cancelled the Grail Problems query.');
  return new Error(
    'Dynatrace could not execute the Grail Problems query. Confirm the token permissions and environment access.',
  );
}

function assertQueryCanContinue(state: string): void {
  if (state === 'FAILED' || state === 'CANCELLED') throw queryStateError(state);
  if (state === 'RESULT_GONE') {
    throw new Error('Dynatrace discarded the Grail query result before Relay retrieved it.');
  }
  if (!['NOT_STARTED', 'RUNNING', 'SUCCEEDED'].includes(state)) {
    throw new Error(`Dynatrace returned an unsupported Grail query state: ${state}.`);
  }
}

function parseQueryResult(result: unknown): QueryResult | null {
  if (result == null) return null;
  const parsed = queryResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error('Dynatrace returned an unexpected Grail query result.');
  }
  return parsed.data;
}

function resultWasTruncated(result: QueryResult): boolean {
  return (result.metadata?.grail?.notifications ?? []).some((notification) => {
    const type = notification.notificationType?.toUpperCase() ?? '';
    const message = notification.message?.toLowerCase() ?? '';
    return (
      (type.includes('RESULT') && type.includes('LIMIT')) ||
      (/result/.test(message) && /limit/.test(message) && /(reach|exceed|truncate)/.test(message))
    );
  });
}

function numericCount(record: Record<string, unknown> | undefined, field: string): number | null {
  const value = record?.[field];
  const count = typeof value === 'string' ? Number(value) : value;
  return typeof count === 'number' && Number.isFinite(count) && count >= 0
    ? Math.floor(count)
    : null;
}

function retryAfterHeaderMilliseconds(headers: Headers): number | null {
  const retryAfter = headers.get('retry-after');
  if (!retryAfter) return null;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(retryAfter);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

async function retryAfterMilliseconds(response: Response): Promise<number | null> {
  const headerValue = retryAfterHeaderMilliseconds(response.headers);
  if (headerValue !== null) return headerValue;
  try {
    const body = (await response.json()) as {
      error?: { retryAfterSeconds?: unknown };
    };
    const value = body.error?.retryAfterSeconds;
    const seconds = typeof value === 'string' ? Number(value) : value;
    return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0
      ? Math.ceil(seconds * 1_000)
      : null;
  } catch {
    return null;
  }
}

function queryEnvelopeSummary(response: QueryResponse): string {
  const fields =
    Object.keys(response)
      .sort((a, b) => a.localeCompare(b))
      .join(',') || 'none';
  const resultType = Array.isArray(response.result) ? 'array' : typeof response.result;
  return `state=${response.state}; fields=${fields}; resultType=${resultType}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class DynatraceProblemsClient {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async fetchProblems(
    config: DynatraceProblemsConfig,
    scope: DynatraceProblemsQueryScope = DEFAULT_PROBLEMS_QUERY_SCOPE,
  ): Promise<DynatraceProblemsFetchResult> {
    const syncedAt = new Date().toISOString();
    const result = await this.runQuery(config, buildProblemsQuery(config.alertingProfiles, scope));
    const parsed = z.array(problemSchema).safeParse(result.records);
    if (!parsed.success) {
      throw new Error('Dynatrace returned an unexpected Grail Problems response.');
    }

    const problems = parsed.data.map((problem) =>
      toRecord(problem, config.environmentUrl, syncedAt),
    );
    return {
      problems,
      totalCount: problems.length,
      resultTruncated: resultWasTruncated(result) || problems.length >= MAX_PROBLEMS,
    };
  }

  async fetchAlertingProfiles(config: DynatraceProblemsConfig): Promise<string[]> {
    const result = await this.runQuery(config, ALERTING_PROFILES_QUERY);
    const parsed = z
      .array(z.object({ alertingProfile: z.string().min(1) }))
      .safeParse(result.records);
    if (!parsed.success) {
      throw new Error('Dynatrace returned an unexpected alerting profile catalog.');
    }
    return [
      ...new Set(parsed.data.map((record) => record.alertingProfile.trim()).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  async inspectAlertingProfileField(
    config: DynatraceProblemsConfig,
  ): Promise<DynatraceAlertingProfileFieldHealth> {
    const result = await this.runQuery(config, ALERTING_PROFILE_FIELD_HEALTH_QUERY);
    const problemCount = numericCount(result.records[0], 'problemCount');
    const profiledProblemCount = numericCount(result.records[0], 'profiledProblemCount');
    if (problemCount === null || profiledProblemCount === null) {
      throw new Error('Dynatrace returned an unexpected alerting-profile health response.');
    }
    return {
      problemCount,
      profiledProblemCount,
      healthy: problemCount === 0 || profiledProblemCount > 0,
    };
  }

  async testConnection(config: DynatraceProblemsConfig): Promise<number> {
    const result = await this.runQuery(config, CONNECTION_TEST_QUERY);
    const count = numericCount(result.records[0], 'problemCount');
    if (count === null) {
      throw new Error('Dynatrace returned an unexpected Grail Problems response.');
    }
    return count;
  }

  private async runQuery(config: DynatraceProblemsConfig, query: string): Promise<QueryResult> {
    const startedAt = Date.now();
    let response = await this.executeQuery(config, query);
    let requestToken = response.requestToken ?? null;

    while (true) {
      const result = parseQueryResult(response.result);
      if (response.state === 'SUCCEEDED' && result) return result;
      assertQueryCanContinue(response.state);
      requestToken = response.requestToken ?? requestToken;
      if (!requestToken) {
        throw new Error(
          `Dynatrace did not return a token for polling the Grail query (${queryEnvelopeSummary(response)}).`,
        );
      }
      if (Date.now() - startedAt >= REQUEST_TIMEOUT_MS) {
        throw new Error('Dynatrace Grail Problems query timed out.');
      }

      // The execute endpoint can return SUCCEEDED with only a request token;
      // the result still comes from the poll endpoint.
      if (response.state !== 'SUCCEEDED') await delay(POLL_INTERVAL_MS);
      response = await this.pollQuery(config, requestToken);
    }
  }

  private executeQuery(config: DynatraceProblemsConfig, query: string): Promise<QueryResponse> {
    const url = new URL('/platform/storage/query/v1/query:execute', config.environmentUrl);
    return this.request(config, url, {
      method: 'POST',
      body: JSON.stringify({
        query,
        requestTimeoutMilliseconds: QUERY_WAIT_TIMEOUT_MS,
        maxResultRecords: MAX_PROBLEMS,
      }),
    });
  }

  private pollQuery(config: DynatraceProblemsConfig, requestToken: string): Promise<QueryResponse> {
    const url = new URL('/platform/storage/query/v1/query:poll', config.environmentUrl);
    url.searchParams.set('request-token', requestToken);
    return this.request(config, url, { method: 'GET' });
  }

  private async request(
    config: DynatraceProblemsConfig,
    url: URL,
    init: { method: 'GET' | 'POST'; body?: string },
  ): Promise<QueryResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiToken}`,
        },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        const retryAfterMs =
          response.status === 429 ? await retryAfterMilliseconds(response) : null;
        throw new Error(apiErrorMessage(response.status), { cause: retryAfterMs });
      }

      const parsed = queryResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error('Dynatrace returned an unexpected Grail query response.');
      }
      const headerToken =
        response.headers.get('request-token') ??
        response.headers.get('x-request-token') ??
        response.headers.get('x-dynatrace-request-token');
      return {
        ...parsed.data,
        ...(parsed.data.requestToken || !headerToken ? {} : { requestToken: headerToken }),
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('Dynatrace Grail Problems request timed out.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
