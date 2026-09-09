import { randomUUID } from 'node:crypto';
import { ipcMain } from 'electron';
import {
  IPC_CHANNELS,
  type PendingChangeSummary,
  type PendingChangesRequest,
  type PendingChangesResponse,
  type PendingMutationOverlay,
} from '@shared/ipc';
import { isOfflineWritableCollection } from '@shared/offlineCollections';
import type { OfflineCache } from '../cache/OfflineCache';
import type { PendingChange, PendingChanges } from '../cache/PendingChanges';
import { fingerprintRecord, type SyncManager } from '../cache/SyncManager';
import { assertTrustedIpcSender } from '../utils/trustedSender';
import { broadcastToAllWindows } from '../utils/broadcastToAllWindows';

const STALE = 'This change or connection has changed. Review it again before resolving.';
const UNAVAILABLE = 'Current server values are unavailable. Check the connection and review again.';
const MAX_BYTES = 256 * 1024;
const protectedFields = new Set([
  'id',
  'created',
  'updated',
  'queuedAt',
  'collectionId',
  'collectionName',
  'expand',
]);

function validRequest(value: unknown): value is PendingChangesRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) return false;
  } catch {
    return false;
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (input.action === 'list')
    return (
      keys.every((key) => ['action', 'afterId'].includes(key)) &&
      (input.afterId === undefined ||
        (Number.isSafeInteger(input.afterId) && Number(input.afterId) >= 0))
    );
  if (input.action === 'review')
    return (
      keys.every((key) => ['action', 'id'].includes(key)) &&
      Number.isSafeInteger(input.id) &&
      Number(input.id) > 0
    );
  if (
    input.action !== 'resolve' ||
    !keys.every((key) => ['action', 'token', 'resolution', 'edits'].includes(key))
  )
    return false;
  if (
    typeof input.token !== 'string' ||
    input.token.length !== 36 ||
    !['server', 'retry'].includes(String(input.resolution))
  )
    return false;
  if (input.edits === undefined) return true;
  if (
    input.resolution !== 'retry' ||
    !input.edits ||
    typeof input.edits !== 'object' ||
    Array.isArray(input.edits)
  )
    return false;
  return Object.entries(input.edits).every(
    ([key, value]) =>
      !protectedFields.has(key) &&
      (typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))),
  );
}

function summary(change: PendingChange): PendingChangeSummary {
  const label = [change.data.name, change.data.title, change.data.team].find(
    (value) => typeof value === 'string' && value.trim(),
  );
  let reason = 'Waiting to sync';
  if (change.syncError) reason = 'Could not save. Retry or review current server values.';
  if (change.syncError === 'Server conflict') reason = 'Server conflict';
  return {
    id: change.id,
    collection: change.collection,
    action: change.action,
    recordId: String(change.data.id).slice(0, 512),
    label: typeof label === 'string' ? label.slice(0, 200) : String(change.data.id).slice(0, 200),
    reason,
  };
}

export function pendingOverlays(
  changes: ReturnType<PendingChanges['getAll']>,
): PendingMutationOverlay[] {
  return changes.flatMap((change) => {
    const id = change.data?.id;
    if (typeof id !== 'string' || !isOfflineWritableCollection(change.collection)) return [];
    return [
      {
        collection: change.collection,
        action: change.action,
        record: {
          ...change.data,
          id,
          ...(change.collection === 'oncall' && change.action !== 'delete'
            ? {
                updated: change.baseUpdated ?? '',
                queuedAt: new Date(change.timestamp).toISOString(),
              }
            : {}),
        },
      },
    ];
  });
}

export function publishPendingReconciliation(
  cache: OfflineCache,
  pending: PendingChanges,
  change: PendingChange,
): void {
  if (!isOfflineWritableCollection(change.collection)) return;
  const id = String(change.data.id);
  const record = cache.readCollection(change.collection).find((item) => item.id === id);
  broadcastToAllWindows(IPC_CHANNELS.OFFLINE_MUTATION_APPLIED, {
    mutationId: randomUUID(),
    collection: change.collection,
    action: record ? 'update' : 'delete',
    record: record ?? { id },
    pendingCount: pending.count(),
    reconciled: true,
  });
}

export function publishPendingStatus(pending: PendingChanges): void {
  const changes = pending.getAll();
  const issues = changes.filter((change) => change.syncError);
  broadcastToAllWindows(IPC_CHANNELS.OFFLINE_PENDING_STATUS_CHANGED, {
    pendingCount: changes.length,
    issueCount: issues.length,
    ...(issues.length ? { lastError: summary(issues.at(-1)!).reason } : {}),
  });
}

type Review = {
  change: PendingChange;
  server: Record<string, unknown> | null;
  cache: OfflineCache;
  pending: PendingChanges;
  sync: SyncManager;
  expires: number;
};

export function setupPendingRecoveryHandlers(options: {
  getCache: () => OfflineCache | null;
  getPending: () => PendingChanges | null | undefined;
  getSync: () => SyncManager | null | undefined;
  authenticate: (
    sync: SyncManager,
    pending: PendingChanges,
    changes: PendingChange[],
  ) => Promise<string | null>;
  busy: () => boolean;
  exclusive: (operation: () => Promise<PendingChangesResponse>) => Promise<PendingChangesResponse>;
  syncOne: (id: number) => Promise<unknown>;
}): void {
  const reviews = new Map<string, Review>();
  const current = (review: Review) =>
    options.getCache() === review.cache &&
    options.getPending() === review.pending &&
    options.getSync() === review.sync &&
    review.expires > Date.now() &&
    review.pending
      .getAllStrict()
      .some((change) => change.id === review.change.id && change.version === review.change.version);

  const inspect = async (id: number): Promise<PendingChangesResponse> => {
    const cache = options.getCache();
    const pending = options.getPending();
    const sync = options.getSync();
    if (!cache || !pending || !sync) return { ok: false, error: UNAVAILABLE };
    const change = pending.getAllStrict().find((entry) => entry.id === id);
    if (
      !change ||
      !isOfflineWritableCollection(change.collection) ||
      typeof change.data.id !== 'string' ||
      !/^[a-z0-9]{15}$/.test(change.data.id)
    )
      return { ok: false, error: STALE };
    if (Buffer.byteLength(JSON.stringify(change.data)) > MAX_BYTES)
      return {
        ok: false,
        error: 'This record is too large to review here. The local change is retained.',
      };
    const held: Review = {
      change,
      cache,
      pending,
      sync,
      server: null,
      expires: Date.now() + 10 * 60_000,
    };
    const entry = summary(change);
    try {
      if (await options.authenticate(sync, pending, [change])) throw new Error(UNAVAILABLE);
      held.server = await sync.readServer(change.collection, String(change.data.id));
      if (!current(held)) return { ok: false, error: STALE };
      if (
        Buffer.byteLength(JSON.stringify(held.server)) > MAX_BYTES ||
        Buffer.byteLength(JSON.stringify(change.data)) > MAX_BYTES
      )
        return {
          ok: false,
          error: 'This record is too large to review here. The local change is retained.',
        };
      for (const [token, item] of reviews) if (item.expires <= Date.now()) reviews.delete(token);
      if (reviews.size >= 32) reviews.delete(reviews.keys().next().value!);
      const token = randomUUID();
      reviews.set(token, held);
      return {
        ok: true,
        review: {
          entry,
          local: change.data,
          server: held.server,
          serverState: held.server ? 'present' : 'deleted',
          token,
        },
      };
    } catch {
      return {
        ok: true,
        review: { entry, local: change.data, server: null, serverState: 'unavailable' },
      };
    }
  };

  const resolve = async (
    input: Extract<PendingChangesRequest, { action: 'resolve' }>,
  ): Promise<PendingChangesResponse> => {
    const held = reviews.get(input.token);
    if (!held || !current(held)) return { ok: false, error: STALE };
    const { pending, cache, change, server } = held;
    if (input.resolution === 'server') {
      const latestServer = await held.sync.readServer(change.collection, String(change.data.id));
      if (!current(held)) return { ok: false, error: STALE };
      if (!cache.completePendingChange(change, latestServer)) return { ok: false, error: STALE };
      reviews.delete(input.token);
      publishPendingReconciliation(cache, pending, change);
      publishPendingStatus(pending);
      return {
        ok: true,
        resolved: true,
        remainingChanges: pendingOverlays(pending.getAllStrict()),
      };
    }
    if (!server)
      return {
        ok: false,
        error:
          'This record was deleted on the server. Use server version to discard the local change.',
      };
    if (typeof server.updated !== 'string' || !Number.isFinite(Date.parse(server.updated)))
      return { ok: false, error: UNAVAILABLE };
    for (const [key, value] of Object.entries(input.edits ?? {})) {
      if (!Object.hasOwn(change.data, key) || typeof change.data[key] !== typeof value)
        return { ok: false, error: 'Only existing scalar fields can be edited here.' };
    }
    const edited = { ...change.data, ...input.edits };
    if (Buffer.byteLength(JSON.stringify(edited)) > MAX_BYTES)
      return {
        ok: false,
        error: 'Edited values exceed the record size limit. Your saved local change is retained.',
      };
    if (!cache.prepareReviewedChange(change, edited, server.updated, fingerprintRecord(server)))
      return { ok: false, error: STALE };
    reviews.delete(input.token);
    publishPendingReconciliation(cache, pending, change);
    await options.syncOne(change.id);
    if (
      options.getCache() !== cache ||
      options.getPending() !== pending ||
      options.getSync() !== held.sync
    )
      return { ok: false, error: STALE };
    const remaining = pending.getAllStrict();
    return {
      ok: true,
      resolved: !remaining.some((entry) => entry.id === change.id),
      remainingChanges: pendingOverlays(remaining),
    };
  };

  ipcMain.handle(
    IPC_CHANNELS.PENDING_CHANGES,
    async (event, input: unknown): Promise<PendingChangesResponse> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.PENDING_CHANGES))
        return { ok: false, error: 'Untrusted pending-change request' };
      if (!validRequest(input)) return { ok: false, error: 'Invalid pending-change request' };
      try {
        if (input.action === 'list') {
          const entries = (options.getPending()?.getAllStrict() ?? []).filter(
            (entry) =>
              entry.id > (input.afterId ?? 0) && isOfflineWritableCollection(entry.collection),
          );
          return {
            ok: true,
            entries: entries.slice(0, 25).map(summary),
            ...(entries.length > 25 ? { nextAfterId: entries[24]!.id } : {}),
          };
        }
        if (options.busy())
          return {
            ok: false,
            error: 'Sync is in progress. Wait for it to finish, then review again.',
          };
        if (input.action === 'review') return await inspect(input.id);
        return await options.exclusive(() => resolve(input));
      } catch {
        return {
          ok: false,
          error: 'The change could not be resolved. Review it again; unsaved work remains queued.',
        };
      }
    },
  );
}
