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
import { getEffectiveRole } from '@shared/roleAccounts';

type PublisherAssignmentManagerOptions = {
  pb: PocketBase;
  now?: () => number;
  onAssignmentChanged?: (accountIds: string[]) => void | Promise<void>;
};

type PublisherAssignmentInput = {
  accountId: string | null;
  expectedStateRevision: number;
  actorAccountId: string;
};

export type PublisherAssignmentResult = {
  publisherAccountId: string | null;
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

export class PublisherAssignmentManager {
  private readonly pb: PocketBase;
  private readonly now: () => number;
  private readonly onAssignmentChanged?: (accountIds: string[]) => void | Promise<void>;
  private assignmentTail: Promise<void> = Promise.resolve();

  constructor(options: PublisherAssignmentManagerOptions) {
    this.pb = options.pb;
    this.now = options.now ?? Date.now;
    this.onAssignmentChanged = options.onAssignmentChanged;
  }

  async assign(input: PublisherAssignmentInput): Promise<PublisherAssignmentResult> {
    const result = this.assignmentTail.then(() => this.assignExclusive(input));
    this.assignmentTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async assignExclusive(
    input: PublisherAssignmentInput,
  ): Promise<PublisherAssignmentResult> {
    const state = await this.getState();
    const actor = await this.getAccount(input.actorAccountId);
    const actorRole = getEffectiveRole(actor, state);
    if (!actor.active || (actorRole !== 'owner' && actorRole !== 'admin')) {
      throw new Error('Unauthorized publisher assignment.');
    }
    if (input.expectedStateRevision !== state.assignmentVersion) {
      throw new PublisherAssignmentConflictError(state.assignmentVersion);
    }
    if (input.accountId === state.publisherAccountId) {
      return {
        publisherAccountId: input.accountId,
        assignmentRevision: state.assignmentVersion,
        credentialState: 'unchanged',
      };
    }

    const target = input.accountId ? await this.getAccount(input.accountId) : null;
    if (target && target.storedRole !== 'publisher') {
      throw new Error('Select a Publisher account for Knowledge Publisher.');
    }

    const commitState = await this.getState();
    if (commitState.id !== state.id || commitState.assignmentVersion !== state.assignmentVersion) {
      throw new PublisherAssignmentConflictError(commitState.assignmentVersion);
    }

    const nextRevision = commitState.assignmentVersion + 1;
    await this.pb.collection(RELAY_PRIVILEGED_STATE_COLLECTION).update(
      commitState.id,
      {
        publisherAccountId: input.accountId ?? '',
        assignmentVersion: nextRevision,
        updatedByAccountId: input.actorAccountId,
        updatedAt: new Date(this.now()).toISOString(),
      },
      { requestKey: null },
    );
    if (target) await this.preparePendingPublisher(target, input.actorAccountId);
    if (commitState.publisherAccountId) {
      await this.disablePublisher(
        await this.getAccount(commitState.publisherAccountId),
        input.actorAccountId,
      );
    }
    const changedAccounts = [commitState.publisherAccountId, input.accountId].filter(
      (accountId): accountId is string => Boolean(accountId),
    );
    await this.onAssignmentChanged?.([...new Set(changedAccounts)]);
    return {
      publisherAccountId: input.accountId,
      assignmentRevision: nextRevision,
      credentialState: input.accountId ? 'pending-local-setup' : 'not-assigned',
    };
  }

  private async getState(): Promise<RelayPrivilegedStateRecord> {
    return this.pb
      .collection(RELAY_PRIVILEGED_STATE_COLLECTION)
      .getFirstListItem<RelayPrivilegedStateRecord>('key="primary"', { requestKey: null });
  }

  private async getAccount(accountId: string): Promise<RelayPrivilegedAccountRecord> {
    return this.pb
      .collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION)
      .getOne<RelayPrivilegedAccountRecord>(accountId, { requestKey: null });
  }

  private async preparePendingPublisher(
    account: RelayPrivilegedAccountRecord,
    actorAccountId: string,
  ): Promise<void> {
    await this.revokeDevices(account, actorAccountId);
    const credential = randomBytes(48).toString('base64url');
    await this.pb.collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION).update(
      account.id,
      {
        active: false,
        mustChangePassword: true,
        credentialVersion: account.credentialVersion + 1,
        password: credential,
        passwordConfirm: credential,
      },
      { requestKey: null },
    );
  }

  private async disablePublisher(
    account: RelayPrivilegedAccountRecord,
    actorAccountId: string,
  ): Promise<void> {
    if (account.storedRole !== 'publisher') {
      throw new Error('The authoritative Publisher account is invalid.');
    }
    await this.revokeDevices(account, actorAccountId);
    const credential = randomBytes(48).toString('base64url');
    await this.pb.collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION).update(
      account.id,
      {
        active: false,
        mustChangePassword: true,
        credentialVersion: account.credentialVersion + 1,
        password: credential,
        passwordConfirm: credential,
      },
      { requestKey: null },
    );
  }

  private async revokeDevices(
    account: RelayPrivilegedAccountRecord,
    actorAccountId: string,
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
          revokedByAccountId: actorAccountId,
          revision: device.revision + 1,
        },
        { requestKey: null },
      );
    }
  }
}
