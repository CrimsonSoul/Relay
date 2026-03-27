import type PocketBase from 'pocketbase';
import { loggers } from '../logger';

const logger = loggers.retention;

export class RetentionManager {
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private pb: PocketBase) {}

  async runCleanup(): Promise<void> {
    await this.cleanBridgeHistory();
    await this.cleanAlertHistory();
    await this.cleanConflictLog();
    await this.cleanOncallDismissals();
    logger.info('Retention cleanup complete');
  }

  startSchedule(intervalMs = 24 * 60 * 60 * 1000): void {
    void this.runCleanup();
    this.interval = setInterval(() => {
      void this.runCleanup();
    }, intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
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
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace('T', ' ');
    try {
      const old = await this.pb
        .collection('alert_history')
        .getFullList({ filter: `pinned = false && created < "${ninetyDaysAgo}"`, batch: 200 });
      if (old.length > 0) logger.info('Cleaning alert history', { expired: old.length });
      await this.batchDelete('alert_history', old);
      const unpinned = await this.pb
        .collection('alert_history')
        .getFullList({ filter: 'pinned = false', sort: '-created', batch: 200 });
      const unpinnedExcess = unpinned.slice(50);
      if (unpinnedExcess.length > 0)
        logger.info('Pruning unpinned alerts', { count: unpinnedExcess.length });
      await this.batchDelete('alert_history', unpinnedExcess);
      const pinned = await this.pb
        .collection('alert_history')
        .getFullList({ filter: 'pinned = true', sort: '-created', batch: 200 });
      const pinnedExcess = pinned.slice(100);
      if (pinnedExcess.length > 0)
        logger.info('Pruning pinned alerts', { count: pinnedExcess.length });
      await this.batchDelete('alert_history', pinnedExcess);
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
