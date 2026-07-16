import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_PRIVILEGED_PASSWORD_LENGTH,
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
const NOW = '2026-07-15T23:00:00.000Z';

function account(
  overrides: Partial<RelayPrivilegedAccountRecord> = {},
): RelayPrivilegedAccountRecord {
  return {
    id: 'account-admin',
    operatorId: 'operator-admin',
    role: 'admin',
    active: false,
    mustChangePassword: true,
    credentialVersion: 0,
    created: '2026-07-15T20:00:00.000Z',
    updated: '2026-07-15T20:00:00.000Z',
    ...overrides,
  };
}

function state(overrides: Partial<RelayPrivilegedStateRecord> = {}): RelayPrivilegedStateRecord {
  return {
    id: 'state-1',
    key: 'primary',
    adminOperatorId: 'operator-admin',
    adminOperatorIds: ['operator-admin', 'operator-charles'],
    publisherOperatorId: 'operator-publisher',
    assignmentVersion: 2,
    rosterMigrationVersion: 1,
    updatedByOperatorId: null,
    updatedAt: NOW,
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
    publicKey: '{}',
    fingerprint: 'a'.repeat(64),
    state: 'active',
    pairedAt: NOW,
    lastUsedAt: NOW,
    revokedAt: null,
    revokedByOperatorId: null,
    revision: 3,
    created: NOW,
    updated: NOW,
    ...overrides,
  };
}

describe('PrivilegedAccountManager', () => {
  const accountCollection = {
    getFirstListItem: vi.fn(async () => account()),
    update: vi.fn(async (id: string, data: Record<string, unknown>) => account({ id, ...data })),
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
    accountCollection.getFirstListItem.mockResolvedValue(account());
    stateCollection.getFirstListItem.mockResolvedValue(state());
    deviceCollection.getFullList.mockResolvedValue([device()]);
  });

  function manager() {
    return new PrivilegedAccountManager({
      pb: pb as never,
      now: () => Date.parse(NOW),
      onCredentialChanged,
    });
  }

  it('sets the first Ryan Bledsoe administrator password only from pending bootstrap state', async () => {
    await expect(
      manager().setupInitialAdministrator({
        operatorId: 'operator-admin',
        password: PASSWORD,
        passwordConfirm: PASSWORD,
      }),
    ).resolves.toEqual({
      accountId: 'account-admin',
      operatorId: 'operator-admin',
      role: 'admin',
      credentialState: 'configured',
      credentialVersion: 1,
    });

    expect(accountCollection.update).toHaveBeenCalledWith(
      'account-admin',
      {
        password: PASSWORD,
        passwordConfirm: PASSWORD,
        active: true,
        mustChangePassword: false,
        credentialVersion: 1,
      },
      { requestKey: null },
    );
  });

  it('does not accept an unreachable bootstrap credential as a shipped default', async () => {
    accountCollection.getFirstListItem.mockResolvedValue(
      account({ active: true, mustChangePassword: false }),
    );
    await expect(
      manager().setupInitialAdministrator({
        operatorId: 'operator-admin',
        password: PASSWORD,
        passwordConfirm: PASSWORD,
      }),
    ).rejects.toThrow(/already configured/i);
    expect(accountCollection.update).not.toHaveBeenCalled();
  });

  it.each([
    'x'.repeat(MIN_PRIVILEGED_PASSWORD_LENGTH - 1),
    'x'.repeat(MAX_PRIVILEGED_PASSWORD_LENGTH + 1),
  ])('rejects out-of-bounds passwords without touching PocketBase', async (password) => {
    await expect(
      manager().setupInitialAdministrator({
        operatorId: 'operator-admin',
        password,
        passwordConfirm: password,
      }),
    ).rejects.toThrow(/password/i);
    expect(pb.collection).not.toHaveBeenCalled();
  });

  it('rejects a non-authoritative initial administrator operator', async () => {
    await expect(
      manager().setupInitialAdministrator({
        operatorId: 'operator-other',
        password: PASSWORD,
        passwordConfirm: PASSWORD,
      }),
    ).rejects.toThrow(/not available/i);
    expect(accountCollection.update).not.toHaveBeenCalled();
  });

  it('sets up or recovers the current publisher credential for a local administrator', async () => {
    accountCollection.getFirstListItem.mockResolvedValue(
      account({
        id: 'account-publisher',
        operatorId: 'operator-publisher',
        role: 'publisher',
      }),
    );
    deviceCollection.getFullList.mockResolvedValue([
      device({ id: 'publisher-device', accountId: 'account-publisher' }),
    ]);
    accountCollection.update.mockResolvedValueOnce(
      account({
        id: 'account-publisher',
        operatorId: 'operator-publisher',
        role: 'publisher',
        active: true,
        mustChangePassword: false,
        credentialVersion: 1,
      }),
    );

    await expect(
      manager().setupCredential({
        actorOperatorId: 'operator-admin',
        operatorId: 'operator-publisher',
        password: PASSWORD,
        passwordConfirm: PASSWORD,
      }),
    ).resolves.toMatchObject({
      operatorId: 'operator-publisher',
      role: 'publisher',
      credentialState: 'configured',
    });
    expect(deviceCollection.update).toHaveBeenCalledWith(
      'publisher-device',
      expect.objectContaining({
        state: 'revoked',
        revokedAt: NOW,
        revokedByOperatorId: 'operator-admin',
        revision: 4,
      }),
      { requestKey: null },
    );
    expect(onCredentialChanged).toHaveBeenCalledWith('operator-publisher');
  });

  it('lets the owner configure Charles and lets Charles administer another privileged account', async () => {
    accountCollection.getFirstListItem.mockResolvedValueOnce(
      account({ id: 'account-charles', operatorId: 'operator-charles', role: 'admin' }),
    );
    accountCollection.update.mockResolvedValueOnce(
      account({
        id: 'account-charles',
        operatorId: 'operator-charles',
        role: 'admin',
        active: true,
        mustChangePassword: false,
        credentialVersion: 1,
      }),
    );

    await expect(
      manager().setupCredential({
        actorOperatorId: 'operator-admin',
        operatorId: 'operator-charles',
        password: PASSWORD,
        passwordConfirm: PASSWORD,
      }),
    ).resolves.toMatchObject({ operatorId: 'operator-charles', role: 'admin' });

    accountCollection.getFirstListItem.mockResolvedValueOnce(
      account({
        id: 'account-publisher',
        operatorId: 'operator-publisher',
        role: 'publisher',
      }),
    );
    accountCollection.update.mockResolvedValueOnce(
      account({
        id: 'account-publisher',
        operatorId: 'operator-publisher',
        role: 'publisher',
        active: true,
        mustChangePassword: false,
        credentialVersion: 1,
      }),
    );

    await expect(
      manager().setupCredential({
        actorOperatorId: 'operator-charles',
        operatorId: 'operator-publisher',
        password: PASSWORD,
        passwordConfirm: PASSWORD,
      }),
    ).resolves.toMatchObject({ operatorId: 'operator-publisher', role: 'publisher' });
  });

  it('rejects credential setup by a non-admin or for an unassigned target', async () => {
    await expect(
      manager().setupCredential({
        actorOperatorId: 'operator-publisher',
        operatorId: 'operator-publisher',
        password: PASSWORD,
        passwordConfirm: PASSWORD,
      }),
    ).rejects.toThrow(/unauthorized/i);

    await expect(
      manager().setupCredential({
        actorOperatorId: 'operator-admin',
        operatorId: 'operator-other',
        password: PASSWORD,
        passwordConfirm: PASSWORD,
      }),
    ).rejects.toThrow(/not available/i);
    expect(accountCollection.update).not.toHaveBeenCalled();
  });
});
