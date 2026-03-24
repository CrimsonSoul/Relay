import type PocketBase from 'pocketbase';
import type { PendingChange } from './PendingChanges';
import { loggers } from '../logger';

const logger = loggers.sync;

export interface SyncResult {
  conflict: boolean;
  overwrittenData?: Record<string, unknown>;
}

export class SyncManager {
  constructor(private pb: PocketBase) {}

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

        await this.pb.collection('conflict_log').create({
          collection,
          recordId,
          overwrittenData: serverRecord,
          overwrittenBy: 'client',
        });

        logger.warn('Conflict detected during sync', { collection, recordId });
      }
    } catch {
      // Record not found on server — apply as create
      const { id: _id2, ...createData } = data as { id?: string } & Record<string, unknown>; // eslint-disable-line sonarjs/no-unused-vars
      await this.pb.collection(collection).create(createData);
      return { conflict: false };
    }

    // Apply the client's version (last-write-wins)
    const {
      id: _id, // eslint-disable-line sonarjs/no-unused-vars
      created: _created, // eslint-disable-line sonarjs/no-unused-vars
      updated: _updated, // eslint-disable-line sonarjs/no-unused-vars
      ...updateData
    } = data as Record<string, unknown>;
    await this.pb.collection(collection).update(recordId, updateData);

    return { conflict, overwrittenData };
  }

  private async applyDelete(collection: string, recordId: string): Promise<SyncResult> {
    try {
      await this.pb.collection(collection).delete(recordId);
    } catch {
      // Already deleted
    }
    return { conflict: false };
  }

  async syncAll(
    changes: PendingChange[],
    onProgress?: (processed: number, total: number) => void,
  ): Promise<{ total: number; conflicts: number; errors: string[] }> {
    let conflicts = 0;
    const errors: string[] = [];

    for (let i = 0; i < changes.length; i++) {
      try {
        const result = await this.applyChange(changes[i]);
        if (result.conflict) conflicts++;
      } catch (err) {
        errors.push(`Failed to sync ${changes[i].collection}/${changes[i].action}: ${err}`);
        logger.error('Sync error', { change: changes[i], error: err });
      }
      onProgress?.(i + 1, changes.length);
    }

    return { total: changes.length, conflicts, errors };
  }
}
