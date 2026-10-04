import type PocketBase from 'pocketbase';
import { KNOWLEDGE_DOCUMENTS_COLLECTION, type KnowledgeIndexStatus } from '@shared/knowledge';

const EMPTY_STATUS: KnowledgeIndexStatus = {
  state: 'idle',
  documentCount: 0,
  categoryCount: 0,
  lastIndexedAt: null,
};

const ERROR_STATUS: KnowledgeIndexStatus = {
  ...EMPTY_STATUS,
  state: 'error',
  message: 'Knowledge library status unavailable',
};

/** Realtime can miss events across reconnects and client swaps; the poll is the backstop. */
const WATCH_POLL_INTERVAL_MS = 60_000;
/** One upload or trash touches a document several times; reread once per burst. */
const WATCH_COALESCE_MS = 1_000;

type KnowledgeStatusRecord = {
  category?: unknown;
  indexedAt?: unknown;
  lifecycleState?: unknown;
};

type StatusListener = (status: KnowledgeIndexStatus) => void;

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 100 && Number.isFinite(Date.parse(value));
}

export class KnowledgeIndexStatusService {
  private readonly listeners = new Set<StatusListener>();
  private observed: KnowledgeIndexStatus | null = null;
  private watchGeneration = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshing = false;
  private refreshAgain = false;
  private realtimePb: PocketBase | null = null;
  private stopRealtime: (() => unknown) | null = null;

  constructor(private readonly getPbClient: () => PocketBase | null) {}

  async getStatus(): Promise<KnowledgeIndexStatus> {
    const pb = this.getPbClient();
    if (!pb) return { ...EMPTY_STATUS };
    return (await this.readStatus(pb)) ?? { ...ERROR_STATUS };
  }

  /**
   * Watches the library while anyone listens and reports each distinct status once. Failed reads
   * are not pushed: a transient outage must not replace a good count the UI already shows.
   */
  onChange(listener: StatusListener): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.startWatching();
    return () => {
      if (this.listeners.delete(listener) && this.listeners.size === 0) this.stopWatching();
    };
  }

  private async readStatus(pb: PocketBase): Promise<KnowledgeIndexStatus | null> {
    try {
      const records = await pb
        .collection(KNOWLEDGE_DOCUMENTS_COLLECTION)
        .getFullList<KnowledgeStatusRecord>({
          fields: 'category,indexedAt,lifecycleState',
          requestKey: null,
        });
      const active = records.filter(({ lifecycleState }) => lifecycleState !== 'trashed');
      const categories = new Set(
        active.flatMap(({ category }) =>
          typeof category === 'string' && category.trim() ? [category.trim()] : [],
        ),
      );
      const timestamps = active
        .flatMap(({ indexedAt }) => (validTimestamp(indexedAt) ? [indexedAt] : []))
        .toSorted((left, right) => left.localeCompare(right));

      return {
        state: 'idle',
        documentCount: active.length,
        categoryCount: categories.size,
        lastIndexedAt: timestamps.at(-1) ?? null,
      };
    } catch {
      return null;
    }
  }

  private startWatching(): void {
    this.watchGeneration += 1;
    this.pollTimer = setInterval(() => this.scheduleRefresh(), WATCH_POLL_INTERVAL_MS);
    this.pollTimer.unref?.();
    this.scheduleRefresh();
  }

  private stopWatching(): void {
    this.watchGeneration += 1;
    clearInterval(this.pollTimer ?? undefined);
    clearTimeout(this.refreshTimer ?? undefined);
    this.pollTimer = null;
    this.refreshTimer = null;
    this.observed = null;
    this.detachRealtime();
  }

  private scheduleRefresh(): void {
    if (this.listeners.size === 0 || this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh();
    }, WATCH_COALESCE_MS);
    this.refreshTimer.unref?.();
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) {
      this.refreshAgain = true;
      return;
    }
    this.refreshing = true;
    try {
      do {
        this.refreshAgain = false;
        await this.observe(this.watchGeneration); // NOSONAR - coalescing loop: each read must finish before the next one starts.
      } while (this.refreshAgain && this.listeners.size > 0);
    } finally {
      this.refreshing = false;
    }
  }

  private async observe(generation: number): Promise<void> {
    const pb = this.getPbClient();
    if (!pb) {
      // Forget the last report so the first read after reconnecting is pushed again.
      this.observed = null;
      this.detachRealtime();
      return;
    }
    this.attachRealtime(pb);
    const status = await this.readStatus(pb);
    if (!status || generation !== this.watchGeneration || this.getPbClient() !== pb) return;
    const previous = this.observed;
    if (
      previous?.state === status.state &&
      previous.documentCount === status.documentCount &&
      previous.categoryCount === status.categoryCount &&
      previous.lastIndexedAt === status.lastIndexedAt &&
      previous.message === status.message
    ) {
      return;
    }
    this.observed = status;
    // Snapshot: a listener may subscribe or unsubscribe while this report is delivered.
    for (const listener of new Set(this.listeners)) {
      try {
        listener({ ...status });
      } catch {
        // One failing sink must not starve the others.
      }
    }
  }

  private attachRealtime(pb: PocketBase): void {
    if (this.realtimePb === pb) return;
    this.detachRealtime();
    this.realtimePb = pb;
    void this.subscribeRealtime(pb, this.watchGeneration);
  }

  private async subscribeRealtime(pb: PocketBase, generation: number): Promise<void> {
    let unsubscribe: () => Promise<void>;
    try {
      unsubscribe = await pb
        .collection(KNOWLEDGE_DOCUMENTS_COLLECTION)
        .subscribe('*', () => this.scheduleRefresh());
    } catch {
      // Retry on the next poll.
      if (generation === this.watchGeneration && this.realtimePb === pb) this.realtimePb = null;
      return;
    }
    if (generation === this.watchGeneration && this.realtimePb === pb) {
      this.stopRealtime = unsubscribe;
      return;
    }
    try {
      await unsubscribe();
    } catch {
      // A stale subscription that fails to close has nothing left to release.
    }
  }

  private detachRealtime(): void {
    const stop = this.stopRealtime;
    this.stopRealtime = null;
    this.realtimePb = null;
    if (stop)
      void Promise.resolve()
        .then(stop)
        .catch(() => undefined);
  }
}
