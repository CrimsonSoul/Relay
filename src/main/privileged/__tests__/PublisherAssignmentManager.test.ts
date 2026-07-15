import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_DEVICES_COLLECTION,
  RELAY_PRIVILEGED_STATE_COLLECTION,
  type RelayPrivilegedAccountRecord,
  type RelayPrivilegedDeviceRecord,
  type RelayPrivilegedStateRecord,
} from '@shared/privilegedAccess';
import { RELAY_OPERATORS_COLLECTION, type RelayOperatorRecord } from '@shared/operators';
import {
  PublisherAssignmentConflictError,
  PublisherAssignmentManager,
} from '../PublisherAssignmentManager';

const NOW = '2026-07-16T00:00:00.000Z';

function state(overrides: Partial<RelayPrivilegedStateRecord> = {}): RelayPrivilegedStateRecord {
  return {
    id: 'state-1',
    key: 'primary',
    adminOperatorId: 'operator-admin',
    publisherOperatorId: null,
    assignmentVersion: 3,
    rosterMigrationVersion: 1,
    updatedByOperatorId: null,
    updatedAt: NOW,
    created: NOW,
    updated: NOW,
    ...overrides,
  };
}

function operator(overrides: Partial<RelayOperatorRecord> = {}): RelayOperatorRecord {
  return {
    id: 'operator-publisher',
    displayName: 'Morgan Lee',
    active: true,
    revision: 1,
    created: NOW,
    updated: NOW,
    ...overrides,
  };
}

function account(
  overrides: Partial<RelayPrivilegedAccountRecord> = {},
): RelayPrivilegedAccountRecord {
  return {
    id: 'account-publisher',
    operatorId: 'operator-publisher',
    role: 'publisher',
    active: true,
    mustChangePassword: false,
    credentialVersion: 2,
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
    revokedByOperatorId: null,
    revision: 1,
    created: NOW,
    updated: NOW,
    ...overrides,
  };
}

describe('PublisherAssignmentManager', () => {
  const stateCollection = {
    getFirstListItem: vi.fn(async () => state()),
    update: vi.fn(async (_id: string, data: Record<string, unknown>) => state(data)),
  };
  const operatorCollection = { getOne: vi.fn(async () => operator()) };
  const accountCollection = {
    getFirstListItem: vi.fn(async () => account()),
    create: vi.fn(async (data: Record<string, unknown>) => account(data)),
    update: vi.fn(async (id: string, data: Record<string, unknown>) => account({ id, ...data })),
  };
  const deviceCollection = {
    getFullList: vi.fn(async () => [device()]),
    update: vi.fn(async (id: string, data: Record<string, unknown>) => device({ id, ...data })),
  };
  const pb = {
    collection: vi.fn((name: string) => {
      if (name === RELAY_PRIVILEGED_STATE_COLLECTION) return stateCollection;
      if (name === RELAY_OPERATORS_COLLECTION) return operatorCollection;
      if (name === RELAY_PRIVILEGED_ACCOUNTS_COLLECTION) return accountCollection;
      if (name === RELAY_PRIVILEGED_DEVICES_COLLECTION) return deviceCollection;
      throw new Error(`Unexpected collection ${name}`);
    }),
  };
  const onAssignmentChanged = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    stateCollection.getFirstListItem.mockResolvedValue(state());
    operatorCollection.getOne.mockResolvedValue(operator());
    accountCollection.getFirstListItem.mockResolvedValue(account());
    deviceCollection.getFullList.mockResolvedValue([device()]);
  });

  function manager() {
    return new PublisherAssignmentManager({
      pb: pb as never,
      now: () => Date.parse(NOW),
      onAssignmentChanged,
    });
  }

  it('assigns one active non-admin operator and leaves its credential pending local setup', async () => {
    await expect(
      manager().assign({
        operatorId: 'operator-publisher',
        expectedStateRevision: 3,
        actorOperatorId: 'operator-admin',
      }),
    ).resolves.toEqual({
      publisherOperatorId: 'operator-publisher',
      assignmentRevision: 4,
      credentialState: 'pending-local-setup',
    });

    expect(accountCollection.update).toHaveBeenCalledWith(
      'account-publisher',
      expect.objectContaining({
        role: 'publisher',
        active: false,
        mustChangePassword: true,
        credentialVersion: 3,
        password: expect.any(String),
        passwordConfirm: expect.any(String),
      }),
      { requestKey: null },
    );
    expect(stateCollection.update).toHaveBeenCalledWith(
      'state-1',
      {
        publisherOperatorId: 'operator-publisher',
        assignmentVersion: 4,
        updatedByOperatorId: 'operator-admin',
        updatedAt: NOW,
      },
      { requestKey: null },
    );
  });

  it('creates a pending publisher account when the operator has never held the role', async () => {
    accountCollection.getFirstListItem.mockRejectedValue({ status: 404 });
    await manager().assign({
      operatorId: 'operator-publisher',
      expectedStateRevision: 3,
      actorOperatorId: 'operator-admin',
    });

    expect(accountCollection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        operatorId: 'operator-publisher',
        role: 'publisher',
        active: false,
        mustChangePassword: true,
        credentialVersion: 0,
      }),
      { requestKey: null },
    );
  });

  it('reassigns without two authoritative publishers and revokes the previous publisher', async () => {
    stateCollection.getFirstListItem.mockResolvedValue(
      state({ publisherOperatorId: 'operator-previous' }),
    );
    accountCollection.getFirstListItem.mockResolvedValueOnce(account()).mockResolvedValueOnce(
      account({
        id: 'account-previous',
        operatorId: 'operator-previous',
        credentialVersion: 4,
      }),
    );

    await manager().assign({
      operatorId: 'operator-publisher',
      expectedStateRevision: 3,
      actorOperatorId: 'operator-admin',
    });

    expect(stateCollection.update).toHaveBeenCalledTimes(1);
    expect(stateCollection.update).toHaveBeenCalledWith(
      'state-1',
      expect.objectContaining({ publisherOperatorId: 'operator-publisher' }),
      { requestKey: null },
    );
    expect(accountCollection.update).toHaveBeenCalledWith(
      'account-previous',
      expect.objectContaining({ active: false, mustChangePassword: true }),
      { requestKey: null },
    );
    expect(onAssignmentChanged).toHaveBeenCalledWith(['operator-previous', 'operator-publisher']);
  });

  it('permits removing the publisher entirely', async () => {
    stateCollection.getFirstListItem.mockResolvedValue(
      state({ publisherOperatorId: 'operator-previous' }),
    );
    accountCollection.getFirstListItem.mockResolvedValue(
      account({ id: 'account-previous', operatorId: 'operator-previous' }),
    );

    await expect(
      manager().assign({
        operatorId: null,
        expectedStateRevision: 3,
        actorOperatorId: 'operator-admin',
      }),
    ).resolves.toEqual({
      publisherOperatorId: null,
      assignmentRevision: 4,
      credentialState: 'not-assigned',
    });
    expect(operatorCollection.getOne).not.toHaveBeenCalled();
  });

  it('rejects stale state, a disabled operator, and the administrator', async () => {
    await expect(
      manager().assign({
        operatorId: 'operator-publisher',
        expectedStateRevision: 2,
        actorOperatorId: 'operator-admin',
      }),
    ).rejects.toEqual(new PublisherAssignmentConflictError(3));

    operatorCollection.getOne.mockResolvedValue(operator({ active: false }));
    await expect(
      manager().assign({
        operatorId: 'operator-publisher',
        expectedStateRevision: 3,
        actorOperatorId: 'operator-admin',
      }),
    ).rejects.toThrow(/active operator/i);

    operatorCollection.getOne.mockResolvedValue(operator({ id: 'operator-admin' }));
    await expect(
      manager().assign({
        operatorId: 'operator-admin',
        expectedStateRevision: 3,
        actorOperatorId: 'operator-admin',
      }),
    ).rejects.toThrow(/administrator/i);
  });
});
