import { IPC_CHANNELS, type PendingSyncStatus } from '@shared/ipc';
import type { PendingChanges } from '../cache/PendingChanges';
import { broadcastToAllWindows } from '../utils/broadcastToAllWindows';

/** The whole queue's sync status; every pending-status read and broadcast uses this shape. */
export function readPendingSyncStatus(pending: PendingChanges | null): PendingSyncStatus {
  const changes = pending?.getAll() ?? [];
  const issues = changes.filter((change) => change.syncError);
  const lastError = issues.at(-1)?.syncError;
  return {
    pendingCount: changes.length,
    ...(issues.length > 0 ? { issueCount: issues.length } : {}),
    ...(lastError ? { lastError } : {}),
  };
}

export function publishPendingSyncStatus(pending: PendingChanges): void {
  broadcastToAllWindows(
    IPC_CHANNELS.OFFLINE_PENDING_STATUS_CHANGED,
    readPendingSyncStatus(pending),
  );
}
