import { describe, expect, it, vi } from 'vitest';
import {
  RELAY_PRIVILEGED_ACCOUNTS_COLLECTION,
  RELAY_PRIVILEGED_STATE_COLLECTION,
} from '@shared/privilegedAccess';
import { RELAY_OPERATORS_COLLECTION } from '@shared/operators';
import { RelayAdministrationSnapshotReader } from '../RelayAdministrationSnapshotReader';

describe('RelayAdministrationSnapshotReader', () => {
  it('returns a bounded role-aware snapshot without secrets', async () => {
    const collections = {
      [RELAY_PRIVILEGED_STATE_COLLECTION]: {
        getFirstListItem: vi.fn(async () => ({
          id: 'state-1',
          key: 'primary',
          adminOperatorId: 'operator-admin',
          adminOperatorIds: ['operator-admin', 'operator-charles'],
          publisherOperatorId: 'operator-publisher',
          assignmentVersion: 7,
        })),
      },
      [RELAY_OPERATORS_COLLECTION]: {
        getFullList: vi.fn(async () => [
          {
            id: 'operator-publisher',
            displayName: 'Publisher Person',
            active: true,
            revision: 2,
            created: '2026-07-14 09:00:00.000Z',
            updated: '2026-07-15 09:00:00.000Z',
          },
          {
            id: 'operator-admin',
            displayName: 'Ryan Bledsoe',
            active: true,
            revision: 4,
            created: '2026-07-13T09:00:00.000Z',
            updated: '2026-07-15T10:00:00.000Z',
          },
          {
            id: 'operator-charles',
            displayName: 'Charles Gibbs',
            active: true,
            revision: 1,
            created: '2026-07-13T09:00:00.000Z',
            updated: '2026-07-15T10:00:00.000Z',
          },
        ]),
      },
      [RELAY_PRIVILEGED_ACCOUNTS_COLLECTION]: {
        getFullList: vi.fn(async () => [
          {
            id: 'account-publisher',
            operatorId: 'operator-publisher',
            role: 'publisher',
            active: false,
            mustChangePassword: true,
            credentialVersion: 1,
            passwordHash: 'must-never-leave-main',
            tokenKey: 'must-never-leave-main',
            updated: '',
          },
          {
            id: 'account-admin',
            operatorId: 'operator-admin',
            role: 'admin',
            active: true,
            mustChangePassword: false,
            credentialVersion: 3,
            passwordHash: 'must-never-leave-main',
            updated: '2026-07-15T12:00:00.000Z',
          },
          {
            id: 'account-charles',
            operatorId: 'operator-charles',
            role: 'admin',
            active: false,
            mustChangePassword: true,
            credentialVersion: 0,
            updated: '',
          },
        ]),
      },
    };
    const pb = {
      collection: vi.fn((name: keyof typeof collections) => collections[name]),
    };
    const deviceManager = {
      list: vi.fn(async () => [
        {
          id: 'record-device',
          deviceId: 'device-1',
          accountId: 'account-admin',
          operatorId: 'operator-admin',
          operatorName: 'Ryan Bledsoe',
          label: 'Work laptop',
          hostname: 'NOC-LAPTOP',
          state: 'active',
          lastSeenAt: '2026-07-15T12:30:00.000Z',
          fingerprintSuffix: 'A1B2C3D4',
          revision: 1,
        },
      ]),
    };
    const administrationService = {
      getSettingSummaries: vi.fn(() => [
        {
          setting: 'dynatrace.platform-token',
          configured: true,
          summary: 'Configured',
          revision: 2,
        },
      ]),
    };
    const reader = new RelayAdministrationSnapshotReader({
      pb: pb as never,
      deviceManager: deviceManager as never,
      administrationService: administrationService as never,
      now: () => Date.parse('2026-07-15T13:00:00.000Z'),
    });

    const snapshot = await reader.read({ accountId: 'account-admin' });

    expect(deviceManager.list).toHaveBeenCalledWith({ role: 'admin', accountId: 'account-admin' });
    expect(snapshot).toMatchObject({
      operators: [
        {
          id: 'operator-publisher',
          role: 'publisher',
          created: '2026-07-14T09:00:00.000Z',
          updated: '2026-07-15T09:00:00.000Z',
        },
        {
          id: 'operator-admin',
          role: 'admin',
          created: '2026-07-13T09:00:00.000Z',
          updated: '2026-07-15T10:00:00.000Z',
        },
        {
          id: 'operator-charles',
          role: 'admin',
          created: '2026-07-13T09:00:00.000Z',
          updated: '2026-07-15T10:00:00.000Z',
        },
      ],
      privilegedAccounts: [
        {
          accountId: 'account-admin',
          credentialState: 'configured',
          updatedAt: '2026-07-15T12:00:00.000Z',
        },
        {
          accountId: 'account-charles',
          credentialState: 'not-configured',
          updatedAt: null,
        },
        {
          accountId: 'account-publisher',
          credentialState: 'not-configured',
          updatedAt: null,
        },
      ],
      adminOperatorId: 'operator-admin',
      publisherOperatorId: 'operator-publisher',
      assignmentRevision: 7,
      generatedAt: '2026-07-15T13:00:00.000Z',
    });
    expect(JSON.stringify(snapshot)).not.toContain('passwordHash');
    expect(JSON.stringify(snapshot)).not.toContain('tokenKey');
  });
});
