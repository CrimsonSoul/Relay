import { ipcMain } from 'electron';
import { IPC_CHANNELS, RELAY_APP_USER_EMAIL, type CachedQueryMembership } from '@shared/ipc';
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
import { KNOWLEDGE_CATEGORIES_COLLECTION, KNOWLEDGE_DOCUMENTS_COLLECTION } from '@shared/knowledge';
import { broadcastToAllWindows } from '../utils/broadcastToAllWindows';
import type { PendingMutationOverlay } from '@shared/ipc';
import { isOfflineWritableCollection } from '@shared/offlineCollections';
import { safePocketBaseAuthFailure } from '../app/pbErrors';
import { MIST_CLOUD_STATUS_COLLECTION } from './cloudStatus/CloudStatusSnapshotStore';

const VALID_COLLECTIONS = new Set([
  'contacts',
  'servers',
  'oncall',
  'bridge_groups',
  'bridge_history',
  'alert_history',
  'alert_reminders',
  'notes',
  'oncall_dismissals',
  'conflict_log',
  'oncall_board_settings',
  'cloud_status_snapshot',
  MIST_CLOUD_STATUS_COLLECTION,
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  KNOWLEDGE_CATEGORIES_COLLECTION,
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
const CACHE_QUERY_KEY_PATTERN = /^[0-9a-f]{16}$/;
const MAX_CACHE_RECORD_ID_BYTES = 512;

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

function isQueryMembershipWithinCacheLimit(
  membership: unknown,
): membership is CachedQueryMembership {
  if (!membership || typeof membership !== 'object' || Array.isArray(membership)) return false;
  const { recordIds, totalItems, complete } = membership as Partial<CachedQueryMembership>;
  if (!Array.isArray(recordIds) || recordIds.length > MAX_CACHE_RECORDS) return false;
  if (
    typeof totalItems !== 'number' ||
    !Number.isSafeInteger(totalItems) ||
    totalItems < recordIds.length ||
    typeof complete !== 'boolean'
  ) {
    return false;
  }
  let totalBytes = 0;
  for (const id of recordIds) {
    if (typeof id !== 'string' || id.trim().length === 0) return false;
    const bytes = Buffer.byteLength(id, 'utf8');
    if (bytes > MAX_CACHE_RECORD_ID_BYTES) return false;
    totalBytes += bytes;
    if (totalBytes > MAX_CACHE_SNAPSHOT_BYTES) return false;
  }
  return true;
}

function isValidCacheQuery(collection: unknown, queryKey: unknown): boolean {
  return (
    typeof collection === 'string' &&
    VALID_COLLECTIONS.has(collection) &&
    typeof queryKey === 'string' &&
    CACHE_QUERY_KEY_PATTERN.test(queryKey)
  );
}

function readableCacheRecords(
  collection: string,
  records: Record<string, unknown>[],
): Record<string, unknown>[] {
  if (collection !== KNOWLEDGE_DOCUMENTS_COLLECTION) return records;
  return records.filter(
    (record) => record.lifecycleState === undefined || record.lifecycleState === 'active',
  );
}

function pendingOverlays(changes: ReturnType<PendingChanges['getAll']>): PendingMutationOverlay[] {
  return changes.flatMap((change) => {
    const id = change.data?.id;
    if (typeof id !== 'string' || !isOfflineWritableCollection(change.collection)) return [];
    return [
      {
        collection: change.collection,
        action: change.action,
        record: { ...change.data, id },
      },
    ];
  });
}

const NOT_SIGNED_IN_ERROR = 'Relay is not signed in';
const REAUTH_FAILED_ERROR = 'Re-authentication failed';

/** Attributes the whole batch to one cause instead of letting each change carry
 *  a raw transport error, and returns that cause to the caller. */
function failPendingBatch(
  pending: PendingChanges,
  changes: ReturnType<PendingChanges['getAll']>,
  reason: string,
): string {
  for (const change of changes) pending.markFailure(change.id, reason);
  broadcastToAllWindows(IPC_CHANNELS.OFFLINE_PENDING_STATUS_CHANGED, {
    pendingCount: changes.length,
    issueCount: changes.length,
    lastError: reason,
  });
  return reason;
}

/** Resolves to null when the replay may proceed, or the reason it may not. */
async function ensureSyncAuthentication(
  sync: SyncManager,
  pending: PendingChanges,
  changes: ReturnType<PendingChanges['getAll']>,
  getAppConfig?: () => AppConfig | null,
): Promise<string | null> {
  if (sync.isAuthenticated()) return null;
  const config = getAppConfig?.()?.load();
  // An unauthenticated client with no readable secret — the config was cleared
  // mid-session, or its secret cannot be decrypted — cannot sign in at all.
  // Syncing anyway just fails every change with a raw PocketBase error that
  // names the symptom instead of the cause.
  if (!config?.secret) {
    loggers.sync.error('Pending sync skipped: no stored Relay credential');
    return failPendingBatch(pending, changes, NOT_SIGNED_IN_ERROR);
  }
  try {
    await sync.reauthenticate(RELAY_APP_USER_EMAIL, config.secret);
    loggers.sync.info('SyncManager re-authenticated');
    return null;
  } catch (authErr) {
    loggers.sync.error('SyncManager re-auth failed', {
      authFailure: safePocketBaseAuthFailure(authErr),
    });
    return failPendingBatch(pending, changes, REAUTH_FAILED_ERROR);
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
    const records = cache.readCollection(collection);
    return Array.isArray(records)
      ? readableCacheRecords(collection, records as Record<string, unknown>[])
      : [];
  });

  ipcMain.handle(IPC_CHANNELS.CACHE_QUERY_READ, (event, collection: string, queryKey: string) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.CACHE_QUERY_READ)) return null;
    if (!isValidCacheQuery(collection, queryKey)) {
      loggers.cache.error('CACHE_QUERY_READ: invalid query identity', { collection });
      return null;
    }
    return getCache()?.readQueryMembership(collection, queryKey) ?? null;
  });

  ipcMain.handle(
    IPC_CHANNELS.CACHE_QUERY_SNAPSHOT,
    (event, collection: string, queryKey: string, membership: CachedQueryMembership) => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.CACHE_QUERY_SNAPSHOT)) return;
      if (!isValidCacheQuery(collection, queryKey)) {
        loggers.cache.error('CACHE_QUERY_SNAPSHOT: invalid query identity', { collection });
        return;
      }
      if (!isQueryMembershipWithinCacheLimit(membership)) {
        loggers.cache.error('CACHE_QUERY_SNAPSHOT: invalid membership', { collection });
        return;
      }
      getCache()?.writeQueryMembership(collection, queryKey, membership);
    },
  );

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
      if (collection === KNOWLEDGE_DOCUMENTS_COLLECTION && record.lifecycleState === 'trashed') {
        cache.updateRecord(collection, 'delete', { id: record.id });
        return;
      }
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
      const readableRecords = readableCacheRecords(collection, records);
      if (!isSnapshotWithinCacheLimit(readableRecords)) {
        loggers.cache.error('CACHE_SNAPSHOT: records exceed cache size limit', {
          collection,
          count: records.length,
        });
        return;
      }
      const cache = getCache();
      if (!cache) return;
      const wrote = cache.writeCollection(collection, signature, readableRecords);
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

    const authFailure = await ensureSyncAuthentication(sync, pending, changes, getAppConfig);
    if (authFailure) {
      return {
        total: changes.length,
        conflicts: 0,
        errors: [authFailure],
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
