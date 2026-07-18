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
import {
  AuthorityMutationCoordinator,
  type AuthorityMutationCoordinatorPort,
} from './AuthorityMutationCoordinator';

type PublisherAssignmentManagerOptions = {
  pb: PocketBase;
  now?: () => number;
  onAssignmentChanged?: (accountIds: string[]) => void | Promise<void>;
  coordinator?: AuthorityMutationCoordinatorPort;
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

export class PublisherAssignmentCommitVerificationError extends Error {
  constructor() {
    super(
      'The Publisher assignment response failed and the committed state could not be verified.',
    );
    this.name = 'PublisherAssignmentCommitVerificationError';
  }
}

export class PublisherAssignmentRecoveryError extends Error {
  constructor() {
    super('Publisher assignment failed and session invalidation also failed.');
    this.name = 'PublisherAssignmentRecoveryError';
  }
}

export class PublisherAssignmentNotificationError extends Error {
  constructor() {
    super('Publisher assignment committed, but session invalidation failed.');
    this.name = 'PublisherAssignmentNotificationError';
  }
}

function escapeFilter(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

export class PublisherAssignmentManager {
  private readonly pb: PocketBase;
  private readonly now: () => number;
  private readonly onAssignmentChanged?: (accountIds: string[]) => void | Promise<void>;
  private readonly coordinator: AuthorityMutationCoordinatorPort;

  constructor(options: PublisherAssignmentManagerOptions) {
    this.pb = options.pb;
    this.now = options.now ?? Date.now;
    this.onAssignmentChanged = options.onAssignmentChanged;
    this.coordinator = options.coordinator ?? new AuthorityMutationCoordinator();
  }

  async assign(input: PublisherAssignmentInput): Promise<PublisherAssignmentResult> {
    return this.coordinator.run(() => this.assignExclusive(input));
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

    const changedAccounts = [commitState.publisherAccountId, input.accountId].filter(
      (accountId): accountId is string => Boolean(accountId),
    );
    const uniqueChangedAccounts = [...new Set(changedAccounts)];

    if (target) {
      await this.preparePendingPublisher(target, input.actorAccountId);
    }

    const nextRevision = commitState.assignmentVersion + 1;
    try {
      await this.commitAssignment(commitState, input.accountId, input.actorAccountId);
    } catch (error) {
      await this.notifyAfterError(uniqueChangedAccounts);
      throw error;
    }

    try {
      if (commitState.publisherAccountId) {
        await this.disablePublisher(
          await this.getAccount(commitState.publisherAccountId),
          input.actorAccountId,
        );
      }
    } catch (error) {
      await this.notifyAfterError(uniqueChangedAccounts);
      throw error;
    }

    try {
      await this.onAssignmentChanged?.(uniqueChangedAccounts);
    } catch {
      throw new PublisherAssignmentNotificationError();
    }
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
    try {
      await this.revokeDevices(account, actorAccountId);
    } catch (error) {
      await this.notifyAfterError([account.id]);
      throw error;
    }
  }

  private async disablePublisher(
    account: RelayPrivilegedAccountRecord,
    actorAccountId: string,
  ): Promise<void> {
    if (account.storedRole !== 'publisher') {
      throw new Error('The authoritative Publisher account is invalid.');
    }
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
    await this.revokeDevices(account, actorAccountId);
  }

  private async commitAssignment(
    state: RelayPrivilegedStateRecord,
    publisherAccountId: string | null,
    actorAccountId: string,
  ): Promise<void> {
    const expected = {
      publisherAccountId,
      assignmentVersion: state.assignmentVersion + 1,
      updatedByAccountId: actorAccountId,
    };
    try {
      await this.pb.collection(RELAY_PRIVILEGED_STATE_COLLECTION).update(
        state.id,
        {
          publisherAccountId: publisherAccountId ?? '',
          assignmentVersion: expected.assignmentVersion,
          updatedByAccountId: actorAccountId,
          updatedAt: new Date(this.now()).toISOString(),
        },
        { requestKey: null },
      );
    } catch (commitError) {
      let verified: RelayPrivilegedStateRecord;
      try {
        verified = await this.getState();
      } catch {
        throw new PublisherAssignmentCommitVerificationError();
      }
      if (
        verified.id === state.id &&
        verified.publisherAccountId === expected.publisherAccountId &&
        verified.assignmentVersion === expected.assignmentVersion &&
        verified.updatedByAccountId === expected.updatedByAccountId
      ) {
        return;
      }
      throw commitError;
    }
  }

  private async notifyAfterError(accountIds: string[]): Promise<void> {
    try {
      await this.onAssignmentChanged?.([...new Set(accountIds)]);
    } catch {
      throw new PublisherAssignmentRecoveryError();
    }
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
