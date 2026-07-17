import { describe, expect, it } from 'vitest';
import {
  ADMIN_PRIVILEGED_CAPABILITIES,
  MAX_PRIVILEGED_DEVICE_LABEL_LENGTH,
  MAX_PRIVILEGED_HOSTNAME_LENGTH,
  OWNER_PRIVILEGED_CAPABILITIES,
  PRIVILEGED_SESSION_IDLE_MS,
  PUBLISHER_PRIVILEGED_CAPABILITIES,
  getPrivilegedCapabilities,
  isPrivilegedRole,
  normalizePrivilegedSessionView,
  normalizeRelayAdministrationSnapshot,
} from '../privilegedAccess';

describe('privileged access contracts', () => {
  it('accepts only the three effective privileged roles', () => {
    expect(isPrivilegedRole('owner')).toBe(true);
    expect(isPrivilegedRole('admin')).toBe(true);
    expect(isPrivilegedRole('publisher')).toBe(true);
    expect(isPrivilegedRole('operator')).toBe(false);
    expect(isPrivilegedRole(null)).toBe(false);
  });

  it('publishes the approved role capability matrix', () => {
    expect(OWNER_PRIVILEGED_CAPABILITIES).toEqual([
      'privileged.status.read',
      'accounts.manage',
      'ownership.transfer',
      'publisher.assign',
      'devices.manage',
      'settings.manage',
      'knowledge.manage',
    ]);
    expect(ADMIN_PRIVILEGED_CAPABILITIES).toEqual([
      'privileged.status.read',
      'publisher.assign',
      'devices.manage',
      'settings.manage',
      'knowledge.manage',
    ]);
    expect(PUBLISHER_PRIVILEGED_CAPABILITIES).toEqual([
      'privileged.status.read',
      'knowledge.manage',
    ]);
  });

  it('grants no capabilities to inactive or stale role assignments', () => {
    expect(getPrivilegedCapabilities({ role: 'owner', active: false, assigned: true })).toEqual([]);
    expect(getPrivilegedCapabilities({ role: 'publisher', active: true, assigned: false })).toEqual(
      [],
    );
    expect(getPrivilegedCapabilities({ role: 'admin', active: true, assigned: true })).toEqual(
      ADMIN_PRIVILEGED_CAPABILITIES,
    );
  });

  it('uses the approved session and device limits', () => {
    expect(PRIVILEGED_SESSION_IDLE_MS).toBe(15 * 60 * 1_000);
    expect(MAX_PRIVILEGED_DEVICE_LABEL_LENGTH).toBe(80);
    expect(MAX_PRIVILEGED_HOSTNAME_LENGTH).toBe(255);
  });

  it('normalizes a public session without retaining secrets or unknown capabilities', () => {
    const normalized = normalizePrivilegedSessionView({
      state: 'active',
      accountId: 'account-ryan',
      username: 'ryan',
      displayName: 'Ryan Bledsoe',
      role: 'owner',
      capabilities: ['accounts.manage', 'accounts.manage', 'arbitrary.manage', 'knowledge.manage'],
      deviceId: 'device-1',
      expiresAt: '2026-07-15T22:00:00.000Z',
      email: 'account-ryan@relay.invalid',
      token: 'must-not-survive',
      privateKey: 'must-not-survive',
      passwordHash: 'must-not-survive',
    });

    expect(normalized).toEqual({
      state: 'active',
      accountId: 'account-ryan',
      username: 'ryan',
      displayName: 'Ryan Bledsoe',
      role: 'owner',
      capabilities: ['accounts.manage', 'knowledge.manage'],
      deviceId: 'device-1',
      expiresAt: '2026-07-15T22:00:00.000Z',
    });
    expect(JSON.stringify(normalized)).not.toContain('relay.invalid');
    expect(JSON.stringify(normalized)).not.toContain('must-not-survive');
  });

  it('rejects inconsistent active session projections', () => {
    expect(
      normalizePrivilegedSessionView({
        state: 'active',
        accountId: null,
        username: null,
        displayName: null,
        role: null,
        capabilities: [],
        deviceId: null,
        expiresAt: null,
      }),
    ).toBeNull();
  });

  it('normalizes bounded account administration views without retaining secret material', () => {
    const normalized = normalizeRelayAdministrationSnapshot({
      accounts: [
        {
          accountId: 'account-ryan',
          username: 'ryan',
          displayName: 'Ryan Bledsoe',
          storedRole: 'administrator',
          effectiveRole: 'owner',
          active: true,
          credentialState: 'configured',
          mustChangePassword: false,
          credentialVersion: 2,
          revision: 4,
          createdAt: '2026-07-15T20:00:00.000Z',
          updatedAt: '2026-07-15T21:00:00.000Z',
          email: 'account-ryan@relay.invalid',
          passwordHash: 'must-not-survive',
          token: 'must-not-survive',
        },
        {
          accountId: 'account-charles',
          username: 'charles',
          displayName: 'Charles Gibbs',
          storedRole: 'administrator',
          effectiveRole: 'admin',
          active: true,
          credentialState: 'configured',
          mustChangePassword: false,
          credentialVersion: 1,
          revision: 1,
          createdAt: '2026-07-15T20:00:00.000Z',
          updatedAt: null,
        },
      ],
      devices: [
        {
          id: 'record-1',
          deviceId: 'device-1',
          accountId: 'account-ryan',
          username: 'ryan',
          displayName: 'Ryan Bledsoe',
          label: 'Ryan work laptop',
          hostname: 'NOC-LT-01',
          state: 'active',
          lastSeenAt: '2026-07-15T21:00:00.000Z',
          fingerprintSuffix: '9A2F',
          revision: 3,
          publicKey: 'must-not-survive',
        },
      ],
      settings: [
        {
          setting: 'dynatrace.platform-token',
          configured: true,
          summary: 'Configured',
          revision: 7,
          value: 'must-not-survive',
        },
      ],
      ownerAccountId: 'account-ryan',
      publisherAccountId: null,
      assignmentRevision: 5,
      generatedAt: '2026-07-15T21:00:00.000Z',
      commandEnvelope: { signature: 'must-not-survive' },
    });

    expect(normalized).toEqual({
      accounts: [
        {
          accountId: 'account-ryan',
          username: 'ryan',
          displayName: 'Ryan Bledsoe',
          storedRole: 'administrator',
          effectiveRole: 'owner',
          active: true,
          credentialState: 'configured',
          mustChangePassword: false,
          credentialVersion: 2,
          revision: 4,
          createdAt: '2026-07-15T20:00:00.000Z',
          updatedAt: '2026-07-15T21:00:00.000Z',
        },
        {
          accountId: 'account-charles',
          username: 'charles',
          displayName: 'Charles Gibbs',
          storedRole: 'administrator',
          effectiveRole: 'admin',
          active: true,
          credentialState: 'configured',
          mustChangePassword: false,
          credentialVersion: 1,
          revision: 1,
          createdAt: '2026-07-15T20:00:00.000Z',
          updatedAt: null,
        },
      ],
      devices: [
        {
          id: 'record-1',
          deviceId: 'device-1',
          accountId: 'account-ryan',
          username: 'ryan',
          displayName: 'Ryan Bledsoe',
          label: 'Ryan work laptop',
          hostname: 'NOC-LT-01',
          state: 'active',
          lastSeenAt: '2026-07-15T21:00:00.000Z',
          fingerprintSuffix: '9A2F',
          revision: 3,
        },
      ],
      settings: [
        {
          setting: 'dynatrace.platform-token',
          configured: true,
          summary: 'Configured',
          revision: 7,
        },
      ],
      ownerAccountId: 'account-ryan',
      publisherAccountId: null,
      assignmentRevision: 5,
      generatedAt: '2026-07-15T21:00:00.000Z',
    });
    expect(JSON.stringify(normalized)).not.toContain('must-not-survive');
    expect(JSON.stringify(normalized)).not.toContain('relay.invalid');
  });

  it('rejects inconsistent administration snapshots', () => {
    expect(
      normalizeRelayAdministrationSnapshot({
        accounts: [],
        devices: [],
        settings: [],
        ownerAccountId: 'account-ryan',
        publisherAccountId: 'account-ryan',
        assignmentRevision: 0,
        generatedAt: '2026-07-15T21:00:00.000Z',
      }),
    ).toBeNull();
  });
});
