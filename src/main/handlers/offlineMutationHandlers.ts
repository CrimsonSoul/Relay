import { randomBytes, randomUUID } from 'node:crypto';
import { ipcMain } from 'electron';
import {
  IPC_CHANNELS,
  type OfflineMutationApplied,
  type OfflineMutationInput,
  type OfflineMutationResult,
  type OfflineWritableCollection,
} from '@shared/ipc';
import type { AppConfig } from '../config/AppConfig';
import type { OfflineCache } from '../cache/OfflineCache';
import type { PendingChanges } from '../cache/PendingChanges';
import { assertTrustedIpcSender } from '../utils/trustedSender';
import { broadcastToAllWindows } from '../utils/broadcastToAllWindows';

const MAX_MUTATION_BYTES = 256 * 1024;
const RECORD_ID_PATTERN = /^[a-z0-9]{15}$/;
const WRITABLE_COLLECTIONS = new Set<OfflineWritableCollection>([
  'contacts',
  'servers',
  'oncall',
  'bridge_groups',
  'bridge_history',
  'alert_history',
  'alert_reminders',
  'notes',
  'oncall_dismissals',
  'oncall_board_settings',
  'dynatrace_problem_states',
  'dynatrace_problem_notes',
]);

function newRecordId(): string {
  return randomBytes(8).toString('hex').slice(0, 15);
}

function invalidInput(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Invalid mutation';
  const candidate = input as Partial<OfflineMutationInput>;
  if (!candidate.collection || !WRITABLE_COLLECTIONS.has(candidate.collection)) {
    return 'Collection is not available offline';
  }
  if (!candidate.action || !['create', 'update', 'delete'].includes(candidate.action)) {
    return 'Invalid mutation action';
  }
  if (candidate.action !== 'create' && !RECORD_ID_PATTERN.test(candidate.recordId ?? '')) {
    return 'Invalid record ID';
  }
  if (candidate.recordId && !RECORD_ID_PATTERN.test(candidate.recordId)) return 'Invalid record ID';
  if (
    (candidate.action === 'create' || candidate.action === 'update') &&
    (!candidate.data || typeof candidate.data !== 'object' || Array.isArray(candidate.data))
  ) {
    return 'Mutation data is required';
  }
  if (candidate.action === 'delete' && candidate.data !== undefined) {
    return 'Delete mutations cannot include data';
  }
  if (
    candidate.data !== undefined &&
    (!candidate.data || typeof candidate.data !== 'object' || Array.isArray(candidate.data))
  ) {
    return 'Invalid mutation data';
  }
  try {
    if (Buffer.byteLength(JSON.stringify(candidate.data ?? {}), 'utf8') > MAX_MUTATION_BYTES) {
      return 'Mutation exceeds size limit';
    }
  } catch {
    return 'Mutation data is not serializable';
  }
  return null;
}

function optimisticRecord(
  cache: OfflineCache,
  input: OfflineMutationInput,
): { record: Record<string, unknown> & { id: string }; baseUpdated: string } {
  const id = input.recordId ?? newRecordId();
  const existing =
    input.action !== 'create'
      ? cache.readCollection(input.collection).find((record) => record.id === id)
      : undefined;
  const baseUpdated = typeof existing?.updated === 'string' ? existing.updated : '';
  if (input.action === 'delete') return { record: { id }, baseUpdated };
  const now = new Date().toISOString();
  return {
    record: {
      ...(existing ?? {}),
      ...(input.data ?? {}),
      id,
      created: existing?.created ?? now,
      updated: now,
    },
    baseUpdated,
  };
}

export function setupOfflineMutationHandlers(
  getCache: () => OfflineCache | null,
  getPendingChanges: () => PendingChanges | null,
  getAppConfig: () => AppConfig | null,
): void {
  ipcMain.handle(IPC_CHANNELS.OFFLINE_PENDING_STATUS, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.OFFLINE_PENDING_STATUS)) {
      return { pendingCount: 0 };
    }
    const changes = getPendingChanges()?.getAll() ?? [];
    const issues = changes.filter((change) => change.syncError);
    return {
      pendingCount: changes.length,
      ...(issues.length > 0
        ? { issueCount: issues.length, lastError: issues.at(-1)?.syncError }
        : {}),
    };
  });

  ipcMain.handle(
    IPC_CHANNELS.OFFLINE_MUTATE,
    (event, input: OfflineMutationInput): OfflineMutationResult => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.OFFLINE_MUTATE)) {
        return { ok: false, error: 'Untrusted mutation request' };
      }
      const validationError = invalidInput(input);
      if (validationError) return { ok: false, error: validationError };
      if (getAppConfig()?.load()?.mode !== 'client') {
        return { ok: false, error: 'Offline mutations are only available on Relay clients' };
      }
      const cache = getCache();
      const pending = getPendingChanges();
      if (!cache || !pending) return { ok: false, error: 'Offline storage is unavailable' };

      try {
        const { record, baseUpdated } = optimisticRecord(cache, input);
        if (
          cache.applyOfflineMutationAtomically(
            input.collection,
            input.action,
            record,
            baseUpdated,
          ) === false
        ) {
          throw new Error('Failed to persist the optimistic cache update');
        }
        const applied: OfflineMutationApplied = {
          mutationId: randomUUID(),
          collection: input.collection,
          action: input.action,
          record,
          pendingCount: pending.count(),
        };
        broadcastToAllWindows(IPC_CHANNELS.OFFLINE_MUTATION_APPLIED, applied);
        broadcastToAllWindows(IPC_CHANNELS.OFFLINE_PENDING_STATUS_CHANGED, {
          pendingCount: applied.pendingCount,
        });
        return { ok: true, ...applied };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : 'Failed to save offline change',
        };
      }
    },
  );
}
