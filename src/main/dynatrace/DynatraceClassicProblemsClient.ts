import { z } from 'zod';
import type {
  DynatraceEntityRef,
  DynatraceProblemImpactLevel,
  DynatraceProblemRecord,
  DynatraceProblemSeverity,
} from '@shared/dynatraceProblems';
import type { DynatraceProblemsConfig } from './DynatraceProblemsConfigStore';
import { loggers } from '../logger';
import { readDynatracePlatform } from './DynatracePlatformRead';

type IncomingDynatraceProblem = Omit<DynatraceProblemRecord, 'id' | 'created' | 'updated'>;
const PATH = '/platform/classic/environment-api/v2/problems';
// Dynatrace rejects epoch zero as an empty startTime. One millisecond still includes all problems.
const EARLIEST_FROM = '1';
const MAX_PAGES = 200;
const entity = z.object({
  entityId: z.object({ id: z.string().min(1), type: z.string().min(1) }),
  name: z.string().nullish(),
});
const zone = z.object({ id: z.string(), name: z.string() });
/** Keeps the well-formed items of a list that Dynatrace may omit or partly fill. */
function lenientList<T extends z.ZodType>(item: T) {
  return z
    .array(item.nullable().catch(null))
    .nullish()
    .catch(null)
    .transform((values) => (values ?? []).filter((value): value is z.infer<T> => value !== null));
}
const optionalText = z.string().nullish().catch(null);
// Only identity, status, and start time are required. Everything else falls back so a
// problem with missing or unfamiliar data still reaches the queue.
const problem = z.object({
  problemId: z.string().min(1).max(512),
  status: z.enum(['OPEN', 'CLOSED']),
  startTime: z.number().nonnegative(),
  displayId: optionalText,
  title: optionalText,
  severityLevel: optionalText,
  impactLevel: optionalText,
  endTime: z.number().nullish().catch(null),
  rootCauseEntity: entity.nullish().catch(null),
  affectedEntities: lenientList(entity),
  impactedEntities: lenientList(entity),
  managementZones: lenientList(zone),
  problemFilters: lenientList(zone),
});
// Problems are validated one at a time so a single unexpected record cannot block the page.
const page = z.object({
  problems: z.array(z.unknown()),
  nextPageKey: z.string().max(16384).nullish(),
});

function selectorString(value: string): string {
  const escaped = value.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`);
  return `"${escaped}"`;
}

function parseProblems(values: unknown[], config: DynatraceProblemsConfig) {
  const records: IncomingDynatraceProblem[] = [];
  const invalidFields = new Set<string>();
  for (const value of values) {
    const parsed = problem.safeParse(value);
    if (parsed.success) records.push(toRecord(parsed.data, config));
    else for (const issue of parsed.error.issues) invalidFields.add(issue.path.join('.'));
  }
  const skipped = values.length - records.length;
  if (skipped) {
    // Field paths only; problem content stays out of the log.
    loggers.main.warn('Skipped Dynatrace problems with an unexpected shape', {
      skipped,
      fields: [...invalidFields].slice(0, 20),
    });
  }
  return records;
}

function entityRef(value: z.infer<typeof entity>): DynatraceEntityRef {
  return { ...value.entityId, name: value.name || value.entityId.id };
}

function toRecord(
  value: z.infer<typeof problem>,
  config: DynatraceProblemsConfig,
): IncomingDynatraceProblem {
  return {
    problemId: value.problemId,
    displayId: value.displayId || value.problemId,
    title: value.title?.trim() || 'Untitled Dynatrace problem',
    status: value.status,
    severity: normalizeSeverity(value.severityLevel),
    impactLevel: normalizeImpactLevel(value.impactLevel),
    startTime: value.startTime,
    endTime: value.status === 'OPEN' ? -1 : (value.endTime ?? value.startTime),
    rootCauseName: value.rootCauseEntity?.name ?? '',
    affectedEntities: value.affectedEntities.map(entityRef),
    impactedEntities: value.impactedEntities.map(entityRef),
    managementZones: value.managementZones,
    alertingProfiles: value.problemFilters.map(({ name }) => name),
    environmentUrl: config.environmentUrl,
    syncedAt: new Date().toISOString(),
  };
}

export function normalizeSeverity(value: string | null | undefined): DynatraceProblemSeverity {
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

export function normalizeImpactLevel(
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

export class DynatraceClassicProblemsClient {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async read(
    config: DynatraceProblemsConfig,
    lookbackMinutes: number,
    trackedOpenIds: string[] = [],
  ): Promise<IncomingDynatraceProblem[]> {
    const signal = AbortSignal.timeout(20_000);
    const profileFilter = config.alertingProfiles?.length
      ? `,problemFilterNames.equals(${config.alertingProfiles.map(selectorString).join(',')})`
      : '';
    // Open problems may have started years ago. The list API filters on start/end time,
    // not last update, so an incremental window alone silently loses long-running problems.
    const [open, closed] = await Promise.all([
      this.list(config, EARLIEST_FROM, `status("open")${profileFilter}`, signal),
      this.list(
        config,
        `now-${Math.max(120, Math.ceil(lookbackMinutes))}m`,
        `status("closed")${profileFilter}`,
        signal,
      ),
    ]);
    const records = new Map([...open, ...closed].map((record) => [record.problemId, record]));
    // A close can fall outside the lookback after a long outage. Read missing tracked IDs
    // explicitly; absence from a list must never be interpreted as resolution.
    const missing = [...new Set(trackedOpenIds)].filter((id) => !records.has(id));
    for (let index = 0; index < missing.length; index += 50) {
      const ids = missing
        .slice(index, index + 50)
        .map(selectorString)
        .join(',');
      const recovered = await this.list(config, EARLIEST_FROM, `problemId(${ids})`, signal);
      for (const record of recovered) records.set(record.problemId, record);
    }
    return [...records.values()];
  }

  async testConnection(config: DynatraceProblemsConfig): Promise<number> {
    const response = await readDynatracePlatform(
      this.fetchImpl,
      config,
      PATH,
      new URLSearchParams({
        from: EARLIEST_FROM,
        problemSelector: 'status("open")',
        pageSize: '1',
      }),
      AbortSignal.timeout(15_000),
      'environment-api:problems:read',
    );
    const parsed = z
      .object({ totalCount: z.number().int().nonnegative(), problems: z.array(z.unknown()) })
      .safeParse(response);
    if (!parsed.success)
      throw new Error('Dynatrace returned an invalid Problems API connection response.');
    return parsed.data.totalCount;
  }

  async readByIds(
    config: DynatraceProblemsConfig,
    ids: string[],
  ): Promise<IncomingDynatraceProblem[]> {
    const records: IncomingDynatraceProblem[] = [];
    const signal = AbortSignal.timeout(10_000);
    for (let index = 0; index < ids.length; index += 50) {
      const selector = ids
        .slice(index, index + 50)
        .map(selectorString)
        .join(',');
      records.push(...(await this.list(config, EARLIEST_FROM, `problemId(${selector})`, signal)));
    }
    return records;
  }

  private async list(
    config: DynatraceProblemsConfig,
    from: string,
    problemSelector: string,
    signal: AbortSignal,
  ): Promise<IncomingDynatraceProblem[]> {
    let parameters = new URLSearchParams({ from, problemSelector, pageSize: '500' });
    const cursors = new Set<string>();
    const records: IncomingDynatraceProblem[] = [];
    for (let count = 0; count < MAX_PAGES; count += 1) {
      const response = await readDynatracePlatform(
        this.fetchImpl,
        config,
        PATH,
        parameters,
        signal,
        'environment-api:problems:read',
      );
      const parsed = page.safeParse(response);
      if (!parsed.success) throw new Error('Dynatrace returned an invalid Problems API response.');
      records.push(...parseProblems(parsed.data.problems, config));
      const cursor = parsed.data.nextPageKey;
      if (!cursor) return records;
      if (cursors.has(cursor)) throw new Error('Dynatrace repeated a Problems API page.');
      cursors.add(cursor);
      parameters = new URLSearchParams({ nextPageKey: cursor });
    }
    throw new Error(
      'Dynatrace Problems API pagination exceeded its limit; incomplete results were not saved.',
    );
  }
}
