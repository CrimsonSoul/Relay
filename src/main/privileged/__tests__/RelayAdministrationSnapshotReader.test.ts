import { describe, expect, it, vi } from 'vitest';
import {
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_STATE_COLLECTION,
} from '@shared/privilegedAccess';
import { RelayAdministrationSnapshotReader } from '../RelayAdministrationSnapshotReader';

describe('RelayAdministrationSnapshotReader', () => {
  it('returns a bounded account-centric snapshot without secrets', async () => {
    const accounts = [
      {
        id: 'account-publisher',
        username: 'publisher',
        displayName: 'Publisher Person',
        storedRole: 'publisher',
        active: false,
        mustChangePassword: true,
        credentialVersion: 1,
        revision: 2,
        created: '2026-07-14 09:00:00.000Z',
        updated: '2026-07-15 09:00:00.000Z',
        passwordHash: 'secret',
      },
      {
        id: 'account-ryan',
        username: 'ryan',
        displayName: 'Ryan Bledsoe',
        storedRole: 'administrator',
        active: true,
        mustChangePassword: false,
        credentialVersion: 3,
        revision: 4,
        created: '2026-07-13T09:00:00.000Z',
        updated: '2026-07-15T10:00:00.000Z',
        tokenKey: 'secret',
      },
      {
        id: 'account-charles',
        username: 'charles',
        displayName: 'Charles Gibbs',
        storedRole: 'administrator',
        active: true,
        mustChangePassword: false,
        credentialVersion: 1,
        revision: 1,
        created: '2026-07-13T09:00:00.000Z',
        updated: '2026-07-15T10:00:00.000Z',
      },
    ];
    const collections = {
      [RELAY_PRIVILEGED_STATE_COLLECTION]: {
        getFirstListItem: vi.fn(async () => ({
          id: 'state-1',
          key: 'primary',
          ownerAccountId: 'account-ryan',
          publisherAccountId: 'account-publisher',
          assignmentVersion: 7,
        })),
      },
      [RELAY_PRIVILEGED_ACCOUNTS_COLLECTION]: { getFullList: vi.fn(async () => accounts) },
    };
    const pb = { collection: vi.fn((name: keyof typeof collections) => collections[name]) };
    const deviceManager = { list: vi.fn(async () => []) };
    const administrationService = { getSettingSummaries: vi.fn(() => []) };
    const reader = new RelayAdministrationSnapshotReader({
      pb: pb as never,
      deviceManager: deviceManager as never,
      administrationService: administrationService as never,
      now: () => Date.parse('2026-07-15T13:00:00.000Z'),
    });

    const snapshot = await reader.read({ accountId: 'account-charles' });
    expect(deviceManager.list).toHaveBeenCalledWith({
      role: 'admin',
      accountId: 'account-charles',
    });
    expect(snapshot).toMatchObject({
      accounts: [
        { accountId: 'account-ryan', effectiveRole: 'owner', storedRole: 'administrator' },
        { accountId: 'account-charles', effectiveRole: 'admin', storedRole: 'administrator' },
        { accountId: 'account-publisher', effectiveRole: 'publisher', storedRole: 'publisher' },
      ],
      ownerAccountId: 'account-ryan',
      publisherAccountId: 'account-publisher',
      assignmentRevision: 7,
    });
    expect(JSON.stringify(snapshot)).not.toContain('passwordHash');
    expect(JSON.stringify(snapshot)).not.toContain('tokenKey');
  });

  it('keeps repeated unassign/create cycles bounded by omitting retired Publishers', async () => {
    const administrators = Array.from({ length: 10 }, (_, index) => ({
      id: index === 0 ? 'account-ryan' : `account-admin-${index}`,
      username: index === 0 ? 'ryan' : `admin-${index}`,
      displayName: index === 0 ? 'Ryan Bledsoe' : `Admin ${index}`,
      storedRole: 'administrator' as const,
      active: true,
      mustChangePassword: false,
      credentialVersion: 1,
      revision: 1,
      created: '2026-07-13T09:00:00.000Z',
      updated: '2026-07-15T10:00:00.000Z',
    }));
    const retiredPublishers = Array.from({ length: 8 }, (_, index) => ({
      id: `account-retired-publisher-${index}`,
      username: `retired-publisher-${index}`,
      displayName: `Retired Publisher ${index}`,
      storedRole: 'publisher' as const,
      active: false,
      mustChangePassword: true,
      credentialVersion: 2,
      revision: 1,
      created: '2026-07-13T09:00:00.000Z',
      updated: '2026-07-15T10:00:00.000Z',
    }));
    const currentPublisher = {
      ...retiredPublishers[0]!,
      id: 'account-current-publisher',
      username: 'current-publisher',
      displayName: 'Current Publisher',
      active: true,
      mustChangePassword: false,
    };
    const collections = {
      [RELAY_PRIVILEGED_STATE_COLLECTION]: {
        getFirstListItem: vi.fn(async () => ({
          id: 'state-1',
          key: 'primary',
          ownerAccountId: 'account-ryan',
          publisherAccountId: 'account-current-publisher',
          assignmentVersion: 19,
        })),
      },
      [RELAY_PRIVILEGED_ACCOUNTS_COLLECTION]: {
        getFullList: vi.fn(async () => [...administrators, ...retiredPublishers, currentPublisher]),
      },
    };
    const reader = new RelayAdministrationSnapshotReader({
      pb: { collection: vi.fn((name: keyof typeof collections) => collections[name]) } as never,
      deviceManager: { list: vi.fn(async () => []) } as never,
      administrationService: { getSettingSummaries: vi.fn(() => []) } as never,
      now: () => Date.parse('2026-07-17T15:00:00.000Z'),
    });

    const snapshot = await reader.read({ accountId: 'account-ryan' });

    expect(snapshot.accounts).toHaveLength(11);
    expect(snapshot.accounts.map(({ accountId }) => accountId)).toContain(
      'account-current-publisher',
    );
    expect(snapshot.accounts.some(({ accountId }) => accountId.includes('retired'))).toBe(false);
  });
});
