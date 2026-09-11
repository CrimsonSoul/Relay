import { z } from 'zod';
import type { DynatraceEntityRef, DynatraceProblemRecord } from '@shared/dynatraceProblems';
import type { DynatraceProblemsConfig } from './DynatraceProblemsConfigStore';
import { readDynatracePlatform } from './DynatracePlatformRead';

export type IncomingDynatraceProblem = Omit<DynatraceProblemRecord, 'id' | 'created' | 'updated'>;
const PATH = '/platform/classic/environment-api/v2/problems';
const MAX_PAGES = 200;
const entity = z.object({
  entityId: z.object({ id: z.string().min(1), type: z.string().min(1) }),
  name: z.string().nullish(),
});
const problem = z.object({
  problemId: z.string().min(1).max(512),
  displayId: z.string(),
  title: z.string().min(1),
  status: z.enum(['OPEN', 'CLOSED']),
  severityLevel: z.enum([
    'AVAILABILITY',
    'CUSTOM_ALERT',
    'ERROR',
    'INFO',
    'MONITORING_UNAVAILABLE',
    'PERFORMANCE',
    'RESOURCE_CONTENTION',
  ]),
  impactLevel: z.enum(['APPLICATION', 'ENVIRONMENT', 'INFRASTRUCTURE', 'SERVICES']),
  startTime: z.number().nonnegative(),
  endTime: z.number(),
  rootCauseEntity: entity.nullish(),
  affectedEntities: z.array(entity),
  impactedEntities: z.array(entity),
  managementZones: z.array(z.object({ id: z.string(), name: z.string() })),
  problemFilters: z.array(z.object({ id: z.string(), name: z.string() })),
});
const page = z.object({
  problems: z.array(problem),
  nextPageKey: z.string().max(16384).nullish(),
});

function selectorString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
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
    displayId: value.displayId,
    title: value.title,
    status: value.status,
    severity: value.severityLevel,
    impactLevel: value.impactLevel,
    startTime: value.startTime,
    endTime: value.status === 'OPEN' ? -1 : value.endTime,
    rootCauseName: value.rootCauseEntity?.name ?? '',
    affectedEntities: value.affectedEntities.map(entityRef),
    impactedEntities: value.impactedEntities.map(entityRef),
    managementZones: value.managementZones,
    alertingProfiles: value.problemFilters.map(({ name }) => name),
    environmentUrl: config.environmentUrl,
    syncedAt: new Date().toISOString(),
  };
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
      this.list(config, '0', `status("open")${profileFilter}`, signal),
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
      const recovered = await this.list(config, '0', `problemId(${ids})`, signal);
      for (const record of recovered) records.set(record.problemId, record);
    }
    return [...records.values()];
  }

  async testConnection(config: DynatraceProblemsConfig): Promise<number> {
    const response = await readDynatracePlatform(
      this.fetchImpl,
      config,
      PATH,
      new URLSearchParams({ from: '0', problemSelector: 'status("open")', pageSize: '1' }),
      AbortSignal.timeout(15_000),
      'environment-api:problems:read and environment:roles:viewer',
    );
    const parsed = z
      .object({ totalCount: z.number().int().nonnegative(), problems: z.array(problem) })
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
      records.push(...(await this.list(config, '0', `problemId(${selector})`, signal)));
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
        'environment-api:problems:read and environment:roles:viewer',
      );
      const parsed = page.safeParse(response);
      if (!parsed.success) throw new Error('Dynatrace returned an invalid Problems API response.');
      records.push(...parsed.data.problems.map((value) => toRecord(value, config)));
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
