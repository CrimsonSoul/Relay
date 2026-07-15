import { describe, expect, it } from 'vitest';
import {
  ADMIN_PRIVILEGED_CAPABILITIES,
  MAX_PRIVILEGED_DEVICE_LABEL_LENGTH,
  MAX_PRIVILEGED_HOSTNAME_LENGTH,
  PRIVILEGED_SESSION_IDLE_MS,
  PUBLISHER_PRIVILEGED_CAPABILITIES,
  getPrivilegedCapabilities,
  isPrivilegedRole,
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
});
