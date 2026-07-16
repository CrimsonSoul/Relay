import type PocketBase from 'pocketbase';
import {
  MAX_PRIVILEGED_PASSWORD_LENGTH,
  MIN_PRIVILEGED_PASSWORD_LENGTH,
  isPrivilegedAdministrator,
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_DEVICES_COLLECTION,
  RELAY_PRIVILEGED_STATE_COLLECTION,
  type PrivilegedRole,
  type RelayPrivilegedAccountRecord,
  type RelayPrivilegedDeviceRecord,
  type RelayPrivilegedStateRecord,
} from '@shared/privilegedAccess';
import type { PrivilegedCredentialSetupInput, PrivilegedCredentialSetupView } from '@shared/ipc';

type PrivilegedAccountManagerOptions = {
  pb: PocketBase;
  now?: () => number;
  onCredentialChanged?: (operatorId: string) => void | Promise<void>;
};

function escapeFilter(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function validateCredential(input: PrivilegedCredentialSetupInput): void {
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
): PrivilegedCredentialSetupView {
  return {
    accountId: account.id,
    operatorId: account.operatorId,
    role: account.role,
    credentialState: 'configured',
    credentialVersion: account.credentialVersion,
  };
}

export class PrivilegedAccountManager {
  private readonly pb: PocketBase;
  private readonly now: () => number;
  private readonly onCredentialChanged?: (operatorId: string) => void | Promise<void>;

  constructor(options: PrivilegedAccountManagerOptions) {
    this.pb = options.pb;
    this.now = options.now ?? Date.now;
    this.onCredentialChanged = options.onCredentialChanged;
  }

  async setupInitialAdministrator(
    input: PrivilegedCredentialSetupInput,
  ): Promise<PrivilegedCredentialSetupView> {
    validateCredential(input);
    const state = await this.getState();
    if (input.operatorId !== state.adminOperatorId) {
      throw new Error('Initial administrator setup is not available.');
    }
    const account = await this.getAccount(input.operatorId);
    if (account.role !== 'admin' || account.active || !account.mustChangePassword) {
      throw new Error('The Relay administrator credential is already configured.');
    }
    return this.replaceCredential(account, input, input.operatorId);
  }

  async setupCredential(
    input: PrivilegedCredentialSetupInput & { actorOperatorId: string },
  ): Promise<PrivilegedCredentialSetupView> {
    validateCredential(input);
    const state = await this.getState();
    if (!isPrivilegedAdministrator(state, input.actorOperatorId)) {
      throw new Error('Unauthorized privileged credential setup.');
    }
    const expectedRole = this.assignedRole(state, input.operatorId);
    if (!expectedRole) throw new Error('Privileged credential setup is not available.');
    const account = await this.getAccount(input.operatorId);
    if (account.role !== expectedRole) {
      throw new Error('Privileged credential setup is not available.');
    }
    return this.replaceCredential(account, input, input.actorOperatorId);
  }

  private assignedRole(
    state: RelayPrivilegedStateRecord,
    operatorId: string,
  ): PrivilegedRole | null {
    if (isPrivilegedAdministrator(state, operatorId)) return 'admin';
    if (state.publisherOperatorId === operatorId) return 'publisher';
    return null;
  }

  private async getState(): Promise<RelayPrivilegedStateRecord> {
    return this.pb
      .collection(RELAY_PRIVILEGED_STATE_COLLECTION)
      .getFirstListItem<RelayPrivilegedStateRecord>('key="primary"', { requestKey: null });
  }

  private async getAccount(operatorId: string): Promise<RelayPrivilegedAccountRecord> {
    return this.pb
      .collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION)
      .getFirstListItem<RelayPrivilegedAccountRecord>(`operatorId="${escapeFilter(operatorId)}"`, {
        requestKey: null,
      });
  }

  private async replaceCredential(
    account: RelayPrivilegedAccountRecord,
    input: PrivilegedCredentialSetupInput,
    actorOperatorId: string,
  ): Promise<PrivilegedCredentialSetupView> {
    await this.revokeDevices(account.id, actorOperatorId);
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
    await this.onCredentialChanged?.(account.operatorId);
    return publicCredentialView(updated);
  }

  private async revokeDevices(accountId: string, actorOperatorId: string): Promise<void> {
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
          revokedByOperatorId: actorOperatorId,
          revision: device.revision + 1,
        },
        { requestKey: null },
      );
    }
  }
}
