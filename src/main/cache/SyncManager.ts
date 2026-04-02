import type PocketBase from 'pocketbase';
import type { PendingChange } from './PendingChanges';
import { loggers } from '../logger';

const logger = loggers.sync;

export interface SyncResult {
  conflict: boolean;
  overwrittenData?: Record<string, unknown>;
}

/**
 * SyncManager — infrastructure prepared for future offline-write support.
 * Processes PendingChange entries against the PocketBase server. Currently
 * only triggered via the SYNC_PENDING IPC channel; no production code path
 * enqueues changes into PendingChanges yet.
 */
export class SyncManager {
  constructor(private readonly pb: PocketBase) {}

  /** Whether the internal PB client has a valid auth token. */
  isAuthenticated(): boolean {
    return this.pb.authStore.isValid;
  }

  /** Re-authenticate the internal PB client (e.g. after token expiry). */
  async reauthenticate(email: string, secret: string): Promise<void> {
    await this.pb.collection('_pb_users_auth_').authWithPassword(email, secret);
  }

  async applyChange(change: PendingChange): Promise<SyncResult> {
    const { collection, action, data } = change;
    const recordId = (data as { id?: string }).id;

    switch (action) {
      case 'create':
        return this.applyCreate(collection, data);
      case 'update':
        return this.applyUpdate(collection, recordId!, data, change.timestamp);
      case 'delete':
        return this.applyDelete(collection, recordId!);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  private async applyCreate(
    collection: string,
    data: Record<string, unknown>,
  ): Promise<SyncResult> {
    const { id: _id, ...createData } = data as { id?: string } & Record<string, unknown>; // eslint-disable-line sonarjs/no-unused-vars
    await this.pb.collection(collection).create(createData);
    return { conflict: false };
  }

  private async applyUpdate(
    collection: string,
    recordId: string,
    data: Record<string, unknown>,
    clientTimestamp: number,
  ): Promise<SyncResult> {
    let conflict = false;
    let overwrittenData: Record<string, unknown> | undefined;

    try {
      const serverRecord = await this.pb.collection(collection).getOne(recordId);
      const serverUpdated = new Date(serverRecord.updated).getTime();

      if (serverUpdated > clientTimestamp) {
        conflict = true;
        overwrittenData = { ...serverRecord };

        // Wrap conflict_log write in its own try/catch so logging failure
        // doesn't prevent the sync from completing.
        try {
          await this.pb.collection('conflict_log').create({
            collection,
            recordId,
            overwrittenData: serverRecord,
            overwrittenBy: 'client',
          });
        } catch (logErr) {
          logger.error('Failed to write conflict log entry', {
            collection,
            recordId,
            error: logErr,
          });
        }

        logger.warn('Conflict detected during sync', { collection, recordId });
      }
    } catch (err: unknown) {
      // Distinguish 404 (record not found → create) from other errors (rethrow)
      const status = (err as { status?: number })?.status;
      if (status === 404) {
        const { id: _id2, ...createData } = data as { id?: string } & Record<string, unknown>; // eslint-disable-line sonarjs/no-unused-vars
        await this.pb.collection(collection).create(createData);
        return { conflict: false };
      }
      throw err;
    }

    // Apply the client's version (last-write-wins)
    const {
      id: _id, // eslint-disable-line sonarjs/no-unused-vars
      created: _created, // eslint-disable-line sonarjs/no-unused-vars
      updated: _updated, // eslint-disable-line sonarjs/no-unused-vars
      ...updateData
    } = data;
    await this.pb.collection(collection).update(recordId, updateData);

    return { conflict, overwrittenData };
  }

  private async applyDelete(collection: string, recordId: string): Promise<SyncResult> {
    try {
      await this.pb.collection(collection).delete(recordId);
    } catch (err: unknown) {
      // Only swallow 404 (already deleted); let network/auth errors propagate
      const status = (err as { status?: number })?.status;
      if (status !== 404) {
        throw err;
      }
    }
    return { conflict: false };
  }

  async syncAll(
    changes: PendingChange[],
    onProgress?: (processed: number, total: number) => void,
  ): Promise<{
    total: number;
    conflicts: number;
    synced: number[];
    failed: { changeId: number; error: string }[];
    errors: string[];
  }> {
    let conflicts = 0;
    const synced: number[] = [];
    const failed: { changeId: number; error: string }[] = [];

    for (let i = 0; i < changes.length; i++) {
      try {
        const result = await this.applyChange(changes[i]);
        if (result.conflict) conflicts++;
        synced.push(changes[i].id);
      } catch (err) {
        const errorMsg = `Failed to sync ${changes[i].collection}/${changes[i].action}: ${err}`;
        failed.push({ changeId: changes[i].id, error: errorMsg });
        logger.error('Sync error', { change: changes[i], error: err });
      }
      onProgress?.(i + 1, changes.length);
    }

    // Keep errors array for backward compatibility
    return {
      total: changes.length,
      conflicts,
      synced,
      failed,
      errors: failed.map((f) => f.error),
    };
  }
}
