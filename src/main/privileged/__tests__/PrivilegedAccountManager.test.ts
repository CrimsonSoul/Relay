import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MIN_PRIVILEGED_PASSWORD_LENGTH,
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_DEVICES_COLLECTION,
  RELAY_PRIVILEGED_STATE_COLLECTION,
  type RelayPrivilegedAccountRecord,
  type RelayPrivilegedDeviceRecord,
  type RelayPrivilegedStateRecord,
} from '@shared/privilegedAccess';
import { PrivilegedAccountManager } from '../PrivilegedAccountManager';

const PASSWORD = 'New-secure-access-123!';
const NOW = '2026-07-17T15:00:00.000Z';

function account(
  overrides: Partial<RelayPrivilegedAccountRecord> = {},
): RelayPrivilegedAccountRecord {
  return {
    id: 'account-ryan',
    username: 'ryan',
    displayName: 'Ryan Bledsoe',
    storedRole: 'administrator',
    active: true,
    mustChangePassword: false,
    credentialVersion: 1,
    revision: 1,
    created: NOW,
    updated: NOW,
    ...overrides,
  };
}
function state(overrides: Partial<RelayPrivilegedStateRecord> = {}): RelayPrivilegedStateRecord {
  return {
    id: 'state-1',
    key: 'primary',
    ownerAccountId: 'account-ryan',
    publisherAccountId: 'account-publisher',
    assignmentVersion: 2,
    identityMigrationVersion: 1,
    updatedByAccountId: null,
    created: NOW,
    updated: NOW,
    ...overrides,
  };
}
function device(overrides: Partial<RelayPrivilegedDeviceRecord> = {}): RelayPrivilegedDeviceRecord {
  return {
    id: 'device-record',
    accountId: 'account-publisher',
    deviceId: 'device-1',
    hostnameSnapshot: 'NOC-LT-01',
    label: 'Work laptop',
    publicKey: '{}',
    fingerprint: 'a'.repeat(64),
    state: 'active',
    pairedAt: NOW,
    lastUsedAt: NOW,
    revokedAt: null,
    revokedByAccountId: null,
    revision: 3,
    created: NOW,
    updated: NOW,
    ...overrides,
  };
}

describe('PrivilegedAccountManager', () => {
  const records = new Map([
    ['account-ryan', account()],
    [
      'account-charles',
      account({ id: 'account-charles', username: 'charles', displayName: 'Charles Gibbs' }),
    ],
    [
      'account-publisher',
      account({
        id: 'account-publisher',
        username: 'publisher',
        displayName: 'Knowledge Publisher',
        storedRole: 'publisher',
        active: false,
        mustChangePassword: true,
      }),
    ],
  ]);
  const accountCollection = {
    getOne: vi.fn(async (id: string) => records.get(id)),
    update: vi.fn(async (id: string, data: Record<string, unknown>) =>
      account({ ...records.get(id), id, ...data }),
    ),
  };
  const stateCollection = { getFirstListItem: vi.fn(async () => state()) };
  const deviceCollection = {
    getFullList: vi.fn(async () => [device()]),
    update: vi.fn(async (id: string, data: Record<string, unknown>) => device({ id, ...data })),
  };
  const pb = {
    collection: vi.fn((name: string) => {
      if (name === RELAY_PRIVILEGED_ACCOUNTS_COLLECTION) return accountCollection;
      if (name === RELAY_PRIVILEGED_STATE_COLLECTION) return stateCollection;
      if (name === RELAY_PRIVILEGED_DEVICES_COLLECTION) return deviceCollection;
      throw new Error(`Unexpected collection ${name}`);
    }),
  };
  const onCredentialChanged = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    stateCollection.getFirstListItem.mockResolvedValue(state());
  });
  const manager = () =>
    new PrivilegedAccountManager({
      pb: pb as never,
      now: () => Date.parse(NOW),
      onCredentialChanged,
    });

  it('configures the pending initial Owner by account ID', async () => {
    accountCollection.getOne.mockResolvedValueOnce(
      account({ active: false, mustChangePassword: true }),
    );
    await expect(
      manager().setupInitialAdministrator({
        accountId: 'account-ryan',
        password: PASSWORD,
        passwordConfirm: PASSWORD,
      }),
    ).resolves.toMatchObject({
      accountId: 'account-ryan',
      username: 'ryan',
      role: 'owner',
      credentialVersion: 2,
    });
  });

  it('allows the Owner to configure an Administrator and an Administrator to configure only Publisher', async () => {
    await expect(
      manager().setupCredential({
        actorAccountId: 'account-ryan',
        accountId: 'account-charles',
        password: PASSWORD,
        passwordConfirm: PASSWORD,
      }),
    ).resolves.toMatchObject({ accountId: 'account-charles', role: 'admin' });
    await expect(
      manager().setupCredential({
        actorAccountId: 'account-charles',
        accountId: 'account-publisher',
        password: PASSWORD,
        passwordConfirm: PASSWORD,
      }),
    ).resolves.toMatchObject({ accountId: 'account-publisher', role: 'publisher' });
    await expect(
      manager().setupCredential({
        actorAccountId: 'account-charles',
        accountId: 'account-ryan',
        password: PASSWORD,
        passwordConfirm: PASSWORD,
      }),
    ).rejects.toThrow(/unauthorized/i);
  });

  it('revokes every paired device using account attribution before replacing a credential', async () => {
    deviceCollection.getFullList.mockResolvedValue([
      device(),
      device({ id: 'device-2', deviceId: 'device-2' }),
    ]);
    await manager().setupCredential({
      actorAccountId: 'account-charles',
      accountId: 'account-publisher',
      password: PASSWORD,
      passwordConfirm: PASSWORD,
    });
    expect(deviceCollection.update).toHaveBeenCalledTimes(2);
    expect(deviceCollection.update).toHaveBeenCalledWith(
      'device-record',
      expect.objectContaining({ revokedByAccountId: 'account-charles', state: 'revoked' }),
      { requestKey: null },
    );
    expect(onCredentialChanged).toHaveBeenCalledWith('account-publisher');
  });

  it('rejects invalid passwords without touching PocketBase', async () => {
    const password = 'x'.repeat(MIN_PRIVILEGED_PASSWORD_LENGTH - 1);
    await expect(
      manager().setupInitialAdministrator({
        accountId: 'account-ryan',
        password,
        passwordConfirm: password,
      }),
    ).rejects.toThrow(/password/i);
    expect(pb.collection).not.toHaveBeenCalled();
  });
});
