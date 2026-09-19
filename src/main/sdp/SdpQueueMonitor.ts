import { loggers } from '../logger';
import { randomUUID } from 'node:crypto';
import {
  SDP_QUEUES,
  type SdpMonitor,
  type SdpQueue,
  type SdpQueuePage,
  type SdpQueueTicket,
} from '@shared/sdpAccount';
import { SdpProviderError } from './SdpProvider';

const INTERVAL = 30_000;
const RECONCILE = 300_000;
const LEASE = 75_000;
export type MonitorReader = {
  valid: () => boolean;
  read: (
    queue: SdpQueue,
    page: number,
    since: number | undefined,
    signal: AbortSignal,
  ) => Promise<SdpQueuePage>;
  enrich?: (tickets: SdpQueueTicket[], signal: AbortSignal) => Promise<SdpQueueTicket[]>;
  denied: () => void;
};
type Job = {
  members: Map<string, { reader: MonitorReader; expires: number }>;
  controller: AbortController;
  generation: string;
  running: boolean;
  nextAt: number;
  fullAt: number;
  watermark?: number;
  snapshot?: SdpMonitor;
  failures: number;
  failure?: 'outage' | 'denied' | 'invalid' | 'throttled' | 'timeout' | 'unknown';
  progress?: { queue: SdpQueue; page: number };
};
/** In-memory server jobs, keyed only by verified SDP identity + configuration revision. */
export class SdpQueueMonitor {
  private readonly jobs = new Map<string, Job>();
  private readonly timer: ReturnType<typeof setInterval>;
  private stamp = 0;
  constructor() {
    this.timer = setInterval(() => this.tick(), 1000);
    this.timer.unref();
  }
  subscribe(owner: string, id: string, reader: MonitorReader, after?: number) {
    let job = this.jobs.get(owner);
    if (!job) {
      job = {
        members: new Map(),
        controller: new AbortController(),
        generation: randomUUID(),
        running: false,
        nextAt: 0,
        fullAt: 0,
        failures: 0,
      };
      this.jobs.set(owner, job);
    }
    job.members.set(id, { reader, expires: Date.now() + LEASE });
    this.tick();
    let state: 'starting' | 'live' | 'backoff' = job.snapshot ? 'live' : 'starting';
    if (job.failures) state = 'backoff';
    return {
      monitoring: {
        state,
        ...(job.failure ? { failure: job.failure } : {}),
        nextCheckAt: job.nextAt,
      },
      ...(job.snapshot && job.snapshot.fetchedAt !== after
        ? { monitor: structuredClone(job.snapshot) }
        : {}),
    };
  }
  snapshot(owner: string, subscriber?: string): SdpMonitor | undefined {
    const job = this.jobs.get(owner);
    if (subscriber && !job?.members.has(subscriber)) return undefined;
    return job?.snapshot;
  }
  unsubscribe(id: string): void {
    for (const [owner, job] of this.jobs) {
      job.members.delete(id);
      if (!job.members.size) this.invalidate(owner);
    }
  }
  invalidate(owner: string): void {
    this.jobs.get(owner)?.controller.abort();
    this.jobs.delete(owner);
  }
  dispose(): void {
    clearInterval(this.timer);
    for (const owner of this.jobs.keys()) this.invalidate(owner);
  }
  private tick(): void {
    for (const [owner, job] of this.jobs) {
      for (const [id, member] of job.members) {
        if (member.expires <= Date.now() || !member.reader.valid()) job.members.delete(id);
      }
      if (!job.members.size) this.invalidate(owner);
      else if (!job.running && job.nextAt <= Date.now()) void this.poll(owner, job);
    }
  }
  private async scan(
    reader: MonitorReader,
    since: number | undefined,
    signal: AbortSignal,
    job: Job,
  ) {
    const tickets: SdpQueueTicket[] = [];
    let truncated = false;
    for (const queue of SDP_QUEUES) {
      for (let page = 0; page < 20; page++) {
        signal.throwIfAborted();
        job.progress = { queue, page };
        const result = await reader.read(queue, page, since, signal);
        signal.throwIfAborted();
        tickets.push(...result.tickets);
        if (!result.hasMore) break;
        if (page === 19) truncated = true;
      }
    }
    return { tickets, truncated };
  }
  private validJob(owner: string, job: Job, reader: MonitorReader): boolean {
    return this.jobs.get(owner) === job && reader.valid();
  }
  private async poll(owner: string, job: Job): Promise<void> {
    job.running = true;
    const start = Date.now();
    const full = !job.snapshot || start >= job.fullAt;
    const reader = job.members.values().next().value!.reader;
    const signal = AbortSignal.any([job.controller.signal, AbortSignal.timeout(60_000)]);
    try {
      const scan = await this.scan(
        reader,
        full ? undefined : Math.max(0, job.watermark! - 60_000),
        signal,
        job,
      );
      if (!this.validJob(owner, job, reader)) return;
      const merged = mergeTickets(full ? [] : job.snapshot!.tickets, scan.tickets);
      const tickets = reader.enrich ? await reader.enrich(merged.tickets, signal) : merged.tickets;
      if (!this.validJob(owner, job, reader)) return;
      scan.truncated ||= merged.truncated;
      this.stamp = Math.max(Date.now(), this.stamp + 1);
      job.snapshot = {
        tickets,
        fetchedAt: this.stamp,
        generation: job.generation,
        startedAt: start,
        truncated: scan.truncated || (!full && !!job.snapshot?.truncated),
      };
      job.watermark = start;
      if (full) job.fullAt = start + RECONCILE;
      // A bounded delta that overflowed cannot safely advance without a fresh reconciliation.
      if (!full && scan.truncated) job.fullAt = 0;
      job.failures = 0;
      job.failure = undefined;
      job.nextAt = Math.max(Date.now() + 1000, start + INTERVAL);
    } catch (error) {
      this.failed(owner, job, reader, error, signal.aborted);
      loggers.main.warn('SDP queue scan failed', {
        kind: job.failure ?? 'cancelled',
        diagnostic: error instanceof SdpProviderError ? error.diagnostic : undefined,
        queue: job.progress?.queue,
        page: job.progress?.page,
        elapsedMs: Date.now() - start,
      });
    } finally {
      job.running = false;
    }
  }
  private failed(
    owner: string,
    job: Job,
    reader: MonitorReader,
    error: unknown,
    timedOut: boolean,
  ) {
    if (this.jobs.get(owner) !== job) return;
    const failure = error instanceof SdpProviderError ? error.kind : 'unknown';
    job.failure = timedOut ? 'timeout' : failure;
    job.snapshot = undefined;
    job.generation = randomUUID();
    job.failures++;
    job.nextAt =
      Date.now() +
      Math.max(
        Math.min(INTERVAL * 2 ** Math.min(job.failures, 4), RECONCILE),
        error instanceof SdpProviderError ? error.retryAfterMs : 0,
      );
    if (error instanceof SdpProviderError && error.kind === 'denied') {
      this.invalidate(owner);
      reader.denied();
    }
  }
}

function mergeTickets(previous: SdpQueueTicket[], incoming: SdpQueueTicket[]) {
  const rows = new Map(previous.map((ticket) => [ticket.id, ticket]));
  for (const ticket of incoming) {
    const prior = rows.get(ticket.id);
    if (
      !prior ||
      (ticket.updatedAt ?? ticket.createdAt ?? 0) >= (prior.updatedAt ?? prior.createdAt ?? 0)
    )
      rows.set(ticket.id, ticket);
  }
  const tickets: SdpQueueTicket[] = [];
  let truncated = false;
  for (const queue of SDP_QUEUES) {
    const group = [...rows.values()]
      .filter((ticket) => ticket.group === queue)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || b.id.localeCompare(a.id));
    truncated ||= group.length > 1000;
    tickets.push(...group.slice(0, 1000));
  }
  return { tickets, truncated };
}
