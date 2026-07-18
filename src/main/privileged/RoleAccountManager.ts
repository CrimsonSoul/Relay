import { randomBytes } from 'node:crypto';
import type PocketBase from 'pocketbase';
import {
  MAX_PRIVILEGED_ADMINISTRATORS,
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_STATE_COLLECTION,
  type RelayAdministrationSnapshot,
  type RelayPrivilegedAccountRecord,
  type RelayPrivilegedStateRecord,
  type StoredRoleAccountRole,
} from '@shared/privilegedAccess';
import {
  getEffectiveRole,
  getRoleDisplayNameError,
  getRoleUsernameError,
  normalizeRoleDisplayName,
  normalizeRoleUsername,
} from '@shared/roleAccounts';
import type { RelayAdministrationSnapshotReader } from './RelayAdministrationSnapshotReader';
import {
  AuthorityMutationCoordinator,
  type AuthorityMutationCoordinatorPort,
} from './AuthorityMutationCoordinator';

type RoleAccountManagerOptions = {
  pb: PocketBase;
  snapshotReader: Pick<RelayAdministrationSnapshotReader, 'read'>;
  now?: () => number;
  onAuthorityChanged?: (accountIds: string[]) => void | Promise<void>;
  coordinator?: AuthorityMutationCoordinatorPort;
};

type CreateRoleAccountInput = {
  actorAccountId: string;
  username: string;
  displayName: string;
  expectedStateRevision: number;
};

type AccountRevisionInput = {
  actorAccountId: string;
  accountId: string;
  expectedRevision: number;
};

export type OwnershipTransferInput = {
  actorAccountId: string;
  accountId: string;
  expectedStateRevision: number;
};

export class RoleAccountConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super('Administration accounts changed. Refresh and try again.');
    this.name = 'RoleAccountConflictError';
  }
}

export class RoleAccountCommitVerificationError extends Error {
  constructor() {
    super('The account was created, but its authority commit could not be verified safely.');
    this.name = 'RoleAccountCommitVerificationError';
  }
}

export class RoleAccountCleanupError extends Error {
  constructor() {
    super('Account creation failed and cleanup also failed; the inactive account was retained.');
    this.name = 'RoleAccountCleanupError';
  }
}

export class RoleAccountNotificationError extends Error {
  constructor() {
    super('Account authority change committed, but session invalidation failed.');
    this.name = 'RoleAccountNotificationError';
  }
}

function internalEmail(username: string): string {
  return `${username}@relay.invalid`;
}

function normalizeIdentity(input: { username: string; displayName: string }): {
  username: string;
  displayName: string;
} {
  const username = normalizeRoleUsername(input.username);
  const displayName = normalizeRoleDisplayName(input.displayName);
  const usernameError = getRoleUsernameError(username);
  if (usernameError) throw new Error(usernameError);
  const displayNameError = getRoleDisplayNameError(displayName);
  if (displayNameError) throw new Error(displayNameError);
  return { username, displayName };
}

export class RoleAccountManager {
  private readonly pb: PocketBase;
  private readonly snapshotReader: Pick<RelayAdministrationSnapshotReader, 'read'>;
  private readonly now: () => number;
  private readonly onAuthorityChanged?: (accountIds: string[]) => void | Promise<void>;
  private readonly coordinator: AuthorityMutationCoordinatorPort;

  constructor(options: RoleAccountManagerOptions) {
    this.pb = options.pb;
    this.snapshotReader = options.snapshotReader;
    this.now = options.now ?? Date.now;
    this.onAuthorityChanged = options.onAuthorityChanged;
    this.coordinator = options.coordinator ?? new AuthorityMutationCoordinator();
  }

  async createAdministrator(input: CreateRoleAccountInput): Promise<RelayAdministrationSnapshot> {
    return this.withAuthorityMutation(() => this.createAdministratorExclusive(input));
  }

  private async createAdministratorExclusive(
    input: CreateRoleAccountInput,
  ): Promise<RelayAdministrationSnapshot> {
    const state = await this.getState();
    const actor = await this.getAccount(input.actorAccountId);
    this.assertOwner(state, actor);
    this.assertRevision(state.assignmentVersion, input.expectedStateRevision);
    const accounts = await this.listAccounts();
    if (
      accounts.filter(({ storedRole }) => storedRole === 'administrator').length >=
      MAX_PRIVILEGED_ADMINISTRATORS
    ) {
      throw new Error('Relay already has the maximum number of administrators.');
    }
    const created = await this.createAccount(accounts, input, 'administrator');
    await this.commitCreatedAccount(created, () =>
      this.updateState(state, { updatedByAccountId: input.actorAccountId }),
    );
    return this.snapshotReader.read({ accountId: input.actorAccountId });
  }

  async createPublisher(input: CreateRoleAccountInput): Promise<RelayAdministrationSnapshot> {
    return this.withAuthorityMutation(() => this.createPublisherExclusive(input));
  }

  private async createPublisherExclusive(
    input: CreateRoleAccountInput,
  ): Promise<RelayAdministrationSnapshot> {
    const state = await this.getState();
    const actor = await this.getAccount(input.actorAccountId);
    this.assertPublisherManager(state, actor);
    this.assertRevision(state.assignmentVersion, input.expectedStateRevision);
    if (state.publisherAccountId) {
      throw new Error('Assign or replace the current Publisher before creating another one.');
    }
    const created = await this.createAccount(await this.listAccounts(), input, 'publisher');
    await this.commitCreatedAccount(created, () =>
      this.updateState(state, {
        publisherAccountId: created.id,
        updatedByAccountId: input.actorAccountId,
      }),
    );
    return this.snapshotReader.read({ accountId: input.actorAccountId });
  }

  async updateDisplayName(
    input: AccountRevisionInput & { displayName: string },
  ): Promise<RelayAdministrationSnapshot> {
    const [state, actor, target] = await Promise.all([
      this.getState(),
      this.getAccount(input.actorAccountId),
      this.getAccount(input.accountId),
    ]);
    this.assertCanManageTarget(state, actor, target);
    this.assertRevision(target.revision, input.expectedRevision);
    const displayName = normalizeRoleDisplayName(input.displayName);
    const error = getRoleDisplayNameError(displayName);
    if (error) throw new Error(error);
    await this.pb
      .collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION)
      .update(target.id, { displayName, revision: target.revision + 1 }, { requestKey: null });
    return this.snapshotReader.read({ accountId: input.actorAccountId });
  }

  async setActive(
    input: AccountRevisionInput & { active: boolean },
  ): Promise<RelayAdministrationSnapshot> {
    const [state, actor, target] = await Promise.all([
      this.getState(),
      this.getAccount(input.actorAccountId),
      this.getAccount(input.accountId),
    ]);
    this.assertCanManageTarget(state, actor, target);
    if (!input.active && target.id === state.ownerAccountId) {
      throw new Error('The current Owner cannot be deactivated.');
    }
    this.assertRevision(target.revision, input.expectedRevision);
    if (target.active !== input.active) {
      await this.pb
        .collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION)
        .update(
          target.id,
          { active: input.active, revision: target.revision + 1 },
          { requestKey: null },
        );
      await this.notifyAuthorityChanged([target.id]);
    }
    return this.snapshotReader.read({ accountId: input.actorAccountId });
  }

  async transferOwnership(input: OwnershipTransferInput): Promise<RelayAdministrationSnapshot> {
    return this.withAuthorityMutation(() => this.transferOwnershipExclusive(input));
  }

  private async transferOwnershipExclusive(
    input: OwnershipTransferInput,
  ): Promise<RelayAdministrationSnapshot> {
    const state = await this.getState();
    const actor = await this.getAccount(input.actorAccountId);
    this.assertOwner(state, actor);
    this.assertRevision(state.assignmentVersion, input.expectedStateRevision);
    const target = await this.getAccount(input.accountId);
    if (!target.active || target.storedRole !== 'administrator') {
      throw new Error('Select an active administrator as the new owner.');
    }
    if (target.id !== state.ownerAccountId) {
      await this.updateState(state, {
        ownerAccountId: target.id,
        updatedByAccountId: input.actorAccountId,
      });
      await this.notifyAuthorityChanged([input.actorAccountId, target.id]);
    }
    return this.snapshotReader.read({ accountId: input.actorAccountId });
  }

  private async createAccount(
    accounts: RelayPrivilegedAccountRecord[],
    input: CreateRoleAccountInput,
    storedRole: StoredRoleAccountRole,
  ): Promise<RelayPrivilegedAccountRecord> {
    const identity = normalizeIdentity(input);
    if (accounts.some(({ username }) => normalizeRoleUsername(username) === identity.username)) {
      throw new Error('That username is already in use.');
    }
    const password = randomBytes(48).toString('base64url');
    return this.pb
      .collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION)
      .create<RelayPrivilegedAccountRecord>(
        {
          email: internalEmail(identity.username),
          ...identity,
          storedRole,
          active: false,
          mustChangePassword: true,
          credentialVersion: 0,
          revision: 0,
          password,
          passwordConfirm: password,
        },
        { requestKey: null },
      );
  }

  private async commitCreatedAccount(
    account: RelayPrivilegedAccountRecord,
    commit: () => Promise<void>,
  ): Promise<void> {
    try {
      await commit();
    } catch (error) {
      if (error instanceof RoleAccountCommitVerificationError) throw error;
      let current: RelayPrivilegedStateRecord;
      try {
        current = await this.getState();
      } catch {
        throw new RoleAccountCommitVerificationError();
      }
      if (current.ownerAccountId === account.id || current.publisherAccountId === account.id) {
        throw new RoleAccountCommitVerificationError();
      }
      try {
        await this.pb
          .collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION)
          .delete(account.id, { requestKey: null });
      } catch {
        throw new RoleAccountCleanupError();
      }
      throw error;
    }
  }

  private withAuthorityMutation<T>(operation: () => Promise<T>): Promise<T> {
    return this.coordinator.run(operation);
  }

  private async notifyAuthorityChanged(accountIds: string[]): Promise<void> {
    try {
      await this.onAuthorityChanged?.(accountIds);
    } catch {
      throw new RoleAccountNotificationError();
    }
  }

  private assertCanManageTarget(
    state: RelayPrivilegedStateRecord,
    actor: RelayPrivilegedAccountRecord,
    target: RelayPrivilegedAccountRecord,
  ): void {
    if (target.storedRole === 'administrator') this.assertOwner(state, actor);
    else this.assertPublisherManager(state, actor);
  }

  private assertOwner(
    state: RelayPrivilegedStateRecord,
    actor: RelayPrivilegedAccountRecord,
  ): void {
    if (!actor.active || actor.id !== state.ownerAccountId) {
      throw new Error('Only the Relay owner can manage administrators.');
    }
  }

  private assertPublisherManager(
    state: RelayPrivilegedStateRecord,
    actor: RelayPrivilegedAccountRecord,
  ): void {
    const role = getEffectiveRole(actor, state);
    if (!actor.active || (role !== 'owner' && role !== 'admin')) {
      throw new Error('Only the Relay owner or an administrator can manage the Publisher.');
    }
  }

  private assertRevision(currentRevision: number, expectedRevision: number): void {
    if (currentRevision !== expectedRevision) throw new RoleAccountConflictError(currentRevision);
  }

  private async listAccounts(): Promise<RelayPrivilegedAccountRecord[]> {
    return this.pb
      .collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION)
      .getFullList<RelayPrivilegedAccountRecord>({ requestKey: null });
  }

  private async getAccount(accountId: string): Promise<RelayPrivilegedAccountRecord> {
    return this.pb
      .collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION)
      .getOne<RelayPrivilegedAccountRecord>(accountId, { requestKey: null });
  }

  private async getState(): Promise<RelayPrivilegedStateRecord> {
    return this.pb
      .collection(RELAY_PRIVILEGED_STATE_COLLECTION)
      .getFirstListItem<RelayPrivilegedStateRecord>('key="primary"', { requestKey: null });
  }

  private async updateState(
    state: RelayPrivilegedStateRecord,
    change: { ownerAccountId?: string; publisherAccountId?: string; updatedByAccountId: string },
  ): Promise<void> {
    const current = await this.getState();
    if (current.id !== state.id || current.assignmentVersion !== state.assignmentVersion) {
      throw new RoleAccountConflictError(current.assignmentVersion);
    }
    const expected = {
      ownerAccountId: change.ownerAccountId ?? current.ownerAccountId,
      publisherAccountId: change.publisherAccountId ?? current.publisherAccountId,
      assignmentVersion: current.assignmentVersion + 1,
      updatedByAccountId: change.updatedByAccountId,
    };
    try {
      await this.pb.collection(RELAY_PRIVILEGED_STATE_COLLECTION).update(
        current.id,
        {
          ...(change.ownerAccountId === undefined ? {} : { ownerAccountId: change.ownerAccountId }),
          ...(change.publisherAccountId === undefined
            ? {}
            : { publisherAccountId: change.publisherAccountId }),
          assignmentVersion: expected.assignmentVersion,
          updatedByAccountId: change.updatedByAccountId,
          updatedAt: new Date(this.now()).toISOString(),
        },
        { requestKey: null },
      );
    } catch (commitError) {
      let verified: RelayPrivilegedStateRecord;
      try {
        verified = await this.getState();
      } catch {
        throw new RoleAccountCommitVerificationError();
      }
      if (
        verified.id === current.id &&
        verified.ownerAccountId === expected.ownerAccountId &&
        verified.publisherAccountId === expected.publisherAccountId &&
        verified.assignmentVersion === expected.assignmentVersion &&
        verified.updatedByAccountId === expected.updatedByAccountId
      ) {
        return;
      }
      throw commitError;
    }
  }
}
