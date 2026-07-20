import {
  getEffectiveRole,
  getRoleDisplayNameError,
  getRoleUsernameError,
  normalizeRoleDisplayName,
  normalizeRoleUsername,
  type EffectivePrivilegedRole,
  type RelayRoleAccountRecord,
  type StoredRoleAccountRole,
} from './roleAccounts';

export type {
  EffectivePrivilegedRole,
  RelayRoleAccountRecord,
  StoredRoleAccountRole,
} from './roleAccounts';

export const RELAY_PRIVILEGED_ACCOUNTS_COLLECTION = 'relay_privileged_accounts';
export const RELAY_PRIVILEGED_STATE_COLLECTION = 'relay_privileged_state';
export const RELAY_PRIVILEGED_DEVICES_COLLECTION = 'relay_privileged_devices';
export const RELAY_PRIVILEGED_COMMANDS_COLLECTION = 'relay_privileged_commands';
export const RELAY_PRIVILEGED_PAIRING_CHALLENGES_COLLECTION = 'relay_privileged_pairing_challenges';
export const RELAY_PRIVILEGED_PAIRING_REQUESTS_COLLECTION = 'relay_privileged_pairing_requests';

export const MAX_PRIVILEGED_DEVICE_LABEL_LENGTH = 80;
export const MAX_PRIVILEGED_HOSTNAME_LENGTH = 255;
export const MIN_PRIVILEGED_PASSWORD_LENGTH = 12;
export const MAX_PRIVILEGED_PASSWORD_LENGTH = 128;
export const MAX_PRIVILEGED_ADMINISTRATORS = 10;

export type PrivilegedRole = EffectivePrivilegedRole;

export type PrivilegedCapability =
  | 'privileged.status.read'
  | 'accounts.manage'
  | 'ownership.transfer'
  | 'publisher.assign'
  | 'devices.manage'
  | 'settings.manage'
  | 'knowledge.manage';

export const OWNER_PRIVILEGED_CAPABILITIES: readonly PrivilegedCapability[] = [
  'privileged.status.read',
  'accounts.manage',
  'ownership.transfer',
  'publisher.assign',
  'devices.manage',
  'settings.manage',
  'knowledge.manage',
];

export const ADMIN_PRIVILEGED_CAPABILITIES: readonly PrivilegedCapability[] = [
  'privileged.status.read',
  'publisher.assign',
  'devices.manage',
  'settings.manage',
  'knowledge.manage',
];

export const PUBLISHER_PRIVILEGED_CAPABILITIES: readonly PrivilegedCapability[] = [
  'privileged.status.read',
  'knowledge.manage',
];

/** Retained as an import-compatible name while main-process call sites migrate. */
export type RelayPrivilegedAccountRecord = RelayRoleAccountRecord;

export type RelayPrivilegedStateRecord = {
  id: string;
  key: 'primary';
  ownerAccountId: string;
  publisherAccountId: string | null;
  assignmentVersion: number;
  identityMigrationVersion: number;
  updatedByAccountId: string | null;
  created: string;
  updated: string;
};

export type PrivilegedDeviceState = 'active' | 'revoked';

export type RelayPrivilegedDeviceRecord = {
  id: string;
  accountId: string;
  deviceId: string;
  hostnameSnapshot: string;
  label: string;
  publicKey: string;
  fingerprint: string;
  state: PrivilegedDeviceState;
  pairedAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedByAccountId: string | null;
  revision: number;
  created: string;
  updated: string;
};

export type PrivilegedSessionState = 'signed-out' | 'pairing-required' | 'active' | 'offline';

export type PrivilegedSessionView = {
  state: PrivilegedSessionState;
  accountId: string | null;
  username: string | null;
  displayName: string | null;
  role: PrivilegedRole | null;
  capabilities: PrivilegedCapability[];
  deviceId: string | null;
  expiresAt: string | null;
};

export type PrivilegedPairingChallengeView = {
  challengeId: string;
  accountId: string;
  code: string;
  expiresAt: string;
};

export const RELAY_ADMINISTRABLE_SETTINGS = [
  'dynatrace.environment-url',
  'dynatrace.platform-token',
  'dynatrace.alerting-profiles',
] as const;

export type RelayAdministrableSetting = (typeof RELAY_ADMINISTRABLE_SETTINGS)[number];

export type RelayAdministrationSettingValueMap = {
  'dynatrace.environment-url': { environmentUrl: string };
  'dynatrace.platform-token': { apiToken: string; environmentUrl?: string };
  'dynatrace.alerting-profiles': { profiles: string[] };
};

export type RelayRoleAccountAdminView = {
  accountId: string;
  username: string;
  displayName: string;
  storedRole: StoredRoleAccountRole;
  effectiveRole: EffectivePrivilegedRole | null;
  active: boolean;
  credentialState: 'configured' | 'not-configured';
  mustChangePassword: boolean;
  credentialVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string | null;
};

export type RelayPrivilegedDeviceAdminView = {
  id: string;
  deviceId: string;
  accountId: string;
  username: string;
  displayName: string;
  label: string;
  hostname: string;
  state: PrivilegedDeviceState;
  lastSeenAt: string | null;
  fingerprintSuffix: string;
  revision: number;
};

export type RelayAdministrationSettingSummary = {
  setting: RelayAdministrableSetting;
  configured: boolean;
  summary: 'Configured' | 'Not configured';
  valueSummary?: string | string[];
  revision: number;
};

export type RelayAdministrationSnapshot = {
  accounts: RelayRoleAccountAdminView[];
  devices: RelayPrivilegedDeviceAdminView[];
  settings: RelayAdministrationSettingSummary[];
  ownerAccountId: string;
  publisherAccountId: string | null;
  assignmentRevision: number;
  generatedAt: string;
};

const MAX_ADMINISTRATION_ACCOUNTS = MAX_PRIVILEGED_ADMINISTRATORS + 1;
const MAX_ADMINISTRATION_DEVICES = 500;

const CAPABILITY_SET = new Set<PrivilegedCapability>([
  ...OWNER_PRIVILEGED_CAPABILITIES,
  ...ADMIN_PRIVILEGED_CAPABILITIES,
  ...PUBLISHER_PRIVILEGED_CAPABILITIES,
]);
const SESSION_STATES = new Set<PrivilegedSessionState>([
  'signed-out',
  'pairing-required',
  'active',
  'offline',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nullableBoundedString(value: unknown, max: number): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0 && value.length <= max);
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 100) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export function isRelayAdministrableSetting(value: unknown): value is RelayAdministrableSetting {
  return (
    typeof value === 'string' && (RELAY_ADMINISTRABLE_SETTINGS as readonly string[]).includes(value)
  );
}

export function isPrivilegedRole(value: unknown): value is PrivilegedRole {
  return value === 'owner' || value === 'admin' || value === 'publisher';
}

export function isPrivilegedCapability(value: unknown): value is PrivilegedCapability {
  return typeof value === 'string' && CAPABILITY_SET.has(value as PrivilegedCapability);
}

export function getPrivilegedCapabilities(input: {
  role: PrivilegedRole;
  active: boolean;
  assigned: boolean;
}): PrivilegedCapability[] {
  if (!input.active || !input.assigned) return [];
  if (input.role === 'owner') return [...OWNER_PRIVILEGED_CAPABILITIES];
  if (input.role === 'admin') return [...ADMIN_PRIVILEGED_CAPABILITIES];
  return [...PUBLISHER_PRIVILEGED_CAPABILITIES];
}

export function normalizePrivilegedSessionView(value: unknown): PrivilegedSessionView | null {
  if (!isRecord(value)) return null;
  const { state, accountId, username, displayName, role, capabilities, deviceId, expiresAt } =
    value;

  if (
    typeof state !== 'string' ||
    !SESSION_STATES.has(state as PrivilegedSessionState) ||
    !nullableBoundedString(accountId, 200) ||
    !nullableBoundedString(username, 64) ||
    !nullableBoundedString(displayName, 120) ||
    (role !== null && !isPrivilegedRole(role)) ||
    !Array.isArray(capabilities) ||
    !nullableBoundedString(deviceId, 200) ||
    !nullableBoundedString(expiresAt, 100)
  ) {
    return null;
  }

  if (
    state === 'active' &&
    (accountId === null ||
      username === null ||
      displayName === null ||
      role === null ||
      expiresAt !== null)
  ) {
    return null;
  }
  if (state === 'pairing-required' && expiresAt !== null) return null;
  if (
    (username !== null && getRoleUsernameError(username) !== null) ||
    (displayName !== null && getRoleDisplayNameError(displayName) !== null)
  ) {
    return null;
  }

  const allowed = new Set(
    role === null ? [] : getPrivilegedCapabilities({ role, active: true, assigned: true }),
  );
  const normalizedCapabilities = capabilities
    .filter(isPrivilegedCapability)
    .filter((capability) => allowed.has(capability))
    .filter((capability, index, list) => list.indexOf(capability) === index);

  return {
    state: state as PrivilegedSessionState,
    accountId,
    username: username === null ? null : normalizeRoleUsername(username),
    displayName: displayName === null ? null : normalizeRoleDisplayName(displayName),
    role: role as PrivilegedRole | null,
    capabilities: normalizedCapabilities,
    deviceId,
    expiresAt,
  };
}

function isStoredRole(value: unknown): value is StoredRoleAccountRole {
  return value === 'administrator' || value === 'publisher';
}

function normalizeRoleAccountAdminView(value: unknown): RelayRoleAccountAdminView | null {
  if (!isRecord(value)) return null;
  const {
    accountId,
    username,
    displayName,
    storedRole,
    effectiveRole,
    active,
    credentialState,
    mustChangePassword,
    credentialVersion,
    revision,
    createdAt,
    updatedAt,
  } = value;
  if (
    !boundedString(accountId, 200) ||
    !boundedString(username, 64) ||
    getRoleUsernameError(username) !== null ||
    !boundedString(displayName, 120) ||
    getRoleDisplayNameError(displayName) !== null ||
    !isStoredRole(storedRole) ||
    (effectiveRole !== null && !isPrivilegedRole(effectiveRole)) ||
    typeof active !== 'boolean' ||
    (credentialState !== 'configured' && credentialState !== 'not-configured') ||
    typeof mustChangePassword !== 'boolean' ||
    !nonNegativeInteger(credentialVersion) ||
    !nonNegativeInteger(revision) ||
    !canonicalTimestamp(createdAt) ||
    (updatedAt !== null && !canonicalTimestamp(updatedAt))
  ) {
    return null;
  }
  return {
    accountId,
    username: normalizeRoleUsername(username),
    displayName: normalizeRoleDisplayName(displayName),
    storedRole,
    effectiveRole: effectiveRole as EffectivePrivilegedRole | null,
    active,
    credentialState,
    mustChangePassword,
    credentialVersion,
    revision,
    createdAt,
    updatedAt,
  };
}

function normalizePrivilegedDeviceAdminView(value: unknown): RelayPrivilegedDeviceAdminView | null {
  if (!isRecord(value)) return null;
  const {
    id,
    deviceId,
    accountId,
    username,
    displayName,
    label,
    hostname,
    state,
    lastSeenAt,
    fingerprintSuffix,
    revision,
  } = value;
  if (
    !boundedString(id, 200) ||
    !boundedString(deviceId, 200) ||
    !boundedString(accountId, 200) ||
    !boundedString(username, 64) ||
    getRoleUsernameError(username) !== null ||
    !boundedString(displayName, 120) ||
    getRoleDisplayNameError(displayName) !== null ||
    !boundedString(label, MAX_PRIVILEGED_DEVICE_LABEL_LENGTH) ||
    !boundedString(hostname, MAX_PRIVILEGED_HOSTNAME_LENGTH) ||
    (state !== 'active' && state !== 'revoked') ||
    !nullableBoundedString(lastSeenAt, 100) ||
    (lastSeenAt !== null && !canonicalTimestamp(lastSeenAt)) ||
    !boundedString(fingerprintSuffix, 16) ||
    !/^[A-Fa-f0-9]+$/.test(fingerprintSuffix) ||
    !nonNegativeInteger(revision)
  ) {
    return null;
  }
  return {
    id,
    deviceId,
    accountId,
    username: normalizeRoleUsername(username),
    displayName: normalizeRoleDisplayName(displayName),
    label,
    hostname,
    state,
    lastSeenAt,
    fingerprintSuffix,
    revision,
  };
}

function normalizeAdministrationSettingSummary(
  value: unknown,
): RelayAdministrationSettingSummary | null {
  if (!isRecord(value)) return null;
  const { setting, configured, summary, valueSummary, revision } = value;
  if (
    !isRelayAdministrableSetting(setting) ||
    typeof configured !== 'boolean' ||
    summary !== (configured ? 'Configured' : 'Not configured') ||
    !nonNegativeInteger(revision)
  ) {
    return null;
  }
  if (setting === 'dynatrace.platform-token' && valueSummary !== undefined) return null;
  if (
    valueSummary !== undefined &&
    typeof valueSummary !== 'string' &&
    (!Array.isArray(valueSummary) ||
      valueSummary.length > 250 ||
      valueSummary.some((entry) => typeof entry !== 'string' || entry.length > 512))
  ) {
    return null;
  }
  return {
    setting,
    configured,
    summary,
    ...(valueSummary === undefined ? {} : { valueSummary: valueSummary as string | string[] }),
    revision,
  };
}

function normalizeBoundedList<T>(
  value: unknown,
  max: number,
  normalize: (entry: unknown) => T | null,
): T[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const normalized: T[] = [];
  for (const entry of value) {
    const row = normalize(entry);
    if (!row) return null;
    normalized.push(row);
  }
  return normalized;
}

function hasUniqueSettings(settings: RelayAdministrationSettingSummary[]): boolean {
  return new Set(settings.map(({ setting }) => setting)).size === settings.length;
}

function hasValidRoleAssignments(
  accounts: RelayRoleAccountAdminView[],
  ownerAccountId: string,
  publisherAccountId: string | null,
): boolean {
  if (new Set(accounts.map(({ accountId }) => accountId)).size !== accounts.length) return false;
  if (new Set(accounts.map(({ username }) => username)).size !== accounts.length) return false;

  const state = { ownerAccountId, publisherAccountId };
  for (const account of accounts) {
    if (
      account.effectiveRole !==
      getEffectiveRole({ id: account.accountId, storedRole: account.storedRole }, state)
    ) {
      return false;
    }
  }
  const owner = accounts.find(({ accountId }) => accountId === ownerAccountId);
  if (!owner || owner.storedRole !== 'administrator' || !owner.active) return false;
  if (publisherAccountId === null) return true;
  return accounts.some(
    ({ accountId, storedRole }) => accountId === publisherAccountId && storedRole === 'publisher',
  );
}

export function normalizeRelayAdministrationSnapshot(
  value: unknown,
): RelayAdministrationSnapshot | null {
  if (!isRecord(value)) return null;
  const {
    accounts,
    devices,
    settings,
    ownerAccountId,
    publisherAccountId,
    assignmentRevision,
    generatedAt,
  } = value;

  const normalizedAccounts = normalizeBoundedList(
    accounts,
    MAX_ADMINISTRATION_ACCOUNTS,
    normalizeRoleAccountAdminView,
  );
  const normalizedDevices = normalizeBoundedList(
    devices,
    MAX_ADMINISTRATION_DEVICES,
    normalizePrivilegedDeviceAdminView,
  );
  const normalizedSettings = normalizeBoundedList(
    settings,
    RELAY_ADMINISTRABLE_SETTINGS.length,
    normalizeAdministrationSettingSummary,
  );

  if (
    !normalizedAccounts ||
    !normalizedDevices ||
    !normalizedSettings ||
    !hasUniqueSettings(normalizedSettings) ||
    !boundedString(ownerAccountId, 200) ||
    !nullableBoundedString(publisherAccountId, 200) ||
    publisherAccountId === ownerAccountId ||
    !hasValidRoleAssignments(normalizedAccounts, ownerAccountId, publisherAccountId) ||
    !nonNegativeInteger(assignmentRevision) ||
    !canonicalTimestamp(generatedAt)
  ) {
    return null;
  }

  return {
    accounts: normalizedAccounts,
    devices: normalizedDevices,
    settings: normalizedSettings,
    ownerAccountId,
    publisherAccountId,
    assignmentRevision,
    generatedAt,
  };
}
