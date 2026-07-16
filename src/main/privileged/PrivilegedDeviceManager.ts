import type PocketBase from 'pocketbase';
import {
  MAX_PRIVILEGED_DEVICE_LABEL_LENGTH,
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_DEVICES_COLLECTION,
  type PrivilegedRole,
  type RelayPrivilegedAccountRecord,
  type RelayPrivilegedDeviceAdminView,
  type RelayPrivilegedDeviceRecord,
} from '@shared/privilegedAccess';
import { RELAY_OPERATORS_COLLECTION, type RelayOperatorRecord } from '@shared/operators';

type PrivilegedDeviceManagerOptions = {
  pb: PocketBase;
  now?: () => number;
  onDeviceRevoked?: (accountId: string, deviceId: string) => void | Promise<void>;
};

export class PrivilegedDeviceConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super('The paired device changed. Refresh and try again.');
    this.name = 'PrivilegedDeviceConflictError';
  }
}

function escapeFilter(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function normalizedLabel(value: string): string {
  const label = value.trim().replace(/\s+/g, ' ');
  if (!label || label.length > MAX_PRIVILEGED_DEVICE_LABEL_LENGTH) {
    throw new Error('Enter a valid paired device label.');
  }
  return label;
}

export class PrivilegedDeviceManager {
  private readonly pb: PocketBase;
  private readonly now: () => number;
  private readonly onDeviceRevoked?: (accountId: string, deviceId: string) => void | Promise<void>;

  constructor(options: PrivilegedDeviceManagerOptions) {
    this.pb = options.pb;
    this.now = options.now ?? Date.now;
    this.onDeviceRevoked = options.onDeviceRevoked;
  }

  async list(input: {
    role: PrivilegedRole;
    accountId: string;
  }): Promise<RelayPrivilegedDeviceAdminView[]> {
    const deviceOptions =
      input.role === 'publisher'
        ? { filter: `accountId="${escapeFilter(input.accountId)}"`, requestKey: null }
        : { requestKey: null };
    const [devices, accounts, operators] = await Promise.all([
      this.pb
        .collection(RELAY_PRIVILEGED_DEVICES_COLLECTION)
        .getFullList<RelayPrivilegedDeviceRecord>(deviceOptions),
      this.pb
        .collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION)
        .getFullList<RelayPrivilegedAccountRecord>({ requestKey: null }),
      this.pb
        .collection(RELAY_OPERATORS_COLLECTION)
        .getFullList<RelayOperatorRecord>({ requestKey: null }),
    ]);
    const accountsById = new Map(accounts.map((account) => [account.id, account]));
    const operatorsById = new Map(operators.map((operator) => [operator.id, operator]));
    return devices.flatMap((device) => {
      const account = accountsById.get(device.accountId);
      const operator = account ? operatorsById.get(account.operatorId) : undefined;
      return account && operator ? [this.publicView(device, account, operator)] : [];
    });
  }

  async rename(input: {
    actorRole: PrivilegedRole;
    deviceId: string;
    label: string;
    expectedRevision: number;
  }): Promise<RelayPrivilegedDeviceAdminView> {
    this.assertAdministrator(input.actorRole);
    const current = await this.getDevice(input.deviceId);
    this.assertRevision(current, input.expectedRevision);
    const updated = await this.pb
      .collection(RELAY_PRIVILEGED_DEVICES_COLLECTION)
      .update<RelayPrivilegedDeviceRecord>(
        current.id,
        { label: normalizedLabel(input.label), revision: current.revision + 1 },
        { requestKey: null },
      );
    return this.resolvePublicView(updated);
  }

  async revoke(input: {
    actorRole: PrivilegedRole;
    actorOperatorId: string;
    deviceId: string;
    expectedRevision: number;
  }): Promise<RelayPrivilegedDeviceAdminView> {
    this.assertAdministrator(input.actorRole);
    const current = await this.getDevice(input.deviceId);
    if (current.state === 'revoked') return this.resolvePublicView(current);
    this.assertRevision(current, input.expectedRevision);
    const updated = await this.pb
      .collection(RELAY_PRIVILEGED_DEVICES_COLLECTION)
      .update<RelayPrivilegedDeviceRecord>(
        current.id,
        {
          state: 'revoked',
          revokedAt: new Date(this.now()).toISOString(),
          revokedByOperatorId: input.actorOperatorId,
          revision: current.revision + 1,
        },
        { requestKey: null },
      );
    await this.onDeviceRevoked?.(updated.accountId, updated.deviceId);
    return this.resolvePublicView(updated);
  }

  private assertAdministrator(role: PrivilegedRole): void {
    if (role !== 'admin') throw new Error('Relay administrator access is required.');
  }

  private assertRevision(device: RelayPrivilegedDeviceRecord, expectedRevision: number): void {
    if (device.revision !== expectedRevision) {
      throw new PrivilegedDeviceConflictError(device.revision);
    }
  }

  private async getDevice(deviceId: string): Promise<RelayPrivilegedDeviceRecord> {
    return this.pb
      .collection(RELAY_PRIVILEGED_DEVICES_COLLECTION)
      .getFirstListItem<RelayPrivilegedDeviceRecord>(`deviceId="${escapeFilter(deviceId)}"`, {
        requestKey: null,
      });
  }

  private async resolvePublicView(
    device: RelayPrivilegedDeviceRecord,
  ): Promise<RelayPrivilegedDeviceAdminView> {
    const [accounts, operators] = await Promise.all([
      this.pb
        .collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION)
        .getFullList<RelayPrivilegedAccountRecord>({ requestKey: null }),
      this.pb
        .collection(RELAY_OPERATORS_COLLECTION)
        .getFullList<RelayOperatorRecord>({ requestKey: null }),
    ]);
    const account = accounts.find(({ id }) => id === device.accountId);
    const operator = account ? operators.find(({ id }) => id === account.operatorId) : undefined;
    if (!account || !operator) throw new Error('Paired device identity is unavailable.');
    return this.publicView(device, account, operator);
  }

  private publicView(
    device: RelayPrivilegedDeviceRecord,
    account: RelayPrivilegedAccountRecord,
    operator: RelayOperatorRecord,
  ): RelayPrivilegedDeviceAdminView {
    return {
      id: device.id,
      deviceId: device.deviceId,
      accountId: device.accountId,
      operatorId: account.operatorId,
      operatorName: operator.displayName,
      label: device.label,
      hostname: device.hostnameSnapshot,
      state: device.state,
      lastSeenAt: device.lastUsedAt ?? device.pairedAt,
      fingerprintSuffix: device.fingerprint.slice(-8).toUpperCase(),
      revision: device.revision,
    };
  }
}
