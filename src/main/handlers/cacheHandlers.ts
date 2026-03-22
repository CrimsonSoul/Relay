import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import type { OfflineCache } from '../cache/OfflineCache';
import type { PendingChanges } from '../cache/PendingChanges';
import type { SyncManager } from '../cache/SyncManager';
import type { AppConfig } from '../config/AppConfig';
import { loggers } from '../logger';

export function setupCacheHandlers(
  getCache: () => OfflineCache | null,
  getPendingChanges?: () => PendingChanges | null,
  getSyncManager?: () => SyncManager | null,
  getAppConfig?: () => AppConfig | null,
): void {
  ipcMain.handle(IPC_CHANNELS.CACHE_READ, (_event, collection: string) => {
    const cache = getCache();
    if (!cache) return [];
    return cache.readCollection(collection);
  });

  ipcMain.handle(
    IPC_CHANNELS.CACHE_WRITE,
    (_event, collection: string, action: string, record: Record<string, unknown>) => {
      const cache = getCache();
      if (!cache) return;
      cache.updateRecord(collection, action as 'create' | 'update' | 'delete', record);
    },
  );

  ipcMain.handle(IPC_CHANNELS.SYNC_PENDING, async () => {
    const pending = getPendingChanges?.();
    const sync = getSyncManager?.();
    if (!pending || !sync) return { total: 0, conflicts: 0, errors: [] };

    const changes = pending.getAll();
    if (changes.length === 0) return { total: 0, conflicts: 0, errors: [] };

    // Re-authenticate the SyncManager's PB client if the token has expired.
    // Without this, long-running client-mode sessions would permanently fail to sync.
    if (!sync.pb.authStore.isValid) {
      const config = getAppConfig?.()?.load();
      if (config?.secret) {
        try {
          await sync.pb
            .collection('_pb_users_auth_')
            .authWithPassword('relay@relay.app', config.secret);
          loggers.sync.info('SyncManager re-authenticated');
        } catch (authErr) {
          loggers.sync.error('SyncManager re-auth failed', { error: authErr });
          return { total: changes.length, conflicts: 0, errors: ['Re-authentication failed'] };
        }
      }
    }

    loggers.sync.info('Syncing pending changes on reconnect', { count: changes.length });
    const result = await sync.syncAll(changes);
    // Only clear successfully synced changes — failed ones stay queued for next attempt
    if (result.errors.length === 0) {
      pending.clear();
    } else {
      // Remove only the changes that didn't fail (total - errors)
      const failedPattern = /Failed to sync (\S+)/;
      const failedIndices = new Set(
        result.errors.map((e) => {
          const match = failedPattern.exec(e);
          return match?.[1];
        }),
      );
      for (const change of changes) {
        const key = `${change.collection}/${change.action}`;
        if (!failedIndices.has(key)) {
          pending.remove(change.id);
        }
      }
    }
    loggers.sync.info('Pending changes synced', result);
    return result;
  });
}
