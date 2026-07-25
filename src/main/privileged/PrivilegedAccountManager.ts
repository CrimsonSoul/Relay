import type PocketBase from 'pocketbase';
import {
  MAX_PRIVILEGED_PASSWORD_LENGTH,
  MIN_PRIVILEGED_PASSWORD_LENGTH,
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_DEVICES_COLLECTION,
  RELAY_PRIVILEGED_STATE_COLLECTION,
  type EffectivePrivilegedRole,
  type RelayPrivilegedAccountRecord,
  type RelayPrivilegedDeviceRecord,
  type RelayPrivilegedStateRecord,
} from '@shared/privilegedAccess';
import { getEffectiveRole, normalizeRoleUsername } from '@shared/roleAccounts';
import type {
  PrivilegedCredentialSetupInput,
  PrivilegedCredentialSetupView,
  PrivilegedInitialOwnerSetupInput,
} from '@shared/ipc';

type PrivilegedAccountManagerOptions = {
  pb: PocketBase;
  now?: () => number;
  onCredentialChanged?: (accountId: string) => void | Promise<void>;
};

function escapeFilter(value: string): string {
  return value.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`);
}

type PrivilegedPasswordSetupInput = {
  password: string;
  passwordConfirm: string;
};

function validateCredential(input: PrivilegedPasswordSetupInput): void {
  if (
    input.password.length < MIN_PRIVILEGED_PASSWORD_LENGTH ||
    input.password.length > MAX_PRIVILEGED_PASSWORD_LENGTH ||
    input.password !== input.passwordConfirm
  ) {
    throw new Error('Enter a valid privileged password and matching confirmation.');
  }
}

function publicCredentialView(
  account: RelayPrivilegedAccountRecord,
  role: EffectivePrivilegedRole,
): PrivilegedCredentialSetupView {
  return {
    accountId: account.id,
    username: account.username,
    displayName: account.displayName,
    storedRole: account.storedRole,
    role,
    credentialState: 'configured',
    credentialVersion: account.credentialVersion,
  };
}

export class PrivilegedAccountManager {
  private readonly pb: PocketBase;
  private readonly now: () => number;
  private readonly onCredentialChanged?: (accountId: string) => void | Promise<void>;

  constructor(options: PrivilegedAccountManagerOptions) {
    this.pb = options.pb;
    this.now = options.now ?? Date.now;
    this.onCredentialChanged = options.onCredentialChanged;
  }

  async setupInitialAdministrator(
    input: PrivilegedInitialOwnerSetupInput,
  ): Promise<PrivilegedCredentialSetupView> {
    validateCredential(input);
    const state = await this.getState();
    const account = await this.getAccountByUsername(input.username);
    if (account.id !== state.ownerAccountId) {
      throw new Error('Initial administrator setup is not available.');
    }
    if (account.storedRole !== 'administrator' || account.active || !account.mustChangePassword) {
      throw new Error('The Relay owner credential is already configured.');
    }
    return this.replaceCredential(account, input, account.id, 'owner');
  }

  async setupCredential(
    input: PrivilegedCredentialSetupInput & { actorAccountId: string },
  ): Promise<PrivilegedCredentialSetupView> {
    validateCredential(input);
    const state = await this.getState();
    const [actor, target] = await Promise.all([
      this.getAccount(input.actorAccountId),
      this.getAccount(input.accountId),
    ]);
    const actorRole = getEffectiveRole(actor, state);
    const targetRole = getEffectiveRole(target, state);
    const canManageTarget =
      actor.active &&
      ((actorRole === 'owner' && targetRole !== null) ||
        (actorRole === 'admin' && targetRole === 'publisher'));
    if (!canManageTarget) throw new Error('Unauthorized privileged credential setup.');
    return this.replaceCredential(target, input, input.actorAccountId, targetRole!);
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

  private async getAccountByUsername(username: string): Promise<RelayPrivilegedAccountRecord> {
    const normalizedUsername = normalizeRoleUsername(username);
    return this.pb
      .collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION)
      .getFirstListItem<RelayPrivilegedAccountRecord>(
        `username="${escapeFilter(normalizedUsername)}"`,
        { requestKey: null },
      );
  }

  private async replaceCredential(
    account: RelayPrivilegedAccountRecord,
    input: PrivilegedPasswordSetupInput,
    actorAccountId: string,
    role: EffectivePrivilegedRole,
  ): Promise<PrivilegedCredentialSetupView> {
    await this.revokeDevices(account.id, actorAccountId);
    const updated = await this.pb
      .collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION)
      .update<RelayPrivilegedAccountRecord>(
        account.id,
        {
          password: input.password,
          passwordConfirm: input.passwordConfirm,
          active: true,
          mustChangePassword: false,
          credentialVersion: account.credentialVersion + 1,
        },
        { requestKey: null },
      );
    await this.onCredentialChanged?.(account.id);
    return publicCredentialView(updated, role);
  }

  private async revokeDevices(accountId: string, actorAccountId: string): Promise<void> {
    const devices = await this.pb
      .collection(RELAY_PRIVILEGED_DEVICES_COLLECTION)
      .getFullList<RelayPrivilegedDeviceRecord>({
        filter: `accountId="${escapeFilter(accountId)}" && state="active"`,
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
