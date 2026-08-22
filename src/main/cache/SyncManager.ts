import type PocketBase from 'pocketbase';
import { RELAY_APP_USER_EMAIL } from '@shared/ipc';
import type { PendingChange } from './PendingChanges';
import { loggers } from '../logger';
import { authenticateRelayAppUserShared } from '../pocketbase/RelayAppUserAuthCoordinator';

const logger = loggers.sync;

export interface SyncResult {
  conflict: boolean;
  applied: boolean;
  overwrittenData?: Record<string, unknown>;
}

export type SyncManagerOptions = Readonly<{
  relayAppUserServerUrl?: string;
}>;

/**
 * SyncManager processes durable PendingChange entries against the PocketBase
 * server when the SYNC_PENDING IPC channel requests a replay.
 */
export class SyncManager {
  constructor(
    private readonly pb: PocketBase,
    private readonly options: SyncManagerOptions = {},
  ) {}

  /** Whether the internal PB client has a valid auth token. */
  isAuthenticated(): boolean {
    return this.pb.authStore.isValid;
  }

  /** Re-authenticate the internal PB client (e.g. after token expiry). */
  async reauthenticate(email: string, secret: string): Promise<void> {
    if (email === RELAY_APP_USER_EMAIL && this.options.relayAppUserServerUrl) {
      await authenticateRelayAppUserShared(this.pb, this.options.relayAppUserServerUrl, secret);
      return;
    }
    await this.pb.collection('_pb_users_auth_').authWithPassword(email, secret);
  }

  async applyChange(change: PendingChange): Promise<SyncResult> {
    const { collection, action, data } = change;
    const recordId = (data as { id?: string }).id;

    switch (action) {
      case 'create':
        return this.applyCreate(collection, data);
      case 'update':
        return this.applyUpdate(collection, recordId!, data, change);
      case 'delete':
        return this.applyDelete(collection, recordId!, change.baseUpdated);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  private async applyCreate(
    collection: string,
    data: Record<string, unknown>,
  ): Promise<SyncResult> {
    const {
      created: _created, // eslint-disable-line sonarjs/no-unused-vars
      updated: _updated, // eslint-disable-line sonarjs/no-unused-vars
      ...createData
    } = data;
    try {
      await this.pb.collection(collection).create(createData);
      return { conflict: false, applied: true };
    } catch (error) {
      const recordId = typeof createData.id === 'string' ? createData.id : null;
      const status = (error as { status?: number })?.status;
      if (!recordId || (status !== 400 && status !== 409)) throw error;
      const existing = await this.pb.collection(collection).getOne(recordId);
      const identical = Object.entries(createData).every(([key, value]) => {
        return JSON.stringify(existing[key]) === JSON.stringify(value);
      });
      if (identical) return { conflict: false, applied: true };
      logger.warn('Stable offline create ID collided with different server data', {
        collection,
        recordId,
      });
      return { conflict: true, applied: false, overwrittenData: { ...existing } };
    }
  }

  private async applyUpdate(
    collection: string,
    recordId: string,
    data: Record<string, unknown>,
    change: PendingChange,
  ): Promise<SyncResult> {
    let conflict = false;
    let overwrittenData: Record<string, unknown> | undefined;

    try {
      const serverRecord = await this.pb.collection(collection).getOne(recordId);
      const serverUpdated = new Date(serverRecord.updated).getTime();

      const baseTimestamp = change.baseUpdated
        ? new Date(change.baseUpdated).getTime()
        : change.timestamp;
      if (serverUpdated > baseTimestamp) {
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
        return { conflict: true, applied: false, overwrittenData };
      }
    } catch (err: unknown) {
      // Distinguish 404 (record not found → create) from other errors (rethrow)
      const status = (err as { status?: number })?.status;
      if (status === 404) {
        if (change.baseUpdated) {
          logger.warn('Offline update conflicts with a record deleted on the server', {
            collection,
            recordId,
          });
          return { conflict: true, applied: false };
        }
        const {
          created: _created, // eslint-disable-line sonarjs/no-unused-vars
          updated: _updated, // eslint-disable-line sonarjs/no-unused-vars
          ...createData
        } = data;
        await this.pb.collection(collection).create(createData);
        return { conflict: false, applied: true };
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

    return { conflict, applied: true, overwrittenData };
  }

  private async applyDelete(
    collection: string,
    recordId: string,
    baseUpdated?: string,
  ): Promise<SyncResult> {
    try {
      if (baseUpdated) {
        const existing = await this.pb.collection(collection).getOne(recordId);
        if (new Date(existing.updated).getTime() > new Date(baseUpdated).getTime()) {
          return { conflict: true, applied: false, overwrittenData: { ...existing } };
        }
      }
      await this.pb.collection(collection).delete(recordId);
    } catch (err: unknown) {
      // Only swallow 404 (already deleted); let network/auth errors propagate
      const status = (err as { status?: number })?.status;
      if (status !== 404) {
        throw err;
      }
    }
    return { conflict: false, applied: true };
  }

  async syncAll(
    changes: PendingChange[],
    onProgress?: (processed: number, total: number) => void,
  ): Promise<{
    total: number;
    conflicts: number;
    conflicted: number[];
    synced: number[];
    failed: { changeId: number; error: string }[];
    errors: string[];
  }> {
    let conflicts = 0;
    const conflicted: number[] = [];
    const synced: number[] = [];
    const failed: { changeId: number; error: string }[] = [];

    for (const [i, change] of changes.entries()) {
      try {
        const result = await this.applyChange(change);
        if (result.conflict) {
          conflicts++;
          if (!result.applied) conflicted.push(change.id);
        }
        if (result.applied) synced.push(change.id);
      } catch (err) {
        const errorMsg = `Failed to sync ${change.collection}/${change.action}: ${err}`;
        failed.push({ changeId: change.id, error: errorMsg });
        logger.error('Sync error', { change, error: err });
      }
      onProgress?.(i + 1, changes.length);
    }

    // Keep errors array for backward compatibility
    return {
      total: changes.length,
      conflicts,
      conflicted,
      synced,
      failed,
      errors: failed.map((f) => f.error),
    };
  }
}
