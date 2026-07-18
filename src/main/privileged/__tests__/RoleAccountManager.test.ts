import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_STATE_COLLECTION,
  type RelayPrivilegedAccountRecord,
  type RelayPrivilegedStateRecord,
} from '@shared/privilegedAccess';
import { RoleAccountConflictError, RoleAccountManager } from '../RoleAccountManager';

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
    revision: 2,
    legacyOperatorId: null,
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
    assignmentVersion: 4,
    identityMigrationVersion: 1,
    updatedByAccountId: null,
    created: NOW,
    updated: NOW,
    ...overrides,
  };
}

describe('RoleAccountManager', () => {
  const accounts = [
    account(),
    account({
      id: 'account-charles',
      username: 'charles',
      displayName: 'Charles Gibbs',
      revision: 1,
    }),
  ];
  const accountCollection = {
    getFullList: vi.fn(async () => accounts),
    getOne: vi.fn(async (id: string) => accounts.find((entry) => entry.id === id)!),
    create: vi.fn(async (data: Record<string, unknown>) =>
      account({ id: 'account-created', ...data }),
    ),
    update: vi.fn(async (id: string, data: Record<string, unknown>) =>
      account({ id, ...accounts.find((entry) => entry.id === id), ...data }),
    ),
    delete: vi.fn(async () => true),
  };
  const stateCollection = {
    getFirstListItem: vi.fn(async () => state()),
    update: vi.fn(async (_id: string, data: Record<string, unknown>) => state(data)),
  };
  const pb = {
    collection: vi.fn((name: string) => {
      if (name === RELAY_PRIVILEGED_ACCOUNTS_COLLECTION) return accountCollection;
      if (name === RELAY_PRIVILEGED_STATE_COLLECTION) return stateCollection;
      throw new Error(`Unexpected collection ${name}`);
    }),
  };
  const snapshotReader = { read: vi.fn(async () => ({ generatedAt: NOW })) };
  const onAuthorityChanged = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    accountCollection.getFullList.mockResolvedValue(accounts);
    accountCollection.getOne.mockImplementation(
      async (id: string) => accounts.find((entry) => entry.id === id)!,
    );
    stateCollection.getFirstListItem.mockResolvedValue(state());
    stateCollection.update.mockImplementation(async (_id: string, data: Record<string, unknown>) =>
      state(data),
    );
    accountCollection.delete.mockResolvedValue(true);
  });

  function manager() {
    return new RoleAccountManager({
      pb: pb as never,
      snapshotReader: snapshotReader as never,
      now: () => Date.parse(NOW),
      onAuthorityChanged,
    });
  }

  it('lets only the owner create a normalized pending Administrator', async () => {
    await manager().createAdministrator({
      actorAccountId: 'account-ryan',
      username: '  MORGAN.LEE ',
      displayName: ' Morgan   Lee ',
      expectedStateRevision: 4,
    });

    expect(accountCollection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'morgan.lee',
        displayName: 'Morgan Lee',
        storedRole: 'administrator',
        active: false,
        mustChangePassword: true,
        credentialVersion: 0,
        revision: 0,
        password: expect.any(String),
        passwordConfirm: expect.any(String),
      }),
      { requestKey: null },
    );
    expect(stateCollection.update).toHaveBeenCalledWith(
      'state-1',
      expect.objectContaining({ assignmentVersion: 5, updatedByAccountId: 'account-ryan' }),
      { requestKey: null },
    );

    await expect(
      manager().createAdministrator({
        actorAccountId: 'account-charles',
        username: 'admin-2',
        displayName: 'Admin Two',
        expectedStateRevision: 4,
      }),
    ).rejects.toThrow('Only the Relay owner can manage administrators.');
  });

  it('lets an Administrator create the single Publisher but not replace it implicitly', async () => {
    await manager().createPublisher({
      actorAccountId: 'account-charles',
      username: ' publisher ',
      displayName: ' Knowledge   Publisher ',
      expectedStateRevision: 4,
    });

    expect(accountCollection.create).toHaveBeenCalledWith(
      expect.objectContaining({ storedRole: 'publisher', username: 'publisher' }),
      { requestKey: null },
    );
    expect(stateCollection.update).toHaveBeenCalledWith(
      'state-1',
      {
        publisherAccountId: 'account-created',
        assignmentVersion: 5,
        updatedByAccountId: 'account-charles',
        updatedAt: NOW,
      },
      { requestKey: null },
    );

    stateCollection.getFirstListItem.mockResolvedValue(
      state({ publisherAccountId: 'account-publisher' }),
    );
    await expect(
      manager().createPublisher({
        actorAccountId: 'account-charles',
        username: 'replacement',
        displayName: 'Replacement Publisher',
        expectedStateRevision: 4,
      }),
    ).rejects.toThrow(/replace the current publisher/i);
  });

  it('keeps Administrator mutation Owner-only and protects the current Owner by account ID', async () => {
    await expect(
      manager().setActive({
        actorAccountId: 'account-charles',
        accountId: 'account-ryan',
        active: false,
        expectedRevision: 2,
      }),
    ).rejects.toThrow('Only the Relay owner can manage administrators.');

    await expect(
      manager().setActive({
        actorAccountId: 'account-ryan',
        accountId: 'account-ryan',
        active: false,
        expectedRevision: 2,
      }),
    ).rejects.toThrow(/current owner cannot be deactivated/i);

    await manager().setActive({
      actorAccountId: 'account-ryan',
      accountId: 'account-charles',
      active: false,
      expectedRevision: 1,
    });
    expect(accountCollection.update).toHaveBeenCalledWith(
      'account-charles',
      { active: false, revision: 2 },
      { requestKey: null },
    );
    expect(onAuthorityChanged).toHaveBeenCalledWith(['account-charles']);

    accountCollection.getOne.mockImplementation(async (id: string) =>
      id === 'account-publisher'
        ? account({ id, storedRole: 'publisher', revision: 3 })
        : accounts.find((entry) => entry.id === id)!,
    );
    await expect(
      manager().setActive({
        actorAccountId: 'account-charles',
        accountId: 'account-publisher',
        active: false,
        expectedRevision: 2,
      }),
    ).rejects.toEqual(new RoleAccountConflictError(3));
  });

  it('transfers ownership only to an active Administrator with state revision protection', async () => {
    await manager().transferOwnership({
      actorAccountId: 'account-ryan',
      accountId: 'account-charles',
      expectedStateRevision: 4,
    });

    expect(stateCollection.update).toHaveBeenCalledWith(
      'state-1',
      {
        ownerAccountId: 'account-charles',
        assignmentVersion: 5,
        updatedByAccountId: 'account-ryan',
        updatedAt: NOW,
      },
      { requestKey: null },
    );
    expect(onAuthorityChanged).toHaveBeenCalledWith(['account-ryan', 'account-charles']);

    await expect(
      manager().transferOwnership({
        actorAccountId: 'account-ryan',
        accountId: 'account-charles',
        expectedStateRevision: 3,
      }),
    ).rejects.toEqual(new RoleAccountConflictError(4));
  });

  it('never infers ownership from a display name', async () => {
    accountCollection.getOne.mockImplementation(async (id: string) =>
      id === 'account-impostor'
        ? account({ id, username: 'impostor', displayName: 'Ryan Bledsoe' })
        : accounts.find((entry) => entry.id === id)!,
    );

    await expect(
      manager().createAdministrator({
        actorAccountId: 'account-impostor',
        username: 'admin-2',
        displayName: 'Admin Two',
        expectedStateRevision: 4,
      }),
    ).rejects.toThrow('Only the Relay owner can manage administrators.');
  });

  it('rolls back a created Administrator when singleton state changes before commit', async () => {
    stateCollection.getFirstListItem
      .mockResolvedValueOnce(state())
      .mockResolvedValueOnce(state({ assignmentVersion: 5 }));

    await expect(
      manager().createAdministrator({
        actorAccountId: 'account-ryan',
        username: 'admin-2',
        displayName: 'Admin Two',
        expectedStateRevision: 4,
      }),
    ).rejects.toEqual(new RoleAccountConflictError(5));

    expect(accountCollection.delete).toHaveBeenCalledWith('account-created', { requestKey: null });
    expect(stateCollection.update).not.toHaveBeenCalled();
    expect(snapshotReader.read).not.toHaveBeenCalled();
  });

  it('rolls back a created Publisher when singleton state changes before commit', async () => {
    stateCollection.getFirstListItem
      .mockResolvedValueOnce(state())
      .mockResolvedValueOnce(state({ assignmentVersion: 5 }));

    await expect(
      manager().createPublisher({
        actorAccountId: 'account-charles',
        username: 'publisher-2',
        displayName: 'Publisher Two',
        expectedStateRevision: 4,
      }),
    ).rejects.toEqual(new RoleAccountConflictError(5));

    expect(accountCollection.delete).toHaveBeenCalledWith('account-created', { requestKey: null });
    expect(snapshotReader.read).not.toHaveBeenCalled();
  });

  it.each([
    ['Administrator', 'createAdministrator', 'account-ryan', 'admin-2'],
    ['Publisher', 'createPublisher', 'account-charles', 'publisher-2'],
  ] as const)(
    'rolls back a created %s when the singleton write fails',
    async (_label, method, actorAccountId, username) => {
      stateCollection.update.mockRejectedValueOnce(new Error('PocketBase unavailable'));

      await expect(
        manager()[method]({
          actorAccountId,
          username,
          displayName: 'New Account',
          expectedStateRevision: 4,
        }),
      ).rejects.toThrow('PocketBase unavailable');

      expect(accountCollection.delete).toHaveBeenCalledWith('account-created', {
        requestKey: null,
      });
      expect(snapshotReader.read).not.toHaveBeenCalled();
    },
  );

  it('serializes simultaneous account creation so one state revision cannot create two accounts', async () => {
    let currentState = state();
    stateCollection.getFirstListItem.mockImplementation(async () => currentState);
    stateCollection.update.mockImplementation(
      async (_id: string, data: Record<string, unknown>) => {
        currentState = state({ ...data });
        return currentState;
      },
    );
    accountCollection.create.mockImplementation(async (data: Record<string, unknown>) =>
      account({ id: `account-${String(data.username)}`, ...data }),
    );
    const roleManager = manager();

    const results = await Promise.allSettled([
      roleManager.createAdministrator({
        actorAccountId: 'account-ryan',
        username: 'admin-2',
        displayName: 'Admin Two',
        expectedStateRevision: 4,
      }),
      roleManager.createAdministrator({
        actorAccountId: 'account-ryan',
        username: 'admin-3',
        displayName: 'Admin Three',
        expectedStateRevision: 4,
      }),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(accountCollection.create).toHaveBeenCalledTimes(1);
    expect(stateCollection.update).toHaveBeenCalledTimes(1);
  });
});
