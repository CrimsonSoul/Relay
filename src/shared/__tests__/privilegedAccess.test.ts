import { describe, expect, it } from 'vitest';
import {
  ADMIN_PRIVILEGED_CAPABILITIES,
  MAX_PRIVILEGED_DEVICE_LABEL_LENGTH,
  MAX_PRIVILEGED_HOSTNAME_LENGTH,
  PRIVILEGED_SESSION_IDLE_MS,
  PUBLISHER_PRIVILEGED_CAPABILITIES,
  getPrivilegedAdministratorOperatorIds,
  getPrivilegedCapabilities,
  isPrivilegedAdministrator,
  isPrivilegedRole,
  normalizeRelayAdministrationSnapshot,
  normalizePrivilegedSessionView,
} from '../privilegedAccess';

describe('privileged access contracts', () => {
  it('accepts only the two privileged roles', () => {
    expect(isPrivilegedRole('admin')).toBe(true);
    expect(isPrivilegedRole('publisher')).toBe(true);
    expect(isPrivilegedRole('operator')).toBe(false);
    expect(isPrivilegedRole(null)).toBe(false);
  });

  it('publishes the approved role capability matrix', () => {
    expect(ADMIN_PRIVILEGED_CAPABILITIES).toEqual([
      'privileged.status.read',
      'operators.manage',
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

  it('recognizes the permanent owner and additional administrators with legacy fallback', () => {
    expect(
      getPrivilegedAdministratorOperatorIds({
        adminOperatorId: 'operator-owner',
        adminOperatorIds: ['operator-owner', 'operator-charles', 'operator-charles', ''],
      }),
    ).toEqual(['operator-owner', 'operator-charles']);
    expect(
      isPrivilegedAdministrator(
        { adminOperatorId: 'operator-owner', adminOperatorIds: ['operator-charles'] },
        'operator-charles',
      ),
    ).toBe(true);
    expect(isPrivilegedAdministrator({ adminOperatorId: 'operator-owner' }, 'operator-owner')).toBe(
      true,
    );
    expect(isPrivilegedAdministrator({ adminOperatorId: 'operator-owner' }, 'operator-other')).toBe(
      false,
    );
  });

  it('grants no capabilities to inactive or stale role assignments', () => {
    expect(getPrivilegedCapabilities({ role: 'admin', active: false, assigned: true })).toEqual([]);
    expect(getPrivilegedCapabilities({ role: 'publisher', active: true, assigned: false })).toEqual(
      [],
    );
    expect(getPrivilegedCapabilities({ role: 'publisher', active: true, assigned: true })).toEqual(
      PUBLISHER_PRIVILEGED_CAPABILITIES,
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
      accountId: 'account-1',
      operatorId: 'operator-1',
      operatorName: 'Ryan Bledsoe',
      role: 'admin',
      capabilities: ['settings.manage', 'settings.manage', 'arbitrary.manage', 'knowledge.manage'],
      deviceId: 'device-1',
      expiresAt: '2026-07-15T22:00:00.000Z',
      token: 'must-not-survive',
      privateKey: 'must-not-survive',
      passwordHash: 'must-not-survive',
    });

    expect(normalized).toEqual({
      state: 'active',
      accountId: 'account-1',
      operatorId: 'operator-1',
      operatorName: 'Ryan Bledsoe',
      role: 'admin',
      capabilities: ['settings.manage', 'knowledge.manage'],
      deviceId: 'device-1',
      expiresAt: '2026-07-15T22:00:00.000Z',
    });
    expect(normalized).not.toHaveProperty('token');
    expect(normalized).not.toHaveProperty('privateKey');
    expect(normalized).not.toHaveProperty('passwordHash');
  });

  it('rejects inconsistent session projections', () => {
    expect(
      normalizePrivilegedSessionView({
        state: 'active',
        accountId: null,
        operatorId: null,
        operatorName: null,
        role: null,
        capabilities: [],
        deviceId: null,
        expiresAt: null,
      }),
    ).toBeNull();
  });

  it('normalizes bounded administration views without retaining secret material', () => {
    const normalized = normalizeRelayAdministrationSnapshot({
      operators: [
        {
          id: 'operator-1',
          displayName: 'Ryan Bledsoe',
          active: true,
          revision: 4,
          role: 'admin',
          created: '2026-07-15T20:00:00.000Z',
          updated: '2026-07-15T21:00:00.000Z',
          password: 'must-not-survive',
        },
      ],
      privilegedAccounts: [
        {
          accountId: 'account-1',
          operatorId: 'operator-1',
          role: 'admin',
          active: true,
          credentialState: 'configured',
          mustChangePassword: false,
          credentialVersion: 2,
          updatedAt: '2026-07-15T21:00:00.000Z',
          passwordHash: 'must-not-survive',
          token: 'must-not-survive',
        },
      ],
      devices: [
        {
          id: 'record-1',
          deviceId: 'device-1',
          accountId: 'account-1',
          operatorId: 'operator-1',
          operatorName: 'Ryan Bledsoe',
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
      adminOperatorId: 'operator-1',
      publisherOperatorId: null,
      assignmentRevision: 5,
      generatedAt: '2026-07-15T21:00:00.000Z',
      commandEnvelope: { signature: 'must-not-survive' },
    });

    expect(normalized).toEqual({
      operators: [
        {
          id: 'operator-1',
          displayName: 'Ryan Bledsoe',
          active: true,
          revision: 4,
          role: 'admin',
          created: '2026-07-15T20:00:00.000Z',
          updated: '2026-07-15T21:00:00.000Z',
        },
      ],
      privilegedAccounts: [
        {
          accountId: 'account-1',
          operatorId: 'operator-1',
          role: 'admin',
          active: true,
          credentialState: 'configured',
          mustChangePassword: false,
          credentialVersion: 2,
          updatedAt: '2026-07-15T21:00:00.000Z',
        },
      ],
      devices: [
        {
          id: 'record-1',
          deviceId: 'device-1',
          accountId: 'account-1',
          operatorId: 'operator-1',
          operatorName: 'Ryan Bledsoe',
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
      adminOperatorId: 'operator-1',
      publisherOperatorId: null,
      assignmentRevision: 5,
      generatedAt: '2026-07-15T21:00:00.000Z',
    });
    expect(JSON.stringify(normalized)).not.toContain('must-not-survive');
  });

  it('rejects oversized or inconsistent administration snapshots', () => {
    expect(
      normalizeRelayAdministrationSnapshot({
        operators: [],
        privilegedAccounts: [],
        devices: [],
        settings: [],
        adminOperatorId: 'operator-1',
        publisherOperatorId: 'operator-1',
        assignmentRevision: 0,
        generatedAt: '2026-07-15T21:00:00.000Z',
      }),
    ).toBeNull();

    expect(
      normalizeRelayAdministrationSnapshot({
        operators: Array.from({ length: 501 }, (_, index) => ({
          id: `operator-${index}`,
          displayName: `Operator ${index}`,
          active: true,
          revision: 0,
          role: null,
          created: '2026-07-15T20:00:00.000Z',
          updated: '2026-07-15T20:00:00.000Z',
        })),
        privilegedAccounts: [],
        devices: [],
        settings: [],
        adminOperatorId: 'operator-1',
        publisherOperatorId: null,
        assignmentRevision: 0,
        generatedAt: '2026-07-15T21:00:00.000Z',
      }),
    ).toBeNull();
  });
});
