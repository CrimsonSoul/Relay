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
});
