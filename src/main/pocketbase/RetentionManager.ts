import type PocketBase from 'pocketbase';
import { loggers } from '../logger';
import { KnowledgeManagementCleanup } from '../knowledge/KnowledgeManagementCleanup';
import type { KnowledgeUploadCoordinator } from '../knowledge/KnowledgeUploadCoordinator';

const logger = loggers.retention;

export class RetentionManager {
  private restartSchedule?: (delay: number) => void;
  private generation = 0;
  private running = false;
  private readonly activeCleanups = new Set<Promise<void>>();
  private initialTimeout: ReturnType<typeof setTimeout> | null = null;

  private knowledgeUploadCoordinator: Pick<
    KnowledgeUploadCoordinator,
    'withStagingMutation'
  > | null = null;

  constructor(private readonly pb: PocketBase) {}

  setKnowledgeUploadCoordinator(
    coordinator: Pick<KnowledgeUploadCoordinator, 'withStagingMutation'>,
  ): () => void {
    this.knowledgeUploadCoordinator = coordinator;
    return () => {
      if (this.knowledgeUploadCoordinator === coordinator) this.knowledgeUploadCoordinator = null;
    };
  }

  runCleanup(): Promise<void> {
    const cleanup = this.performCleanup().finally(() => this.activeCleanups.delete(cleanup));
    this.activeCleanups.add(cleanup);
    return cleanup;
  }

  async stopForRestore(): Promise<void> {
    this.stop();
    // A scheduled beforeCleanup backup may be waiting behind the active restore.
    // Drain only cleanup that has actually started; stop() invalidates queued runs.
    await Promise.allSettled(this.activeCleanups);
  }

  private async performCleanup(): Promise<void> {
    await this.cleanBridgeHistory();
    await this.cleanAlertHistory();
    await this.cleanConflictLog();
    await this.cleanOncallDismissals();
    await this.cleanKnowledgeManagement();
    logger.info('Retention cleanup complete');
  }

  private async cleanKnowledgeManagement(): Promise<void> {
    try {
      const result = await new KnowledgeManagementCleanup({
        pb: this.pb,
        withStagingMutation: (key, action) =>
          this.knowledgeUploadCoordinator
            ? this.knowledgeUploadCoordinator.withStagingMutation(key, action)
            : action(),
      }).run();
      if (result.expiredUploads > 0 || result.expiredAuditEvents > 0) {
        logger.info('Knowledge management cleanup complete', result);
      }
    } catch (err) {
      logger.error('Knowledge management cleanup failed', { error: err });
    }
  }

  startSchedule(
    intervalMs = 24 * 60 * 60 * 1000,
    beforeCleanup?: () => Promise<void>,
    initialDelayMs = 0,
    failureDelay?: () => number,
  ): void {
    this.stop();
    this.restartSchedule = (delay) =>
      this.startSchedule(intervalMs, beforeCleanup, delay, failureDelay);
    const generation = this.generation;
    let failures = 0;
    const run = async (): Promise<void> => {
      if (generation !== this.generation) return;
      if (this.running) {
        logger.warn('Previous retention run still in progress; skipping this cycle');
        schedule(intervalMs);
        return;
      }
      this.running = true;
      let nextDelay = intervalMs;
      try {
        await beforeCleanup?.();
        if (generation !== this.generation) return;
        await this.runCleanup();
        failures = 0;
      } catch (err) {
        logger.error('Pre-cleanup maintenance failed; cleanup deferred', { error: err });
        nextDelay =
          failureDelay?.() ?? [15 * 60_000, 60 * 60_000, 6 * 60 * 60_000][Math.min(failures++, 2)]!;
      } finally {
        this.running = false;
        if (generation === this.generation) schedule(nextDelay);
      }
    };
    const schedule = (delay: number): void => {
      this.initialTimeout = setTimeout(() => {
        this.initialTimeout = null;
        void run();
      }, delay);
      this.initialTimeout.unref?.();
    };
    if (initialDelayMs > 0) schedule(initialDelayMs);
    else void run();
  }

  reschedule(delay: number): void {
    this.restartSchedule?.(delay);
  }

  stop(): void {
    this.restartSchedule = undefined;
    this.generation++;
    if (this.initialTimeout) {
      clearTimeout(this.initialTimeout);
      this.initialTimeout = null;
    }
  }

  /** Delete records in parallel chunks to avoid serial one-by-one overhead. */
  private async batchDelete(
    collection: string,
    records: { id: string }[],
    chunkSize = 10,
  ): Promise<void> {
    for (let i = 0; i < records.length; i += chunkSize) {
      const chunk = records.slice(i, i + chunkSize);
      const results = await Promise.allSettled(
        chunk.map((r) => this.pb.collection(collection).delete(r.id)),
      );
      for (const result of results) {
        if (result.status === 'rejected') {
          logger.error('Failed to delete record during retention cleanup', {
            collection,
            error: result.reason,
          });
        }
      }
    }
  }

  private async cleanBridgeHistory(): Promise<void> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace('T', ' ');
    try {
      const old = await this.pb
        .collection('bridge_history')
        .getFullList({ filter: `created < "${thirtyDaysAgo}"`, batch: 200 });
      if (old.length > 0) logger.info('Cleaning bridge history', { expired: old.length });
      await this.batchDelete('bridge_history', old);
      const all = await this.pb
        .collection('bridge_history')
        .getFullList({ sort: '-created', batch: 200 });
      const excess = all.slice(100);
      if (excess.length > 0) logger.info('Pruning bridge history excess', { count: excess.length });
      await this.batchDelete('bridge_history', excess);
    } catch (err) {
      logger.error('Bridge history cleanup failed', { error: err });
    }
  }

  private async cleanAlertHistory(): Promise<void> {
    try {
      const result = await this.pb.send<{ deleted: number }>('/api/relay/retention/alert-history', {
        method: 'POST',
        requestKey: null,
      });
      if (result.deleted > 0) logger.info('Cleaning alert history', { deleted: result.deleted });
    } catch (err) {
      logger.error('Alert history cleanup failed', { error: err });
    }
  }

  private async cleanOncallDismissals(): Promise<void> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace('T', ' ');
    try {
      const old = await this.pb
        .collection('oncall_dismissals')
        .getFullList({ filter: `created < "${sevenDaysAgo}"`, batch: 200 });
      if (old.length > 0) logger.info('Cleaning oncall dismissals', { expired: old.length });
      await this.batchDelete('oncall_dismissals', old);
    } catch (err) {
      logger.error('Oncall dismissals cleanup failed', { error: err });
    }
  }

  private async cleanConflictLog(): Promise<void> {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace('T', ' ');
    try {
      const old = await this.pb
        .collection('conflict_log')
        .getFullList({ filter: `created < "${ninetyDaysAgo}"`, batch: 200 });
      if (old.length > 0) logger.info('Cleaning conflict log', { expired: old.length });
      await this.batchDelete('conflict_log', old);
    } catch (err) {
      logger.error('Conflict log cleanup failed', { error: err });
    }
  }
}
