import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_DEVICES_COLLECTION,
  RELAY_PRIVILEGED_STATE_COLLECTION,
  type RelayPrivilegedAccountRecord,
  type RelayPrivilegedDeviceRecord,
  type RelayPrivilegedStateRecord,
} from '@shared/privilegedAccess';
import {
  PublisherAssignmentConflictError,
  PublisherAssignmentManager,
} from '../PublisherAssignmentManager';
import { RoleAccountManager } from '../RoleAccountManager';

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
    publisherAccountId: null,
    assignmentVersion: 3,
    identityMigrationVersion: 1,
    updatedByAccountId: null,
    created: NOW,
    updated: NOW,
    ...overrides,
  };
}
function device(overrides: Partial<RelayPrivilegedDeviceRecord> = {}): RelayPrivilegedDeviceRecord {
  return {
    id: 'device-publisher',
    accountId: 'account-publisher',
    deviceId: 'device-1',
    hostnameSnapshot: 'publisher-host',
    label: 'Publisher device',
    publicKey: '{}',
    fingerprint: 'a'.repeat(64),
    state: 'active',
    pairedAt: NOW,
    lastUsedAt: NOW,
    revokedAt: null,
    revokedByAccountId: null,
    revision: 2,
    created: NOW,
    updated: NOW,
    ...overrides,
  };
}

describe('PublisherAssignmentManager', () => {
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
        displayName: 'Publisher',
        storedRole: 'publisher',
      }),
    ],
    [
      'account-previous',
      account({
        id: 'account-previous',
        username: 'previous',
        displayName: 'Previous',
        storedRole: 'publisher',
        credentialVersion: 4,
      }),
    ],
  ]);
  const stateCollection = { getFirstListItem: vi.fn(async () => state()), update: vi.fn() };
  const accountCollection = {
    getFullList: vi.fn(async () => [...records.values()]),
    getOne: vi.fn(async (id: string) => records.get(id)),
    create: vi.fn(async (data: Record<string, unknown>) =>
      account({ id: `account-${String(data.username)}`, ...data }),
    ),
    update: vi.fn(),
    delete: vi.fn(async () => true),
  };
  const deviceCollection = {
    getFullList: vi.fn(async (): Promise<RelayPrivilegedDeviceRecord[]> => []),
    update: vi.fn(),
  };
  const pb = {
    collection: vi.fn((name: string) => {
      if (name === RELAY_PRIVILEGED_STATE_COLLECTION) return stateCollection;
      if (name === RELAY_PRIVILEGED_ACCOUNTS_COLLECTION) return accountCollection;
      if (name === RELAY_PRIVILEGED_DEVICES_COLLECTION) return deviceCollection;
      throw new Error(`Unexpected collection ${name}`);
    }),
  };
  const onAssignmentChanged = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    stateCollection.getFirstListItem.mockResolvedValue(state());
    accountCollection.getOne.mockImplementation(async (id: string) => records.get(id));
  });
  const manager = (coordinator?: TestAuthorityMutationCoordinator) =>
    new PublisherAssignmentManager({
      pb: pb as never,
      now: () => Date.parse(NOW),
      onAssignmentChanged,
      coordinator,
    });

  class TestAuthorityMutationCoordinator {
    private tail: Promise<void> = Promise.resolve();

    run<T>(operation: () => Promise<T>): Promise<T> {
      const result = this.tail.then(operation);
      this.tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    }
  }

  it.each(['account-ryan', 'account-charles'])(
    'allows Owner or Administrator %s to assign Publisher by account ID',
    async (actorAccountId) => {
      await expect(
        manager().assign({
          actorAccountId,
          accountId: 'account-publisher',
          expectedStateRevision: 3,
        }),
      ).resolves.toEqual({
        publisherAccountId: 'account-publisher',
        assignmentRevision: 4,
        credentialState: 'pending-local-setup',
      });
      expect(stateCollection.update).toHaveBeenCalledWith(
        'state-1',
        {
          publisherAccountId: 'account-publisher',
          assignmentVersion: 4,
          updatedByAccountId: actorAccountId,
          updatedAt: NOW,
        },
        { requestKey: null },
      );
    },
  );

  it('never converts an Administrator account into Publisher', async () => {
    await expect(
      manager().assign({
        actorAccountId: 'account-charles',
        accountId: 'account-ryan',
        expectedStateRevision: 3,
      }),
    ).rejects.toThrow(/Publisher account/i);
    expect(accountCollection.update).not.toHaveBeenCalled();
  });

  it('replaces the singleton Publisher and disables only the previous Publisher account', async () => {
    stateCollection.getFirstListItem.mockResolvedValue(
      state({ publisherAccountId: 'account-previous' }),
    );
    await manager().assign({
      actorAccountId: 'account-charles',
      accountId: 'account-publisher',
      expectedStateRevision: 3,
    });
    expect(accountCollection.update).toHaveBeenCalledWith(
      'account-previous',
      expect.objectContaining({ active: false, mustChangePassword: true }),
      { requestKey: null },
    );
    expect(onAssignmentChanged).toHaveBeenCalledWith(['account-previous', 'account-publisher']);
  });

  it('returns the established conflict shape and rejects Publisher actors', async () => {
    await expect(
      manager().assign({
        actorAccountId: 'account-charles',
        accountId: null,
        expectedStateRevision: 2,
      }),
    ).rejects.toEqual(new PublisherAssignmentConflictError(3));
    await expect(
      manager().assign({
        actorAccountId: 'account-publisher',
        accountId: null,
        expectedStateRevision: 3,
      }),
    ).rejects.toThrow(/unauthorized/i);
  });

  it('detects a mid-operation assignment change before resetting credentials or devices', async () => {
    stateCollection.getFirstListItem
      .mockResolvedValueOnce(state())
      .mockResolvedValueOnce(
        state({ assignmentVersion: 4, publisherAccountId: 'account-previous' }),
      );

    await expect(
      manager().assign({
        actorAccountId: 'account-charles',
        accountId: 'account-publisher',
        expectedStateRevision: 3,
      }),
    ).rejects.toEqual(new PublisherAssignmentConflictError(4));

    expect(stateCollection.update).not.toHaveBeenCalled();
    expect(accountCollection.update).not.toHaveBeenCalled();
    expect(deviceCollection.getFullList).not.toHaveBeenCalled();
    expect(onAssignmentChanged).not.toHaveBeenCalled();
  });

  it('does not move the pointer when target preparation fails before changing the account', async () => {
    accountCollection.update.mockRejectedValueOnce(new Error('target preparation failed'));

    await expect(
      manager().assign({
        actorAccountId: 'account-charles',
        accountId: 'account-publisher',
        expectedStateRevision: 3,
      }),
    ).rejects.toThrow('target preparation failed');

    expect(stateCollection.update).not.toHaveBeenCalled();
    expect(deviceCollection.getFullList).not.toHaveBeenCalled();
    expect(onAssignmentChanged).not.toHaveBeenCalled();
  });

  it('invalidates a remotely prepared target when its update response is lost without moving the pointer', async () => {
    let preparedTarget = records.get('account-publisher')!;
    accountCollection.getOne.mockImplementation(async (id: string) =>
      id === 'account-publisher' ? preparedTarget : records.get(id),
    );
    accountCollection.update.mockImplementationOnce(
      async (id: string, data: Record<string, unknown>) => {
        preparedTarget = account({ ...preparedTarget, id, ...data });
        throw new Error('target preparation response lost');
      },
    );
    deviceCollection.getFullList.mockResolvedValueOnce([device()]);

    await expect(
      manager().assign({
        actorAccountId: 'account-charles',
        accountId: 'account-publisher',
        expectedStateRevision: 3,
      }),
    ).rejects.toThrow('target preparation response lost');

    expect(preparedTarget).toMatchObject({
      active: false,
      mustChangePassword: true,
      credentialVersion: 2,
    });
    expect(stateCollection.update).not.toHaveBeenCalled();
    expect(deviceCollection.update).toHaveBeenCalledWith(
      'device-publisher',
      expect.objectContaining({
        state: 'revoked',
        revokedByAccountId: 'account-charles',
        revision: 3,
      }),
      { requestKey: null },
    );
    expect(onAssignmentChanged).toHaveBeenCalledWith(['account-publisher']);
  });

  it('leaves a partially prepared target inactive and invalidates it without moving the pointer', async () => {
    deviceCollection.getFullList.mockResolvedValueOnce([device()]);
    deviceCollection.update.mockRejectedValueOnce(new Error('device revocation failed'));

    await expect(
      manager().assign({
        actorAccountId: 'account-charles',
        accountId: 'account-publisher',
        expectedStateRevision: 3,
      }),
    ).rejects.toThrow('device revocation failed');

    expect(accountCollection.update).toHaveBeenCalledWith(
      'account-publisher',
      expect.objectContaining({ active: false, mustChangePassword: true }),
      { requestKey: null },
    );
    expect(stateCollection.update).not.toHaveBeenCalled();
    expect(onAssignmentChanged).toHaveBeenCalledWith(['account-publisher']);
  });

  it('treats a failed singleton response as committed after authoritative verification', async () => {
    let currentState = state();
    stateCollection.getFirstListItem.mockImplementation(async () => currentState);
    stateCollection.update.mockImplementationOnce(
      async (_id: string, data: Record<string, unknown>) => {
        currentState = state({ ...data });
        throw new Error('singleton response lost');
      },
    );

    await expect(
      manager().assign({
        actorAccountId: 'account-charles',
        accountId: 'account-publisher',
        expectedStateRevision: 3,
      }),
    ).resolves.toEqual({
      publisherAccountId: 'account-publisher',
      assignmentRevision: 4,
      credentialState: 'pending-local-setup',
    });

    expect(currentState).toMatchObject({
      publisherAccountId: 'account-publisher',
      assignmentVersion: 4,
      updatedByAccountId: 'account-charles',
    });
    expect(onAssignmentChanged).toHaveBeenCalledWith(['account-publisher']);
  });

  it('keeps a committed replacement coherent and invalidates both accounts when former disablement fails', async () => {
    let currentState = state({ publisherAccountId: 'account-previous' });
    stateCollection.getFirstListItem.mockImplementation(async () => currentState);
    stateCollection.update.mockImplementation(
      async (_id: string, data: Record<string, unknown>) => {
        currentState = state({ ...data });
        return currentState;
      },
    );
    accountCollection.update.mockImplementation(async (id: string) => {
      if (id === 'account-previous') throw new Error('former disable failed');
      return records.get(id);
    });

    await expect(
      manager().assign({
        actorAccountId: 'account-charles',
        accountId: 'account-publisher',
        expectedStateRevision: 3,
      }),
    ).rejects.toThrow('former disable failed');

    expect(currentState).toMatchObject({
      publisherAccountId: 'account-publisher',
      assignmentVersion: 4,
    });
    expect(accountCollection.update).toHaveBeenNthCalledWith(
      1,
      'account-publisher',
      expect.objectContaining({ active: false, mustChangePassword: true }),
      { requestKey: null },
    );
    expect(onAssignmentChanged).toHaveBeenCalledWith(['account-previous', 'account-publisher']);
  });

  it('reports callback failure as a committed assignment with failed invalidation', async () => {
    let currentState = state();
    stateCollection.getFirstListItem.mockImplementation(async () => currentState);
    stateCollection.update.mockImplementation(
      async (_id: string, data: Record<string, unknown>) => {
        currentState = state({ ...data });
        return currentState;
      },
    );
    onAssignmentChanged.mockRejectedValueOnce(new Error('callback unavailable'));

    await expect(
      manager().assign({
        actorAccountId: 'account-charles',
        accountId: 'account-publisher',
        expectedStateRevision: 3,
      }),
    ).rejects.toMatchObject({
      name: 'PublisherAssignmentNotificationError',
      message: expect.stringMatching(/committed.*invalidation failed/i),
    });

    expect(currentState).toMatchObject({
      publisherAccountId: 'account-publisher',
      assignmentVersion: 4,
    });
  });

  it('serializes simultaneous assignments so only one expected revision can commit', async () => {
    let currentState = state();
    stateCollection.getFirstListItem.mockImplementation(async () => currentState);
    stateCollection.update.mockImplementation(
      async (_id: string, data: Record<string, unknown>) => {
        currentState = state({ ...data });
        return currentState;
      },
    );
    records.set(
      'account-publisher-2',
      account({
        id: 'account-publisher-2',
        username: 'publisher-2',
        displayName: 'Publisher Two',
        storedRole: 'publisher',
      }),
    );
    const assignmentManager = manager();

    const results = await Promise.allSettled([
      assignmentManager.assign({
        actorAccountId: 'account-charles',
        accountId: 'account-publisher',
        expectedStateRevision: 3,
      }),
      assignmentManager.assign({
        actorAccountId: 'account-charles',
        accountId: 'account-publisher-2',
        expectedStateRevision: 3,
      }),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: new PublisherAssignmentConflictError(4),
    });
    expect(stateCollection.update).toHaveBeenCalledTimes(1);
  });

  it('shares authority serialization across account creation and Publisher assignment', async () => {
    let currentState = state();
    stateCollection.getFirstListItem.mockImplementation(async () => currentState);
    stateCollection.update.mockImplementation(
      async (_id: string, data: Record<string, unknown>) => {
        currentState = state({ ...data });
        return currentState;
      },
    );
    const coordinator = new TestAuthorityMutationCoordinator();
    const roleManager = new RoleAccountManager({
      pb: pb as never,
      snapshotReader: { read: vi.fn(async () => ({ generatedAt: NOW })) } as never,
      now: () => Date.parse(NOW),
      coordinator,
    });
    const publisherManager = manager(coordinator);

    const results = await Promise.allSettled([
      roleManager.createAdministrator({
        actorAccountId: 'account-ryan',
        username: 'admin-2',
        displayName: 'Admin Two',
        expectedStateRevision: 3,
      }),
      publisherManager.assign({
        actorAccountId: 'account-charles',
        accountId: 'account-publisher',
        expectedStateRevision: 3,
      }),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: new PublisherAssignmentConflictError(4),
    });
    expect(currentState.assignmentVersion).toBe(4);
    expect(stateCollection.update).toHaveBeenCalledTimes(1);
    expect(accountCollection.update).not.toHaveBeenCalled();
    expect(deviceCollection.getFullList).not.toHaveBeenCalled();
  });

  it('reuses the retained Publisher after unassignment instead of creating another account', async () => {
    let currentState = state({ publisherAccountId: 'account-publisher' });
    const currentAccounts = new Map(
      ['account-ryan', 'account-charles', 'account-publisher'].map((id) => [id, records.get(id)!]),
    );
    stateCollection.getFirstListItem.mockImplementation(async () => currentState);
    stateCollection.update.mockImplementation(
      async (_id: string, data: Record<string, unknown>) => {
        currentState = state({
          ...data,
          publisherAccountId:
            data.publisherAccountId === '' ? null : (data.publisherAccountId as string | null),
        });
        return currentState;
      },
    );
    accountCollection.getFullList.mockImplementation(async () => [...currentAccounts.values()]);
    accountCollection.getOne.mockImplementation(async (id: string) => currentAccounts.get(id));
    accountCollection.update.mockImplementation(
      async (id: string, data: Record<string, unknown>) => {
        const updated = account({ ...currentAccounts.get(id), id, ...data });
        currentAccounts.set(id, updated);
        return updated;
      },
    );
    accountCollection.create.mockImplementation(async (data: Record<string, unknown>) => {
      const created = account({ id: `account-${String(data.username)}`, ...data });
      currentAccounts.set(created.id, created);
      return created;
    });
    const coordinator = new TestAuthorityMutationCoordinator();
    const publisherManager = manager(coordinator);
    const roleManager = new RoleAccountManager({
      pb: pb as never,
      snapshotReader: { read: vi.fn(async () => ({ generatedAt: NOW })) } as never,
      now: () => Date.parse(NOW),
      coordinator,
    });

    await publisherManager.assign({
      actorAccountId: 'account-charles',
      accountId: null,
      expectedStateRevision: 3,
    });

    await expect(
      roleManager.createPublisher({
        actorAccountId: 'account-charles',
        username: 'publisher-2',
        displayName: 'Publisher Two',
        expectedStateRevision: 4,
      }),
    ).rejects.toThrow(/retained Publisher account/i);
    expect(currentState.publisherAccountId).toBeNull();
    expect(
      [...currentAccounts.values()].filter(({ storedRole }) => storedRole === 'publisher'),
    ).toHaveLength(1);
    expect(accountCollection.getFullList).toHaveBeenCalledTimes(1);
    expect(accountCollection.create).not.toHaveBeenCalled();
  });
});
