import { z } from 'zod';
import type { DynatraceProblemsConfig } from './DynatraceProblemsConfigStore';
import { readDynatracePlatform } from './DynatracePlatformRead';

const PAGE_SIZE = 100;
const OVERLAP_MS = 2 * 60_000;
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_BATCH_BYTES = 256 * 1024;
const executionSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  workflow: z.string(),
  triggerType: z.string(),
  startedAt: z.iso.datetime({ offset: true }),
  params: z.object({ event: z.record(z.string(), z.unknown()).optional() }).optional(),
});
const pageSchema = z.object({
  count: z.number().int().nonnegative(),
  results: z.array(executionSchema),
});
const eventSchema = z.looseObject({
  'event.kind': z.literal('DAVIS_PROBLEM'),
  'event.id': z.string().min(1).max(512),
  'event.status': z.enum(['ACTIVE', 'CLOSED']),
  'dt.davis.is_duplicate': z.boolean().optional(),
});
export type DynatraceWorkflowEvent = {
  executionId: string;
  startedAt: number;
  event: z.infer<typeof eventSchema>;
};
type EventWindow = { from: number; to: number; offset: number };
type DqlRead = (query: string, signal: AbortSignal) => Promise<Record<string, unknown>[]>;

function dqlString(value: string): string {
  return JSON.stringify(value);
}

function parseEvents(
  results: z.infer<typeof executionSchema>[],
  workflowId: string,
): DynatraceWorkflowEvent[] {
  const events: DynatraceWorkflowEvent[] = [];
  for (const execution of results) {
    if (execution.workflow !== workflowId || execution.triggerType !== 'Event') {
      throw new Error('Dynatrace returned an execution outside the configured workflow.');
    }
    if (!execution.params?.event)
      throw new Error(
        'The workflow execution is missing its triggering event; Relay will retry it.',
      );
    const raw = execution.params.event;
    if (raw['event.kind'] !== 'DAVIS_PROBLEM') continue;
    const event = eventSchema.safeParse(raw);
    if (!event.success) throw new Error('Dynatrace returned an invalid problem trigger payload.');
    if (event.data['dt.davis.is_duplicate'] === true) continue;
    if (Buffer.byteLength(JSON.stringify(raw)) > MAX_EVENT_BYTES)
      throw new Error('The problem trigger payload exceeded its size limit.');
    events.push({
      executionId: execution.id,
      startedAt: Date.parse(execution.startedAt),
      event: event.data,
    });
  }
  return events;
}

function takeBatch(pending: DynatraceWorkflowEvent[]): DynatraceWorkflowEvent[] {
  const batch: DynatraceWorkflowEvent[] = [];
  let bytes = 0;
  while (pending.length) {
    const next = pending[0]!;
    const size = Buffer.byteLength(JSON.stringify(next.event));
    if (batch.length && bytes + size > MAX_BATCH_BYTES) break;
    batch.push(pending.shift()!);
    bytes += size;
  }
  return batch;
}

/** Reads immutable trigger payloads, including RUNNING executions; no email task or Grail fetch gate. */
export class DynatraceWorkflowEventsClient {
  private context = '';
  private checkpoint: number | null = null;
  private window: EventWindow | null = null;
  private retryAt = 0;
  private verifiedAt = 0;
  private verifiedContext = '';
  private verificationError: unknown = null;
  private readonly evaluated = new Map<string, boolean>();

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async verify(
    config: DynatraceProblemsConfig,
    signal = AbortSignal.timeout(15_000),
  ): Promise<void> {
    if (!config.workflowId)
      throw new Error('Select a standard event-triggered workflow for live DQL filtering.');
    const response = await readDynatracePlatform(
      this.fetchImpl,
      config,
      `/platform/automation/v1/workflows/${encodeURIComponent(config.workflowId)}`,
      new URLSearchParams(),
      signal,
      'automation:workflows:read',
    );
    const workflow = z
      .object({
        id: z.string(),
        type: z.string(),
        isDeployed: z.boolean(),
        triggerType: z.string(),
        trigger: z.object({ eventTrigger: z.object({ isActive: z.boolean().optional() }) }),
        throttle: z.object({ isLimitHit: z.boolean() }).optional(),
      })
      .safeParse(response);
    if (
      !workflow.success ||
      workflow.data.id !== config.workflowId ||
      workflow.data.type !== 'STANDARD' ||
      !workflow.data.isDeployed ||
      workflow.data.triggerType.toLowerCase() !== 'event' ||
      workflow.data.trigger.eventTrigger.isActive === false
    ) {
      throw new Error(
        'Live DQL filtering requires a deployed standard workflow with an event trigger. Its trigger must cover every problem this scope should include.',
      );
    }
    if (workflow.data.throttle?.isLimitHit)
      throw new Error(
        'Dynatrace has throttled the NOC workflow. Live DQL admission resumes when its execution limit clears.',
      );
    this.verifiedAt = Date.now();
    this.verificationError = null;
    this.verifiedContext = JSON.stringify([
      config.environmentUrl,
      config.apiToken,
      config.workflowId,
    ]);
  }

  async read(
    config: DynatraceProblemsConfig,
    lookbackMinutes: number,
    readDql: DqlRead,
    externalSignal?: AbortSignal,
  ): Promise<DynatraceWorkflowEvent[]> {
    if (!config.workflowId)
      throw new Error(
        'Configure a workflow ID in the DQL scope to receive problems without waiting for Grail.',
      );
    const context = JSON.stringify([
      config.environmentUrl,
      config.apiToken,
      config.workflowId,
      config.customDqlMatcher,
    ]);
    if (context !== this.context) {
      this.context = context;
      this.checkpoint = null;
      this.window = null;
      this.evaluated.clear();
      this.retryAt = 0;
      this.verifiedAt = 0;
    }
    if (Date.now() < this.retryAt)
      throw new Error('Dynatrace workflow reads are waiting for Retry-After.', {
        cause: this.retryAt - Date.now(),
      });
    const now = Date.now();
    const window = this.windowFor(now, lookbackMinutes);
    const timeout = AbortSignal.timeout(10_000);
    const signal = externalSignal ? AbortSignal.any([externalSignal, timeout]) : timeout;
    await this.ensureVerified(config, signal);
    if (context !== this.context)
      throw new Error('Dynatrace workflow configuration changed during verification.');
    const { results, count } = await this.readPage(config, window, signal);
    if (!results.length && window.offset < count)
      throw new Error('Dynatrace returned an incomplete workflow execution page.');
    const events = parseEvents(results, config.workflowId);
    if (window.offset + results.length < count) {
      // Catch-up never takes priority over newly arriving problems. While paging older
      // executions, also read the newest events; replay decisions are cached below.
      const recent = await this.readPage(
        config,
        { from: now - OVERLAP_MS, to: now, offset: 0 },
        signal,
        '-startedAt,-id',
      );
      const byId = new Map(events.map((event) => [event.executionId, event]));
      for (const event of parseEvents(recent.results, config.workflowId))
        byId.set(event.executionId, event);
      events.splice(0, events.length, ...byId.values());
    }
    const decisions = new Map(this.evaluated);
    await this.evaluate(events, config.customDqlMatcher ?? '', decisions, readDql, signal);
    signal.throwIfAborted();
    if (context !== this.context)
      throw new Error('Dynatrace workflow configuration changed during the read.');
    // Advance only after every event in this page was evaluated successfully. A failed DQL
    // request replays the page, and pagination continues on later ticks without losing backlog.
    this.evaluated.clear();
    for (const [id, matched] of [...decisions].slice(-5000)) this.evaluated.set(id, matched);
    const offset = window.offset + results.length;
    this.window = offset < count ? { ...window, offset } : null;
    if (!this.window) this.checkpoint = window.to;
    return events.filter(({ executionId }) => decisions.get(executionId));
  }

  private windowFor(now: number, lookbackMinutes: number): EventWindow {
    return (
      this.window ?? {
        from:
          this.checkpoint === null
            ? now - Math.max(120, lookbackMinutes) * 60_000
            : this.checkpoint - OVERLAP_MS,
        to: now,
        offset: 0,
      }
    );
  }

  private async ensureVerified(
    config: DynatraceProblemsConfig,
    signal: AbortSignal,
  ): Promise<void> {
    const sourceContext = JSON.stringify([
      config.environmentUrl,
      config.apiToken,
      config.workflowId,
    ]);
    if (sourceContext === this.verifiedContext && Date.now() - this.verifiedAt < 60_000) {
      if (this.verificationError) throw this.verificationError;
      return;
    }
    try {
      await this.verify(config, signal);
      this.verificationError = null;
    } catch (error) {
      this.verificationError = error;
      throw error;
    } finally {
      this.verifiedAt = Date.now();
      this.verifiedContext = sourceContext;
    }
  }

  private async readPage(
    config: DynatraceProblemsConfig,
    window: EventWindow,
    signal: AbortSignal,
    ordering = 'startedAt,id',
  ): Promise<z.infer<typeof pageSchema>> {
    const readContext = this.context;
    const response = await readDynatracePlatform(
      this.fetchImpl,
      config,
      '/platform/automation/v1/executions',
      new URLSearchParams({
        workflow: config.workflowId!,
        triggerType: 'Event',
        startedAt__gte: new Date(window.from).toISOString(),
        startedAt__lte: new Date(window.to).toISOString(),
        ordering,
        limit: String(PAGE_SIZE),
        offset: String(window.offset),
      }),
      signal,
      'automation:workflows:read',
    ).catch((error: unknown) => {
      if (readContext === this.context && error instanceof Error && typeof error.cause === 'number')
        this.retryAt = Date.now() + error.cause;
      throw error;
    });
    const parsed = pageSchema.safeParse(response);
    if (!parsed.success) throw new Error('Dynatrace returned invalid workflow executions.');
    return parsed.data;
  }

  private async evaluate(
    events: DynatraceWorkflowEvent[],
    matcher: string,
    decisions: Map<string, boolean>,
    readDql: DqlRead,
    signal: AbortSignal,
  ): Promise<void> {
    const pending = events.filter(({ executionId }) => !decisions.has(executionId));
    if (!matcher) {
      for (const { executionId } of pending) decisions.set(executionId, true);
      return;
    }
    while (pending.length) {
      const batch = takeBatch(pending);
      const payload = batch.map(({ event, executionId }) => ({
        ...event,
        relay_execution_id: executionId,
      }));
      // JSON inside an escaped DQL string, never executable text or triple-quoted interpolation.
      // `data` evaluates the real trigger payload without scanning persisted Grail records.
      const rows = await readDql(
        `data json:${dqlString(JSON.stringify(payload))}\n| filter (\n${matcher}\n)\n| fields relay_execution_id`,
        signal,
      );
      const ids = new Set(batch.map(({ executionId }) => executionId));
      const matched = new Set<string>();
      for (const row of rows) {
        if (typeof row.relay_execution_id !== 'string' || !ids.has(row.relay_execution_id)) {
          throw new Error('Dynatrace returned an invalid live DQL match result.');
        }
        matched.add(row.relay_execution_id);
      }
      for (const id of ids) decisions.set(id, matched.has(id));
    }
  }
}
