import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_DEVICES_COLLECTION,
  RELAY_PRIVILEGED_STATE_COLLECTION,
  type RelayPrivilegedAccountRecord,
  type RelayPrivilegedStateRecord,
} from '@shared/privilegedAccess';
import {
  PublisherAssignmentConflictError,
  PublisherAssignmentManager,
} from '../PublisherAssignmentManager';

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
    getOne: vi.fn(async (id: string) => records.get(id)),
    update: vi.fn(),
  };
  const deviceCollection = { getFullList: vi.fn(async () => []), update: vi.fn() };
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
  const manager = () =>
    new PublisherAssignmentManager({
      pb: pb as never,
      now: () => Date.parse(NOW),
      onAssignmentChanged,
    });

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
});
