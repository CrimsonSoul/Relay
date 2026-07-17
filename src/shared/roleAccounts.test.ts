import { describe, expect, it } from 'vitest';
import {
  getEffectiveRole,
  getRoleDisplayNameError,
  getRoleUsernameError,
  normalizeRoleDisplayName,
  normalizeRoleUsername,
} from './roleAccounts';

describe('role account identity', () => {
  it('normalizes usernames and rejects unsupported values', () => {
    expect(normalizeRoleUsername('  Ryan.Admin ')).toBe('ryan.admin');
    expect(getRoleUsernameError('ab')).toBe('Usernames must be 3–64 characters.');
    expect(getRoleUsernameError('ryan admin')).toBe(
      'Use only letters, numbers, periods, underscores, and hyphens.',
    );
    expect(getRoleUsernameError('charles_gibbs-2')).toBeNull();
  });

  it('normalizes display names and enforces the public length boundary', () => {
    expect(normalizeRoleDisplayName('  Ryan   Bledsoe  ')).toBe('Ryan Bledsoe');
    expect(getRoleDisplayNameError('   ')).toBe('Display names are required.');
    expect(getRoleDisplayNameError('x'.repeat(121))).toBe(
      'Display names must be 120 characters or fewer.',
    );
    expect(getRoleDisplayNameError('Charles Gibbs')).toBeNull();
  });

  it('derives the singleton owner before the stored administrator role', () => {
    expect(
      getEffectiveRole(
        { id: 'account-ryan', storedRole: 'administrator' },
        { ownerAccountId: 'account-ryan', publisherAccountId: null },
      ),
    ).toBe('owner');
    expect(
      getEffectiveRole(
        { id: 'account-charles', storedRole: 'administrator' },
        { ownerAccountId: 'account-ryan', publisherAccountId: null },
      ),
    ).toBe('admin');
  });

  it('grants the publisher role only to the assigned publisher account', () => {
    const state = {
      ownerAccountId: 'account-ryan',
      publisherAccountId: 'account-publisher',
    };
    expect(getEffectiveRole({ id: 'account-publisher', storedRole: 'publisher' }, state)).toBe(
      'publisher',
    );
    expect(
      getEffectiveRole({ id: 'account-stale-publisher', storedRole: 'publisher' }, state),
    ).toBeNull();
  });
});
