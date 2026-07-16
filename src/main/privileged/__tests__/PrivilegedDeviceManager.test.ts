import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_DEVICES_COLLECTION,
  type RelayPrivilegedAccountRecord,
  type RelayPrivilegedDeviceRecord,
} from '@shared/privilegedAccess';
import { RELAY_OPERATORS_COLLECTION, type RelayOperatorRecord } from '@shared/operators';
import { PrivilegedDeviceConflictError, PrivilegedDeviceManager } from '../PrivilegedDeviceManager';

const NOW = '2026-07-16T00:30:00.000Z';

function account(
  overrides: Partial<RelayPrivilegedAccountRecord> = {},
): RelayPrivilegedAccountRecord {
  return {
    id: 'account-admin',
    operatorId: 'operator-admin',
    role: 'admin',
    active: true,
    mustChangePassword: false,
    credentialVersion: 1,
    created: NOW,
    updated: NOW,
    ...overrides,
  };
}

function operator(overrides: Partial<RelayOperatorRecord> = {}): RelayOperatorRecord {
  return {
    id: 'operator-admin',
    displayName: 'Ryan Bledsoe',
    active: true,
    revision: 1,
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
    revokedByOperatorId: null,
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
  const accountCollection = { getFullList: vi.fn(async () => [account()]) };
  const operatorCollection = { getFullList: vi.fn(async () => [operator()]) };
  const pb = {
    collection: vi.fn((name: string) => {
      if (name === RELAY_PRIVILEGED_DEVICES_COLLECTION) return deviceCollection;
      if (name === RELAY_PRIVILEGED_ACCOUNTS_COLLECTION) return accountCollection;
      if (name === RELAY_OPERATORS_COLLECTION) return operatorCollection;
      throw new Error(`Unexpected collection ${name}`);
    }),
  };
  const onDeviceRevoked = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    deviceCollection.getFullList.mockResolvedValue([device()]);
    deviceCollection.getFirstListItem.mockResolvedValue(device());
    accountCollection.getFullList.mockResolvedValue([account()]);
    operatorCollection.getFullList.mockResolvedValue([operator()]);
  });

  function manager() {
    return new PrivilegedDeviceManager({
      pb: pb as never,
      now: () => Date.parse(NOW),
      onDeviceRevoked,
    });
  }

  it('returns a sanitized device list for an administrator', async () => {
    const result = await manager().list({ role: 'admin', accountId: 'account-admin' });
    expect(result).toEqual([
      {
        id: 'device-record',
        deviceId: 'device-1',
        accountId: 'account-admin',
        operatorId: 'operator-admin',
        operatorName: 'Ryan Bledsoe',
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

  it('renames a device with an expected revision and reports stale conflicts', async () => {
    await manager().rename({
      actorRole: 'admin',
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
        actorRole: 'admin',
        deviceId: 'device-1',
        label: 'Ryan laptop',
        expectedRevision: 3,
      }),
    ).rejects.toEqual(new PrivilegedDeviceConflictError(4));
  });

  it('revokes a device, invalidates its session, and treats an already-revoked retry as success', async () => {
    await manager().revoke({
      actorRole: 'admin',
      actorOperatorId: 'operator-admin',
      deviceId: 'device-1',
      expectedRevision: 4,
    });
    expect(deviceCollection.update).toHaveBeenCalledWith(
      'device-record',
      {
        state: 'revoked',
        revokedAt: NOW,
        revokedByOperatorId: 'operator-admin',
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
        actorRole: 'admin',
        actorOperatorId: 'operator-admin',
        deviceId: 'device-1',
        expectedRevision: 4,
      }),
    ).resolves.toMatchObject({ state: 'revoked', revision: 5 });
    expect(deviceCollection.update).toHaveBeenCalledTimes(1);
  });

  it('rejects non-admin mutations even when a publisher can see its own device', async () => {
    await expect(
      manager().rename({
        actorRole: 'publisher',
        deviceId: 'device-1',
        label: 'New label',
        expectedRevision: 4,
      }),
    ).rejects.toThrow(/administrator/i);
    await expect(
      manager().revoke({
        actorRole: 'publisher',
        actorOperatorId: 'operator-publisher',
        deviceId: 'device-1',
        expectedRevision: 4,
      }),
    ).rejects.toThrow(/administrator/i);
    expect(deviceCollection.update).not.toHaveBeenCalled();
  });
});
