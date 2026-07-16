import type PocketBase from 'pocketbase';
import {
  RELAY_OPERATORS_COLLECTION,
  getOperatorDisplayNameError,
  normalizeOperatorDisplayName,
  type RelayOperatorRecord,
} from '@shared/operators';
import {
  getPrivilegedAdministratorOperatorIds,
  RELAY_PRIVILEGED_STATE_COLLECTION,
  type RelayPrivilegedStateRecord,
} from '@shared/privilegedAccess';
import type {
  RelayOperatorActiveInput,
  RelayOperatorCreateInput,
  RelayOperatorRenameInput,
} from '@shared/ipc';

const DUPLICATE_NAME_ERROR = 'An operator with this display name already exists.';
const STALE_WRITE_ERROR = 'This operator changed since it was loaded. Refresh and try again.';

export type OperatorRoleProtection = Pick<
  RelayPrivilegedStateRecord,
  'adminOperatorId' | 'adminOperatorIds' | 'publisherOperatorId'
>;

export class RelayOperatorConflictError extends Error {
  readonly code = 'conflict';

  constructor(readonly currentRevision: number) {
    super(STALE_WRITE_ERROR);
    this.name = 'RelayOperatorConflictError';
  }
}

function validatedDisplayName(value: string): string {
  const error = getOperatorDisplayNameError(value);
  if (error) throw new Error(error);
  return normalizeOperatorDisplayName(value);
}

export class RelayOperatorManager {
  constructor(private readonly pb: PocketBase) {}

  async create(input: RelayOperatorCreateInput): Promise<RelayOperatorRecord> {
    const displayName = validatedDisplayName(input.displayName);
    await this.assertUniqueDisplayName(displayName);
    return this.pb
      .collection(RELAY_OPERATORS_COLLECTION)
      .create<RelayOperatorRecord>(
        { displayName, active: true, revision: 0 },
        { requestKey: null },
      );
  }

  async rename(input: RelayOperatorRenameInput): Promise<RelayOperatorRecord> {
    const displayName = validatedDisplayName(input.displayName);
    const current = await this.getCurrent(input.id);
    this.assertCurrentRevision(current, input.expectedUpdated);
    await this.assertUniqueDisplayName(displayName, input.id);
    return this.pb
      .collection(RELAY_OPERATORS_COLLECTION)
      .update<RelayOperatorRecord>(
        input.id,
        { displayName, revision: this.revisionOf(current) + 1 },
        { requestKey: null },
      );
  }

  async setActive(input: RelayOperatorActiveInput): Promise<RelayOperatorRecord> {
    const current = await this.getCurrent(input.id);
    this.assertCurrentRevision(current, input.expectedUpdated);
    const protection = await this.getRoleProtectionState();
    return this.updateActive(current, input.active, protection);
  }

  async renameByRevision(input: {
    operatorId: string;
    displayName: string;
    expectedRevision: number;
  }): Promise<RelayOperatorRecord> {
    const displayName = validatedDisplayName(input.displayName);
    const current = await this.getCurrent(input.operatorId);
    this.assertNumericRevision(current, input.expectedRevision);
    await this.assertUniqueDisplayName(displayName, input.operatorId);
    return this.pb
      .collection(RELAY_OPERATORS_COLLECTION)
      .update<RelayOperatorRecord>(
        input.operatorId,
        { displayName, revision: this.revisionOf(current) + 1 },
        { requestKey: null },
      );
  }

  async setActiveByRevision(
    input: { operatorId: string; active: boolean; expectedRevision: number },
    protection?: OperatorRoleProtection,
  ): Promise<RelayOperatorRecord> {
    const current = await this.getCurrent(input.operatorId);
    this.assertNumericRevision(current, input.expectedRevision);
    return this.updateActive(
      current,
      input.active,
      protection ?? (await this.getRoleProtectionState()),
    );
  }

  async getRoleProtectionState(): Promise<OperatorRoleProtection> {
    const state = await this.pb
      .collection(RELAY_PRIVILEGED_STATE_COLLECTION)
      .getFirstListItem<RelayPrivilegedStateRecord>('key="primary"', { requestKey: null });
    return {
      adminOperatorId: state.adminOperatorId,
      adminOperatorIds: getPrivilegedAdministratorOperatorIds(state),
      publisherOperatorId: state.publisherOperatorId,
    };
  }

  private async getCurrent(id: string): Promise<RelayOperatorRecord> {
    try {
      return await this.pb
        .collection(RELAY_OPERATORS_COLLECTION)
        .getOne<RelayOperatorRecord>(id, { requestKey: null });
    } catch (error) {
      if ((error as { status?: number })?.status === 404) throw new Error('Operator not found.');
      throw error;
    }
  }

  private assertCurrentRevision(current: RelayOperatorRecord, expectedUpdated: string): void {
    if (current.updated !== expectedUpdated) throw new Error(STALE_WRITE_ERROR);
  }

  private assertNumericRevision(current: RelayOperatorRecord, expectedRevision: number): void {
    const revision = this.revisionOf(current);
    if (revision !== expectedRevision) throw new RelayOperatorConflictError(revision);
  }

  private revisionOf(record: RelayOperatorRecord): number {
    return Number.isInteger(record.revision) && (record.revision ?? -1) >= 0 ? record.revision! : 0;
  }

  private async updateActive(
    current: RelayOperatorRecord,
    active: boolean,
    protection: OperatorRoleProtection,
  ): Promise<RelayOperatorRecord> {
    if (!active && getPrivilegedAdministratorOperatorIds(protection).includes(current.id)) {
      throw new Error('The active Relay administrator cannot be deactivated.');
    }
    if (!active && current.id === protection.publisherOperatorId) {
      throw new Error('Remove the Knowledge Publisher role before deactivating this operator.');
    }
    return this.pb
      .collection(RELAY_OPERATORS_COLLECTION)
      .update<RelayOperatorRecord>(
        current.id,
        { active, revision: this.revisionOf(current) + 1 },
        { requestKey: null },
      );
  }

  private async assertUniqueDisplayName(displayName: string, excludeId?: string): Promise<void> {
    const normalized = displayName.toLowerCase();
    const records = await this.pb
      .collection(RELAY_OPERATORS_COLLECTION)
      .getFullList<RelayOperatorRecord>({ fields: 'id,displayName', requestKey: null });
    const duplicate = records.some(
      (record) =>
        record.id !== excludeId &&
        normalizeOperatorDisplayName(record.displayName).toLowerCase() === normalized,
    );
    if (duplicate) throw new Error(DUPLICATE_NAME_ERROR);
  }
}
