import { ipcMain } from 'electron';
import { IPC_CHANNELS, RELAY_APP_USER_EMAIL } from '@shared/ipc';
import type { OfflineCache } from '../cache/OfflineCache';
import type { PendingChanges } from '../cache/PendingChanges';
import type { SyncManager } from '../cache/SyncManager';
import type { AppConfig } from '../config/AppConfig';
import { loggers } from '../logger';
import { assertTrustedIpcSender } from '../utils/trustedSender';
import {
  DYNATRACE_PROBLEMS_COLLECTION,
  DYNATRACE_PROBLEM_NOTES_COLLECTION,
  DYNATRACE_PROBLEM_STATES_COLLECTION,
  DYNATRACE_PROBLEM_SYNC_COLLECTION,
} from '@shared/dynatraceProblems';
import { RELAY_OPERATORS_COLLECTION } from '@shared/operators';
import { broadcastToAllWindows } from '../utils/broadcastToAllWindows';
import type { PendingMutationOverlay, OfflineWritableCollection } from '@shared/ipc';

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
  'cloud_status_snapshot',
  RELAY_OPERATORS_COLLECTION,
  DYNATRACE_PROBLEMS_COLLECTION,
  DYNATRACE_PROBLEM_STATES_COLLECTION,
  DYNATRACE_PROBLEM_NOTES_COLLECTION,
  DYNATRACE_PROBLEM_SYNC_COLLECTION,
]);

const VALID_ACTIONS = new Set(['create', 'update', 'delete']);
const MAX_CACHE_RECORDS = 10_000;
const MAX_CACHE_RECORD_BYTES = 256 * 1024;
const MAX_CACHE_SNAPSHOT_BYTES = 10 * 1024 * 1024;
const CACHE_SIGNATURE_PATTERN = /^\d{1,5}:[0-9a-f]{16}$/;

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

function pendingOverlays(changes: ReturnType<PendingChanges['getAll']>): PendingMutationOverlay[] {
  return changes.flatMap((change) => {
    const id = change.data?.id;
    if (typeof id !== 'string' || !WRITABLE_CACHE_COLLECTIONS.has(change.collection)) return [];
    return [
      {
        collection: change.collection as OfflineWritableCollection,
        action: change.action,
        record: { ...change.data, id },
      },
    ];
  });
}

// Only user-authored pending mutations may become optimistic renderer overlays.
// Realtime cache ingestion is separately restricted by VALID_COLLECTIONS.
const WRITABLE_CACHE_COLLECTIONS = new Set<string>([
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
  'oncall_board_settings',
  DYNATRACE_PROBLEM_STATES_COLLECTION,
  DYNATRACE_PROBLEM_NOTES_COLLECTION,
]);

async function ensureSyncAuthentication(
  sync: SyncManager,
  pending: PendingChanges,
  changes: ReturnType<PendingChanges['getAll']>,
  getAppConfig?: () => AppConfig | null,
): Promise<boolean> {
  if (sync.isAuthenticated()) return true;
  const config = getAppConfig?.()?.load();
  if (!config?.secret) return true;
  try {
    await sync.reauthenticate(RELAY_APP_USER_EMAIL, config.secret);
    loggers.sync.info('SyncManager re-authenticated');
    return true;
  } catch (authErr) {
    loggers.sync.error('SyncManager re-auth failed', { error: authErr });
    for (const change of changes) pending.markFailure(change.id, 'Re-authentication failed');
    broadcastToAllWindows(IPC_CHANNELS.OFFLINE_PENDING_STATUS_CHANGED, {
      pendingCount: changes.length,
      issueCount: changes.length,
      lastError: 'Re-authentication failed',
    });
    return false;
  }
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
      // This channel persists trusted realtime events locally. User/offline server mutations
      // use OFFLINE_MUTATE and its narrower writable-collection allowlist.
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
    (event, collection: string, signature: string, records: Record<string, unknown>[]) => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.CACHE_SNAPSHOT)) return;
      if (typeof collection !== 'string' || !VALID_COLLECTIONS.has(collection)) {
        loggers.cache.error('CACHE_SNAPSHOT: invalid collection', { collection });
        return;
      }
      if (typeof signature !== 'string' || !CACHE_SIGNATURE_PATTERN.test(signature)) {
        loggers.cache.error('CACHE_SNAPSHOT: invalid revision signature');
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
      const wrote = cache.writeCollection(collection, signature, records);
      const config = getAppConfig?.()?.load();
      if (wrote !== false && config?.mode === 'client') {
        const existing = cache.getUsableCacheMarker();
        cache.setUsableCacheMarker(
          config.serverUrl,
          existing?.authenticatedAt ?? Date.now(),
          Date.now(),
        );
      }
    },
  );

  let syncPendingInFlight: Promise<unknown> | null = null;
  const runPendingSync = async () => {
    const pending = getPendingChanges?.();
    const sync = getSyncManager?.();
    if (!pending || !sync) return { total: 0, conflicts: 0, errors: [] };

    const changes = pending.getAll();
    if (changes.length === 0) return { total: 0, conflicts: 0, errors: [] };

    if (!(await ensureSyncAuthentication(sync, pending, changes, getAppConfig))) {
      return {
        total: changes.length,
        conflicts: 0,
        errors: ['Re-authentication failed'],
        remaining: changes.length,
        remainingChanges: pendingOverlays(changes),
      };
    }

    loggers.sync.info('Syncing pending changes on reconnect', { count: changes.length });
    const result = await sync.syncAll(changes);
    // Remove exactly what synced — never bulk-clear, which would also delete
    // changes enqueued while syncAll was awaiting the network.
    for (const id of result.synced) {
      pending.remove(id);
    }
    for (const id of result.conflicted ?? []) pending.markFailure(id, 'Server conflict');
    for (const failure of result.failed) pending.markFailure(failure.changeId, failure.error);
    const remaining = pending.count();
    const remainingChanges = remaining > 0 ? pendingOverlays(pending.getAll()) : [];
    const issues = pending.getAll().filter((change) => change.syncError);
    broadcastToAllWindows(IPC_CHANNELS.OFFLINE_PENDING_STATUS_CHANGED, {
      pendingCount: remaining,
      ...(issues.length > 0
        ? { issueCount: issues.length, lastError: issues.at(-1)?.syncError }
        : {}),
    });
    loggers.sync.info('Pending changes synced', result);
    return {
      ...result,
      ...(remaining > 0 ? { remaining, remainingChanges } : {}),
    };
  };

  ipcMain.handle(IPC_CHANNELS.SYNC_PENDING, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.SYNC_PENDING)) {
      return { total: 0, conflicts: 0, errors: [] };
    }
    if (syncPendingInFlight) return syncPendingInFlight;
    syncPendingInFlight = runPendingSync().finally(() => {
      syncPendingInFlight = null;
    });
    return syncPendingInFlight;
  });
}
