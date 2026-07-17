export const MIN_ROLE_USERNAME_LENGTH = 3;
export const MAX_ROLE_USERNAME_LENGTH = 64;
export const MAX_ROLE_DISPLAY_NAME_LENGTH = 120;

const ROLE_USERNAME_PATTERN = /^[a-z0-9._-]+$/;

export type StoredRoleAccountRole = 'administrator' | 'publisher';
export type EffectivePrivilegedRole = 'owner' | 'admin' | 'publisher';

export type RelayRoleAccountRecord = {
  id: string;
  username: string;
  displayName: string;
  storedRole: StoredRoleAccountRole;
  active: boolean;
  mustChangePassword: boolean;
  credentialVersion: number;
  revision: number;
  legacyOperatorId?: string | null;
  created: string;
  updated: string;
};

export type RelayRoleAuthorityPointers = {
  ownerAccountId: string;
  publisherAccountId: string | null;
};

export function normalizeRoleUsername(value: string): string {
  return value.trim().toLocaleLowerCase('en');
}

export function getRoleUsernameError(value: string): string | null {
  const username = normalizeRoleUsername(value);
  if (username.length < MIN_ROLE_USERNAME_LENGTH || username.length > MAX_ROLE_USERNAME_LENGTH) {
    return 'Usernames must be 3–64 characters.';
  }
  return ROLE_USERNAME_PATTERN.test(username)
    ? null
    : 'Use only letters, numbers, periods, underscores, and hyphens.';
}

export function normalizeRoleDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function getRoleDisplayNameError(value: string): string | null {
  const displayName = normalizeRoleDisplayName(value);
  if (displayName.length === 0) return 'Display names are required.';
  return displayName.length <= MAX_ROLE_DISPLAY_NAME_LENGTH
    ? null
    : 'Display names must be 120 characters or fewer.';
}

export function getEffectiveRole(
  account: Pick<RelayRoleAccountRecord, 'id' | 'storedRole'>,
  state: RelayRoleAuthorityPointers,
): EffectivePrivilegedRole | null {
  if (account.id === state.ownerAccountId) return 'owner';
  if (account.storedRole === 'administrator') return 'admin';
  return account.id === state.publisherAccountId ? 'publisher' : null;
}
