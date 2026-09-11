import { dynatraceAuthentication, dynatraceAuthenticationKey } from './DynatraceAuthentication';
import { z } from 'zod';
import type { DynatraceProblemsConfig } from './DynatraceProblemsConfigStore';

const MAX_EXECUTIONS_PER_POLL = 25;
const READ_BUDGET_MS = 10_000;
const CONCURRENT_READS = 4;
const terminalStates = new Set(['SUCCESS', 'ERROR', 'CANCELLED', 'SKIPPED', 'DISCARDED']);
const tasksSchema = z.record(z.string(), z.object({ action: z.string(), state: z.string() }));
const subjectSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(1)
    .max(1_000)
    .refine((value) => !value.includes('{{') && !value.includes('{%'))
    .refine((value) =>
      [...value].every((character) => {
        const code = character.codePointAt(0)!;
        return code >= 32 && code !== 127;
      }),
    ),
});

function emailTaskOrder([a]: [string, unknown], [b]: [string, unknown]): number {
  if (a === 'email_noc') return -1;
  if (b === 'email_noc') return 1;
  return a.localeCompare(b);
}

function retryAtFromHeaders(headers: Headers): number {
  const retry = headers.get('retry-after');
  const seconds = retry ? Number(retry) : Number.NaN;
  if (Number.isFinite(seconds)) return Date.now() + Math.max(1, seconds) * 1000;
  const until = retry ? Date.parse(retry) : Number.NaN;
  return Number.isFinite(until) ? Math.max(Date.now() + 1000, until) : Date.now() + 60_000;
}

export type DynatraceWorkflowExecutionRef = {
  problemId: string;
  executionId: string;
  notificationStatus: 'OPEN' | 'CLOSED';
  notificationUpdatedAt: number;
};
export type DynatraceNotificationTitle = Omit<DynatraceWorkflowExecutionRef, 'executionId'> & {
  notificationTitle: string;
};
export type DynatraceNotificationTitlesResult = {
  titles: DynatraceNotificationTitle[];
  complete: boolean;
};

export type DynatraceNotificationReadContext = {
  signal: AbortSignal;
  remainingExecutions: number;
  onTitles?: (titles: DynatraceNotificationTitle[]) => void;
};

/** Reads existing executions only. No workflow definitions, templates, or actions are written. */
export class DynatraceWorkflowNamesClient {
  private context: string | null = null;
  private readonly subjects = new Map<string, string | null>();
  private pending: string[] = [];
  private retryAt = 0;

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async read(
    config: DynatraceProblemsConfig,
    executions: DynatraceWorkflowExecutionRef[],
    reconcile: boolean,
    context?: DynatraceNotificationReadContext,
  ): Promise<DynatraceNotificationTitlesResult> {
    this.prepareCache(config, executions, reconcile);
    if (Date.now() < this.retryAt) throw new Error('Workflow execution reads are rate-limited.');
    const newestFirst = [...executions].sort(
      (a, b) => b.notificationUpdatedAt - a.notificationUpdatedAt,
    );
    const missing = [...new Set(newestFirst.map(({ executionId }) => executionId))].filter(
      (id) => !this.subjects.has(id),
    );
    const missingSet = new Set(missing);
    const alreadyPending = new Set(this.pending);
    // Fresh notifications take precedence over historical catch-up; existing retries keep rotating.
    const scheduled = [...missing.filter((id) => !alreadyPending.has(id)), ...this.pending].filter(
      (id) => missingSet.has(id),
    );
    const limit = Math.min(
      MAX_EXECUTIONS_PER_POLL,
      context?.remainingExecutions ?? MAX_EXECUTIONS_PER_POLL,
    );
    const selected = scheduled.slice(0, limit);
    this.pending = scheduled.slice(limit);
    const queue = selected[Symbol.iterator]();
    const attempted = new Set<string>();
    const controller = new AbortController();
    const signal = context
      ? AbortSignal.any([context.signal, controller.signal])
      : controller.signal;
    const readContext = context ?? { signal, remainingExecutions: limit };
    const timeout = setTimeout(() => controller.abort(), READ_BUDGET_MS);
    context?.onTitles?.(this.titlesFor(executions));
    let failure: unknown;
    const worker = async (): Promise<void> => {
      for (const id of queue) {
        if (signal.aborted) return;
        readContext.remainingExecutions -= 1;
        attempted.add(id);
        try {
          const subject = await this.readSubject(config, id, signal);
          // Undefined means an email route is still running; retry it on the next poll.
          if (signal.aborted || subject === undefined) continue;
          this.subjects.set(id, subject);
          context?.onTitles?.(this.titlesFor(executions));
        } catch (error) {
          if (signal.aborted) return;
          failure ??= error;
          if (Date.now() < this.retryAt) {
            controller.abort();
            return;
          }
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: CONCURRENT_READS }, worker));
      const titles = this.titlesFor(executions);
      // An inaccessible historical execution must not suppress healthy, independently read names.
      if (failure && titles.length === 0) throw failure;
      return {
        complete: missing.every((id) => this.subjects.has(id)),
        titles,
      };
    } finally {
      // Give work that could not start before the deadline a turn ahead of timed-out requests.
      const unfinished = selected.filter((id) => !this.subjects.has(id));
      this.pending.push(
        ...unfinished.filter((id) => !attempted.has(id)),
        ...unfinished.filter((id) => attempted.has(id)),
      );
      clearTimeout(timeout);
    }
  }

  private titlesFor(executions: DynatraceWorkflowExecutionRef[]): DynatraceNotificationTitle[] {
    return executions.flatMap(({ executionId, ...problem }) => {
      const subject = this.subjects.get(executionId);
      return subject ? [{ ...problem, notificationTitle: subject }] : [];
    });
  }

  private prepareCache(
    config: DynatraceProblemsConfig,
    executions: DynatraceWorkflowExecutionRef[],
    reconcile: boolean,
  ): void {
    const key = dynatraceAuthenticationKey(config);
    if (this.context !== key) {
      this.subjects.clear();
      this.pending = [];
      this.retryAt = 0;
      this.context = key;
    }
    if (reconcile) {
      const retained = new Set(executions.map(({ executionId }) => executionId));
      for (const id of this.subjects.keys()) if (!retained.has(id)) this.subjects.delete(id);
    }
  }

  private async readSubject(
    config: DynatraceProblemsConfig,
    executionId: string,
    signal: AbortSignal,
  ): Promise<string | null | undefined> {
    const base = `/platform/automation/v1/executions/${encodeURIComponent(executionId)}/tasks`;
    const response = await this.request(config, base, signal);
    if (response === null) return null; // Execution retention can be shorter than problem retention.
    const parsed = tasksSchema.safeParse(response);
    if (!parsed.success) throw new Error('Dynatrace returned invalid workflow task metadata.');
    const emails = Object.entries(parsed.data)
      .filter(([, task]) => task.action === 'dynatrace.email:send-email')
      .sort(emailTaskOrder);
    if (emails.some(([, task]) => !terminalStates.has(task.state))) return undefined;
    const task = emails.find(([, candidate]) => candidate.state === 'SUCCESS');
    if (!task) return null;
    const input = await this.request(
      config,
      `${base}/${encodeURIComponent(task[0])}/input`,
      signal,
    );
    if (input === null) return null;
    const subject = subjectSchema.safeParse(input);
    // The endpoint returns all inputs. Persist/cache only this validated subject, never body/recipients.
    // Invalid immutable subjects use the fallback and cannot poison other execution reads.
    return subject.success ? subject.data.subject : null;
  }

  private async request(
    config: DynatraceProblemsConfig,
    path: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted();
    const response = await this.fetchImpl(new URL(path, config.environmentUrl), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${await dynatraceAuthentication(this.fetchImpl).token(config, signal)}`,
      },
      redirect: 'error',
      signal,
    });
    signal.throwIfAborted();
    if (response.status === 404) return null;
    if (!response.ok) {
      if (response.status === 401 && config.oauth) dynatraceAuthentication(this.fetchImpl).clear();
      if (response.status === 429) {
        this.retryAt = retryAtFromHeaders(response.headers);
      }
      throw new Error(
        `Workflow execution read failed (HTTP ${response.status}); check automation:workflows:read and workflow access.`,
      );
    }
    const body: unknown = await response.json();
    signal.throwIfAborted();
    return body;
  }
}
