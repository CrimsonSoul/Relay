import { ipcMain } from 'electron';
import { IPC_CHANNELS, RELAY_APP_USER_EMAIL } from '@shared/ipc';
import type { OfflineCache } from '../cache/OfflineCache';
import type { PendingChanges } from '../cache/PendingChanges';
import type { SyncManager } from '../cache/SyncManager';
import type { AppConfig } from '../config/AppConfig';
import { loggers } from '../logger';
import { assertTrustedIpcSender } from '../utils/trustedSender';

const VALID_COLLECTIONS = new Set([
  'contacts',
  'servers',
  'oncall',
  'bridge_groups',
  'bridge_history',
  'alert_history',
  'alert_reminders',
  'notes',
  'standalone_notes',
  'oncall_dismissals',
  'conflict_log',
  'oncall_board_settings',
]);

const VALID_ACTIONS = new Set(['create', 'update', 'delete']);
const MAX_CACHE_RECORDS = 10_000;
const MAX_CACHE_RECORD_BYTES = 256 * 1024;
const MAX_CACHE_SNAPSHOT_BYTES = 10 * 1024 * 1024;

const hasNonEmptyStringId = (record: unknown): record is Record<string, unknown> & { id: string } =>
  !!record &&
  typeof record === 'object' &&
  !Array.isArray(record) &&
  typeof (record as { id?: unknown }).id === 'string' &&
  (record as { id: string }).id.trim().length > 0;

function serializedByteLength(value: unknown): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return null;
  }
}

function isRecordWithinCacheLimit(record: Record<string, unknown>): boolean {
  const bytes = serializedByteLength(record);
  return bytes !== null && bytes <= MAX_CACHE_RECORD_BYTES;
}

function isSnapshotWithinCacheLimit(records: Record<string, unknown>[]): boolean {
  if (records.length > MAX_CACHE_RECORDS) return false;

  let totalBytes = 0;
  for (const record of records) {
    const bytes = serializedByteLength(record);
    if (bytes === null || bytes > MAX_CACHE_RECORD_BYTES) return false;
    totalBytes += bytes;
    if (totalBytes > MAX_CACHE_SNAPSHOT_BYTES) return false;
  }

  return true;
}

export function setupCacheHandlers(
  getCache: () => OfflineCache | null,
  getPendingChanges?: () => PendingChanges | null,
  getSyncManager?: () => SyncManager | null,
  getAppConfig?: () => AppConfig | null,
): void {
  ipcMain.handle(IPC_CHANNELS.CACHE_READ, (event, collection: string) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.CACHE_READ)) return [];
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
    (event, collection: string, action: string, record: Record<string, unknown>) => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.CACHE_WRITE)) return;
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
      if (!hasNonEmptyStringId(record)) {
        loggers.cache.error('CACHE_WRITE: record missing valid id', {
          idType: typeof (record as { id?: unknown }).id,
        });
        return;
      }
      if (!isRecordWithinCacheLimit(record)) {
        loggers.cache.error('CACHE_WRITE: record exceeds cache size limit', { id: record.id });
        return;
      }
      const cache = getCache();
      if (!cache) return;
      cache.updateRecord(collection, action as 'create' | 'update' | 'delete', record);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.CACHE_SNAPSHOT,
    (event, collection: string, records: Record<string, unknown>[]) => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.CACHE_SNAPSHOT)) return;
      if (typeof collection !== 'string' || !VALID_COLLECTIONS.has(collection)) {
        loggers.cache.error('CACHE_SNAPSHOT: invalid collection', { collection });
        return;
      }
      if (!Array.isArray(records)) {
        loggers.cache.error('CACHE_SNAPSHOT: records is not an array', { records: typeof records });
        return;
      }
      if (!records.every(hasNonEmptyStringId)) {
        loggers.cache.error('CACHE_SNAPSHOT: records contain invalid ids');
        return;
      }
      if (!isSnapshotWithinCacheLimit(records)) {
        loggers.cache.error('CACHE_SNAPSHOT: records exceed cache size limit', {
          collection,
          count: records.length,
        });
        return;
      }
      const cache = getCache();
      if (!cache) return;
      cache.writeCollection(collection, records);
    },
  );

  ipcMain.handle(IPC_CHANNELS.SYNC_PENDING, async (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.SYNC_PENDING)) {
      return { total: 0, conflicts: 0, errors: [] };
    }
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
          await sync.reauthenticate(RELAY_APP_USER_EMAIL, config.secret);
          loggers.sync.info('SyncManager re-authenticated');
        } catch (authErr) {
          loggers.sync.error('SyncManager re-auth failed', { error: authErr });
          return { total: changes.length, conflicts: 0, errors: ['Re-authentication failed'] };
        }
      }
    }

    loggers.sync.info('Syncing pending changes on reconnect', { count: changes.length });
    const result = await sync.syncAll(changes);
    // Remove exactly what synced — never bulk-clear, which would also delete
    // changes enqueued while syncAll was awaiting the network.
    for (const id of result.synced) {
      pending.remove(id);
    }
    loggers.sync.info('Pending changes synced', result);
    return result;
  });
}
