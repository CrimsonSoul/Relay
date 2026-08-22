import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_DEVICES_COLLECTION,
  type RelayPrivilegedAccountRecord,
  type RelayPrivilegedDeviceRecord,
} from '@shared/privilegedAccess';
import { PrivilegedDeviceConflictError, PrivilegedDeviceManager } from '../PrivilegedDeviceManager';

const NOW = '2026-07-16T00:30:00.000Z';

function account(
  overrides: Partial<RelayPrivilegedAccountRecord> = {},
): RelayPrivilegedAccountRecord {
  return {
    id: 'account-admin',
    username: 'ryan',
    displayName: 'Ryan Bledsoe',
    storedRole: 'administrator',
    active: true,
    mustChangePassword: false,
    credentialVersion: 1,
    revision: 3,
    created: NOW,
    updated: NOW,
    ...overrides,
  };
}

function device(overrides: Partial<RelayPrivilegedDeviceRecord> = {}): RelayPrivilegedDeviceRecord {
  return {
    id: 'device-record',
    accountId: 'account-admin',
    deviceId: 'device-1',
    hostnameSnapshot: 'NOC-LT-01',
    label: 'Work laptop',
    publicKey: '{"secret":"must-not-return"}',
    fingerprint: `${'a'.repeat(56)}1a2b3c4d`,
    state: 'active',
    pairedAt: '2026-07-15T20:00:00.000Z',
    lastUsedAt: '2026-07-16T00:20:00.000Z',
    revokedAt: null,
    revokedByAccountId: null,
    revision: 4,
    created: NOW,
    updated: NOW,
    ...overrides,
  };
}

describe('PrivilegedDeviceManager', () => {
  const deviceCollection = {
    getFullList: vi.fn(async () => [device()]),
    getFirstListItem: vi.fn(async () => device()),
    update: vi.fn(async (id: string, data: Record<string, unknown>) => device({ id, ...data })),
  };
  const accountCollection = {
    getFullList: vi.fn(async () => [account()]),
    getOne: vi.fn(async () => account()),
  };
  const pb = {
    collection: vi.fn((name: string) => {
      if (name === RELAY_PRIVILEGED_DEVICES_COLLECTION) return deviceCollection;
      if (name === RELAY_PRIVILEGED_ACCOUNTS_COLLECTION) return accountCollection;
      throw new Error(`Unexpected collection ${name}`);
    }),
  };
  const onDeviceRevoked = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    deviceCollection.getFullList.mockResolvedValue([device()]);
    deviceCollection.getFirstListItem.mockResolvedValue(device());
    accountCollection.getFullList.mockResolvedValue([account()]);
    accountCollection.getOne.mockResolvedValue(account());
  });

  function manager() {
    return new PrivilegedDeviceManager({
      pb: pb as never,
      now: () => Date.parse(NOW),
      onDeviceRevoked,
    });
  }

  it('returns bounded account-shaped device views without reading the operator roster', async () => {
    deviceCollection.getFullList.mockResolvedValue([
      device({ lastUsedAt: '2026-07-16 00:20:00.000Z' }),
    ]);
    const result = await manager().list({ role: 'owner', accountId: 'account-admin' });
    expect(result).toEqual([
      {
        id: 'device-record',
        deviceId: 'device-1',
        accountId: 'account-admin',
        username: 'ryan',
        displayName: 'Ryan Bledsoe',
        label: 'Work laptop',
        hostname: 'NOC-LT-01',
        state: 'active',
        lastSeenAt: '2026-07-16T00:20:00.000Z',
        fingerprintSuffix: '1A2B3C4D',
        revision: 4,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('must-not-return');
    expect(JSON.stringify(result)).not.toContain('a'.repeat(56));
  });

  it('limits publisher visibility to devices on the publisher account', async () => {
    await manager().list({ role: 'publisher', accountId: 'account-publisher' });
    expect(deviceCollection.getFullList).toHaveBeenCalledWith({
      filter: 'accountId="account-publisher"',
      requestKey: null,
    });
  });

  it('lets the effective Owner rename a device with an expected revision', async () => {
    await manager().rename({
      actorRole: 'owner',
      deviceId: 'device-1',
      label: 'Ryan laptop',
      expectedRevision: 4,
    });
    expect(deviceCollection.update).toHaveBeenCalledWith(
      'device-record',
      { label: 'Ryan laptop', revision: 5 },
      { requestKey: null },
    );

    await expect(
      manager().rename({
        actorRole: 'owner',
        deviceId: 'device-1',
        label: 'Ryan laptop',
        expectedRevision: 3,
      }),
    ).rejects.toEqual(new PrivilegedDeviceConflictError(4));
  });

  it('lets the effective Owner revoke by account ID and treats a revoked retry as success', async () => {
    await manager().revoke({
      actorRole: 'owner',
      actorAccountId: 'account-admin',
      deviceId: 'device-1',
      expectedRevision: 4,
    });
    expect(deviceCollection.update).toHaveBeenCalledWith(
      'device-record',
      {
        state: 'revoked',
        revokedAt: NOW,
        revokedByAccountId: 'account-admin',
        revision: 5,
      },
      { requestKey: null },
    );
    expect(onDeviceRevoked).toHaveBeenCalledWith('account-admin', 'device-1');

    deviceCollection.getFirstListItem.mockResolvedValue(
      device({ state: 'revoked', revision: 5, revokedAt: NOW }),
    );
    await expect(
      manager().revoke({
        actorRole: 'owner',
        actorAccountId: 'account-admin',
        deviceId: 'device-1',
        expectedRevision: 4,
      }),
    ).resolves.toMatchObject({ state: 'revoked', revision: 5 });
    expect(deviceCollection.update).toHaveBeenCalledTimes(1);
  });

  it('does not mutate when account projection fails before an Owner rename', async () => {
    accountCollection.getOne.mockRejectedValueOnce(new Error('account missing'));

    await expect(
      manager().rename({
        actorRole: 'owner',
        deviceId: 'device-1',
        label: 'New label',
        expectedRevision: 4,
      }),
    ).rejects.toThrow('account missing');
    expect(deviceCollection.update).not.toHaveBeenCalled();
  });

  it('rejects roles without devices.manage even when a publisher can see its own device', async () => {
    await expect(
      manager().rename({
        actorRole: 'publisher',
        deviceId: 'device-1',
        label: 'New label',
        expectedRevision: 4,
      }),
    ).rejects.toThrow(/device-management/i);
    await expect(
      manager().revoke({
        actorRole: 'publisher',
        actorAccountId: 'account-publisher',
        deviceId: 'device-1',
        expectedRevision: 4,
      }),
    ).rejects.toThrow(/device-management/i);
    expect(deviceCollection.update).not.toHaveBeenCalled();
  });
});
