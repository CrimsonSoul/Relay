import { randomBytes } from 'node:crypto';
import type PocketBase from 'pocketbase';
import {
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_DEVICES_COLLECTION,
  RELAY_PRIVILEGED_STATE_COLLECTION,
  type RelayPrivilegedAccountRecord,
  type RelayPrivilegedDeviceRecord,
  type RelayPrivilegedStateRecord,
} from '@shared/privilegedAccess';
import { RELAY_OPERATORS_COLLECTION, type RelayOperatorRecord } from '@shared/operators';

type PublisherAssignmentManagerOptions = {
  pb: PocketBase;
  now?: () => number;
  onAssignmentChanged?: (operatorIds: string[]) => void | Promise<void>;
};

type PublisherAssignmentInput = {
  operatorId: string | null;
  expectedStateRevision: number;
  actorOperatorId: string;
};

export type PublisherAssignmentResult = {
  publisherOperatorId: string | null;
  assignmentRevision: number;
  credentialState: 'pending-local-setup' | 'not-assigned' | 'unchanged';
};

export class PublisherAssignmentConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super('The publisher assignment changed. Refresh and try again.');
    this.name = 'PublisherAssignmentConflictError';
  }
}

function escapeFilter(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function internalEmail(operatorId: string): string {
  const identity = operatorId
    .toLocaleLowerCase('en')
    .replaceAll(/[^a-z0-9._-]/g, '-')
    .slice(0, 120);
  return `${identity}@relay.invalid`;
}

export class PublisherAssignmentManager {
  private readonly pb: PocketBase;
  private readonly now: () => number;
  private readonly onAssignmentChanged?: (operatorIds: string[]) => void | Promise<void>;

  constructor(options: PublisherAssignmentManagerOptions) {
    this.pb = options.pb;
    this.now = options.now ?? Date.now;
    this.onAssignmentChanged = options.onAssignmentChanged;
  }

  async assign(input: PublisherAssignmentInput): Promise<PublisherAssignmentResult> {
    const state = await this.getState();
    if (input.actorOperatorId !== state.adminOperatorId) {
      throw new Error('Unauthorized publisher assignment.');
    }
    if (input.expectedStateRevision !== state.assignmentVersion) {
      throw new PublisherAssignmentConflictError(state.assignmentVersion);
    }
    if (input.operatorId === state.publisherOperatorId) {
      return {
        publisherOperatorId: input.operatorId,
        assignmentRevision: state.assignmentVersion,
        credentialState: 'unchanged',
      };
    }
    if (input.operatorId) await this.assertEligible(input.operatorId, state.adminOperatorId);

    if (input.operatorId)
      await this.preparePendingPublisher(input.operatorId, input.actorOperatorId);
    const nextRevision = state.assignmentVersion + 1;
    await this.pb.collection(RELAY_PRIVILEGED_STATE_COLLECTION).update(
      state.id,
      {
        publisherOperatorId: input.operatorId ?? '',
        assignmentVersion: nextRevision,
        updatedByOperatorId: input.actorOperatorId,
        updatedAt: new Date(this.now()).toISOString(),
      },
      { requestKey: null },
    );
    if (state.publisherOperatorId) {
      await this.disablePublisher(state.publisherOperatorId, input.actorOperatorId);
    }
    const changedOperators = [state.publisherOperatorId, input.operatorId].filter(
      (operatorId): operatorId is string => Boolean(operatorId),
    );
    await this.onAssignmentChanged?.([...new Set(changedOperators)]);
    return {
      publisherOperatorId: input.operatorId,
      assignmentRevision: nextRevision,
      credentialState: input.operatorId ? 'pending-local-setup' : 'not-assigned',
    };
  }

  private async getState(): Promise<RelayPrivilegedStateRecord> {
    return this.pb
      .collection(RELAY_PRIVILEGED_STATE_COLLECTION)
      .getFirstListItem<RelayPrivilegedStateRecord>('key="primary"', { requestKey: null });
  }

  private async assertEligible(operatorId: string, adminOperatorId: string): Promise<void> {
    const operator = await this.pb
      .collection(RELAY_OPERATORS_COLLECTION)
      .getOne<RelayOperatorRecord>(operatorId, { requestKey: null });
    if (!operator.active) throw new Error('Select an active operator for Knowledge Publisher.');
    if (operator.id === adminOperatorId) {
      throw new Error('The Relay administrator cannot also be Knowledge Publisher.');
    }
  }

  private async preparePendingPublisher(
    operatorId: string,
    actorOperatorId: string,
  ): Promise<void> {
    const existing = await this.findAccount(operatorId);
    const credential = randomBytes(48).toString('base64url');
    if (!existing) {
      await this.pb.collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION).create(
        {
          email: internalEmail(operatorId),
          operatorId,
          role: 'publisher',
          active: false,
          mustChangePassword: true,
          credentialVersion: 0,
          password: credential,
          passwordConfirm: credential,
        },
        { requestKey: null },
      );
      return;
    }
    await this.revokeDevices(existing, actorOperatorId);
    await this.pb.collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION).update(
      existing.id,
      {
        role: 'publisher',
        active: false,
        mustChangePassword: true,
        credentialVersion: existing.credentialVersion + 1,
        password: credential,
        passwordConfirm: credential,
      },
      { requestKey: null },
    );
  }

  private async disablePublisher(operatorId: string, actorOperatorId: string): Promise<void> {
    const existing = await this.findAccount(operatorId);
    if (!existing) return;
    await this.revokeDevices(existing, actorOperatorId);
    const credential = randomBytes(48).toString('base64url');
    await this.pb.collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION).update(
      existing.id,
      {
        active: false,
        mustChangePassword: true,
        credentialVersion: existing.credentialVersion + 1,
        password: credential,
        passwordConfirm: credential,
      },
      { requestKey: null },
    );
  }

  private async findAccount(operatorId: string): Promise<RelayPrivilegedAccountRecord | null> {
    try {
      return await this.pb
        .collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION)
        .getFirstListItem<RelayPrivilegedAccountRecord>(
          `operatorId="${escapeFilter(operatorId)}"`,
          { requestKey: null },
        );
    } catch (error) {
      if ((error as { status?: number })?.status === 404) return null;
      throw error;
    }
  }

  private async revokeDevices(
    account: RelayPrivilegedAccountRecord,
    actorOperatorId: string,
  ): Promise<void> {
    const devices = await this.pb
      .collection(RELAY_PRIVILEGED_DEVICES_COLLECTION)
      .getFullList<RelayPrivilegedDeviceRecord>({
        filter: `accountId="${escapeFilter(account.id)}" && state="active"`,
        requestKey: null,
      });
    const revokedAt = new Date(this.now()).toISOString();
    for (const device of devices) {
      await this.pb.collection(RELAY_PRIVILEGED_DEVICES_COLLECTION).update(
        device.id,
        {
          state: 'revoked',
          revokedAt,
          revokedByOperatorId: actorOperatorId,
          revision: device.revision + 1,
        },
        { requestKey: null },
      );
    }
  }
}
