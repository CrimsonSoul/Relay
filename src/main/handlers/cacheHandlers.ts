import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import type { OfflineCache } from '../cache/OfflineCache';
import type { PendingChanges } from '../cache/PendingChanges';
import type { SyncManager } from '../cache/SyncManager';
import type { AppConfig } from '../config/AppConfig';
import { loggers } from '../logger';

const VALID_COLLECTIONS = new Set([
  'contacts',
  'servers',
  'oncall',
  'bridge_groups',
  'bridge_history',
  'alert_history',
  'notes',
  'standalone_notes',
  'oncall_dismissals',
  'conflict_log',
  'oncall_board_settings',
]);

const VALID_ACTIONS = new Set(['create', 'update', 'delete']);

export function setupCacheHandlers(
  getCache: () => OfflineCache | null,
  getPendingChanges?: () => PendingChanges | null,
  getSyncManager?: () => SyncManager | null,
  getAppConfig?: () => AppConfig | null,
): void {
  ipcMain.handle(IPC_CHANNELS.CACHE_READ, (_event, collection: string) => {
    if (typeof collection !== 'string' || !VALID_COLLECTIONS.has(collection)) {
      loggers.cache.error('CACHE_READ: invalid collection', { collection });
      return [];
    }
    const cache = getCache();
    if (!cache) return [];
    return cache.readCollection(collection);
  });

  ipcMain.handle(
    IPC_CHANNELS.CACHE_WRITE,
    (_event, collection: string, action: string, record: Record<string, unknown>) => {
      if (typeof collection !== 'string' || !VALID_COLLECTIONS.has(collection)) {
        loggers.cache.error('CACHE_WRITE: invalid collection', { collection });
        return;
      }
      if (typeof action !== 'string' || !VALID_ACTIONS.has(action)) {
        loggers.cache.error('CACHE_WRITE: invalid action', { action });
        return;
      }
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        loggers.cache.error('CACHE_WRITE: invalid record', { record: typeof record });
        return;
      }
      const cache = getCache();
      if (!cache) return;
      cache.updateRecord(collection, action as 'create' | 'update' | 'delete', record);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CACHE_SNAPSHOT,
    (_event, collection: string, records: Record<string, unknown>[]) => {
      if (typeof collection !== 'string' || !VALID_COLLECTIONS.has(collection)) {
        loggers.cache.error('CACHE_SNAPSHOT: invalid collection', { collection });
        return;
      }
      if (!Array.isArray(records)) {
        loggers.cache.error('CACHE_SNAPSHOT: records is not an array', { records: typeof records });
        return;
      }
      const cache = getCache();
      if (!cache) return;
      cache.writeCollection(collection, records);
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
    if (!sync.isAuthenticated()) {
      const config = getAppConfig?.()?.load();
      if (config?.secret) {
        try {
          await sync.reauthenticate('relay@relay.app', config.secret);
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
    if (result.failed.length === 0) {
      pending.clear();
    } else {
      // Remove only the changes that synced successfully
      const failedIds = new Set(result.failed.map((f) => f.changeId));
      for (const change of changes) {
        if (!failedIds.has(change.id)) {
          pending.remove(change.id);
        }
      }
    }
    loggers.sync.info('Pending changes synced', result);
    return result;
  });
}
