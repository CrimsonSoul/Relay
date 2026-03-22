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

  private async cleanBridgeHistory(): Promise<void> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace('T', ' ');
    try {
      const old = await this.pb
        .collection('bridge_history')
        .getFullList({ filter: `created < "${thirtyDaysAgo}"` });
      if (old.length > 0) logger.info('Cleaning bridge history', { expired: old.length });
      for (const record of old) await this.pb.collection('bridge_history').delete(record.id);
      const all = await this.pb.collection('bridge_history').getFullList({ sort: '-created' });
      const excess = all.slice(100);
      if (excess.length > 0) logger.info('Pruning bridge history excess', { count: excess.length });
      for (const record of excess) await this.pb.collection('bridge_history').delete(record.id);
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
        .getFullList({ filter: `pinned = false && created < "${ninetyDaysAgo}"` });
      if (old.length > 0) logger.info('Cleaning alert history', { expired: old.length });
      for (const record of old) await this.pb.collection('alert_history').delete(record.id);
      const unpinned = await this.pb
        .collection('alert_history')
        .getFullList({ filter: 'pinned = false', sort: '-created' });
      const unpinnedExcess = unpinned.slice(50);
      if (unpinnedExcess.length > 0)
        logger.info('Pruning unpinned alerts', { count: unpinnedExcess.length });
      for (const record of unpinnedExcess)
        await this.pb.collection('alert_history').delete(record.id);
      const pinned = await this.pb
        .collection('alert_history')
        .getFullList({ filter: 'pinned = true', sort: '-created' });
      const pinnedExcess = pinned.slice(100);
      if (pinnedExcess.length > 0)
        logger.info('Pruning pinned alerts', { count: pinnedExcess.length });
      for (const record of pinnedExcess)
        await this.pb.collection('alert_history').delete(record.id);
    } catch (err) {
      logger.error('Alert history cleanup failed', { error: err });
    }
  }

  private async cleanConflictLog(): Promise<void> {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace('T', ' ');
    try {
      const old = await this.pb
        .collection('conflict_log')
        .getFullList({ filter: `created < "${ninetyDaysAgo}"` });
      if (old.length > 0) logger.info('Cleaning conflict log', { expired: old.length });
      for (const record of old) await this.pb.collection('conflict_log').delete(record.id);
    } catch (err) {
      logger.error('Conflict log cleanup failed', { error: err });
    }
  }
}
