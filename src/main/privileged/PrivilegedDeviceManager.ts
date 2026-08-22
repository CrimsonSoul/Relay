import type PocketBase from 'pocketbase';
import {
  getPrivilegedCapabilities,
  MAX_PRIVILEGED_DEVICE_LABEL_LENGTH,
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_DEVICES_COLLECTION,
  type PrivilegedRole,
  type RelayPrivilegedAccountRecord,
  type RelayPrivilegedDeviceAdminView,
  type RelayPrivilegedDeviceRecord,
} from '@shared/privilegedAccess';

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
  return value.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`);
}

function normalizedLabel(value: string): string {
  const label = value.trim().replace(/\s+/g, ' ');
  if (!label || label.length > MAX_PRIVILEGED_DEVICE_LABEL_LENGTH) {
    throw new Error('Enter a valid paired device label.');
  }
  return label;
}

function canonicalTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error('Paired device timestamp is invalid.');
  return new Date(timestamp).toISOString();
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
    const [devices, accounts] = await Promise.all([
      this.pb
        .collection(RELAY_PRIVILEGED_DEVICES_COLLECTION)
        .getFullList<RelayPrivilegedDeviceRecord>(deviceOptions),
      this.pb
        .collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION)
        .getFullList<RelayPrivilegedAccountRecord>({ requestKey: null }),
    ]);
    const accountsById = new Map(accounts.map((account) => [account.id, account]));
    return devices.flatMap((device) => {
      const account = accountsById.get(device.accountId);
      return account ? [this.publicView(device, account)] : [];
    });
  }

  async rename(input: {
    actorRole: PrivilegedRole;
    deviceId: string;
    label: string;
    expectedRevision: number;
  }): Promise<RelayPrivilegedDeviceAdminView> {
    this.assertCanManageDevices(input.actorRole);
    const current = await this.getDevice(input.deviceId);
    this.assertRevision(current, input.expectedRevision);
    const account = await this.getAccount(current.accountId);
    const currentView = this.publicView(current, account);
    const label = normalizedLabel(input.label);
    await this.pb
      .collection(RELAY_PRIVILEGED_DEVICES_COLLECTION)
      .update<RelayPrivilegedDeviceRecord>(
        current.id,
        { label, revision: current.revision + 1 },
        { requestKey: null },
      );
    return { ...currentView, label, revision: current.revision + 1 };
  }

  async revoke(input: {
    actorRole: PrivilegedRole;
    actorAccountId: string;
    deviceId: string;
    expectedRevision: number;
  }): Promise<RelayPrivilegedDeviceAdminView> {
    this.assertCanManageDevices(input.actorRole);
    const current = await this.getDevice(input.deviceId);
    const account = await this.getAccount(current.accountId);
    const currentView = this.publicView(current, account);
    if (current.state === 'revoked') return currentView;
    this.assertRevision(current, input.expectedRevision);
    await this.pb
      .collection(RELAY_PRIVILEGED_DEVICES_COLLECTION)
      .update<RelayPrivilegedDeviceRecord>(
        current.id,
        {
          state: 'revoked',
          revokedAt: new Date(this.now()).toISOString(),
          revokedByAccountId: input.actorAccountId,
          revision: current.revision + 1,
        },
        { requestKey: null },
      );
    await this.onDeviceRevoked?.(current.accountId, current.deviceId);
    return { ...currentView, state: 'revoked', revision: current.revision + 1 };
  }

  private assertCanManageDevices(role: PrivilegedRole): void {
    const capabilities = getPrivilegedCapabilities({ active: true, assigned: true, role });
    if (!capabilities.includes('devices.manage')) {
      throw new Error('Relay device-management access is required.');
    }
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

  private async getAccount(accountId: string): Promise<RelayPrivilegedAccountRecord> {
    return this.pb
      .collection(RELAY_PRIVILEGED_ACCOUNTS_COLLECTION)
      .getOne<RelayPrivilegedAccountRecord>(accountId, { requestKey: null });
  }

  private publicView(
    device: RelayPrivilegedDeviceRecord,
    account: RelayPrivilegedAccountRecord,
  ): RelayPrivilegedDeviceAdminView {
    if (
      !account.username ||
      account.username.length > 64 ||
      !account.displayName ||
      account.displayName.length > 120
    ) {
      throw new Error('Paired device account identity is unavailable.');
    }
    return {
      id: device.id,
      deviceId: device.deviceId,
      accountId: device.accountId,
      username: account.username,
      displayName: account.displayName,
      label: device.label,
      hostname: device.hostnameSnapshot,
      state: device.state,
      lastSeenAt: canonicalTimestamp(device.lastUsedAt || device.pairedAt),
      fingerprintSuffix: device.fingerprint.slice(-8).toUpperCase(),
      revision: device.revision,
    };
  }
}
