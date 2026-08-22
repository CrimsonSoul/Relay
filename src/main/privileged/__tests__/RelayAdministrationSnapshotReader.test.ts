import { describe, expect, it, vi } from 'vitest';
import {
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_STATE_COLLECTION,
  normalizeRelayAdministrationSnapshot,
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

  it('keeps a max-Administrator snapshot bounded while exposing the retained Publisher', async () => {
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
    const retainedPublisher = {
      id: 'account-publisher',
      username: 'publisher',
      displayName: 'Retained Publisher',
      storedRole: 'publisher' as const,
      active: false,
      mustChangePassword: true,
      credentialVersion: 2,
      revision: 1,
      created: '2026-07-13T09:00:00.000Z',
      updated: '2026-07-15T10:00:00.000Z',
    };
    const collections = {
      [RELAY_PRIVILEGED_STATE_COLLECTION]: {
        getFirstListItem: vi.fn(async () => ({
          id: 'state-1',
          key: 'primary',
          ownerAccountId: 'account-ryan',
          publisherAccountId: '',
          assignmentVersion: 19,
        })),
      },
      [RELAY_PRIVILEGED_ACCOUNTS_COLLECTION]: {
        getFullList: vi.fn(async () => [...administrators, retainedPublisher]),
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
    expect(snapshot.accounts.map(({ accountId }) => accountId)).toContain('account-publisher');
    expect(snapshot.publisherAccountId).toBeNull();
    expect(normalizeRelayAdministrationSnapshot(snapshot)).not.toBeNull();
  });

  it('keeps legacy accounts readable when auth autodates were previously absent', async () => {
    const accounts = [
      {
        id: 'account-ryan',
        username: 'ryan',
        displayName: 'Ryan Bledsoe',
        storedRole: 'administrator',
        active: true,
        mustChangePassword: false,
        credentialVersion: 1,
        revision: 0,
      },
      {
        id: 'account-charles',
        username: 'charles',
        displayName: 'Charles Gibbs',
        storedRole: 'administrator',
        active: true,
        mustChangePassword: false,
        credentialVersion: 1,
        revision: 0,
      },
    ];
    const collections = {
      [RELAY_PRIVILEGED_STATE_COLLECTION]: {
        getFirstListItem: vi.fn(async () => ({
          id: 'state-1',
          key: 'primary',
          ownerAccountId: 'account-ryan',
          publisherAccountId: '',
          assignmentVersion: 1,
        })),
      },
      [RELAY_PRIVILEGED_ACCOUNTS_COLLECTION]: { getFullList: vi.fn(async () => accounts) },
    };
    const reader = new RelayAdministrationSnapshotReader({
      pb: { collection: vi.fn((name: keyof typeof collections) => collections[name]) } as never,
      deviceManager: { list: vi.fn(async () => []) } as never,
      administrationService: { getSettingSummaries: vi.fn(() => []) } as never,
      now: () => Date.parse('2026-07-17T15:00:00.000Z'),
    });

    await expect(reader.read({ accountId: 'account-ryan' })).resolves.toMatchObject({
      accounts: [
        { username: 'ryan', createdAt: '1970-01-01T00:00:00.000Z', updatedAt: null },
        { username: 'charles', createdAt: '1970-01-01T00:00:00.000Z', updatedAt: null },
      ],
    });
  });
});
