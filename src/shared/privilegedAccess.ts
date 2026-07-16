export const RELAY_PRIVILEGED_ACCOUNTS_COLLECTION = 'relay_privileged_accounts';
export const RELAY_PRIVILEGED_STATE_COLLECTION = 'relay_privileged_state';
export const RELAY_PRIVILEGED_DEVICES_COLLECTION = 'relay_privileged_devices';
export const RELAY_PRIVILEGED_COMMANDS_COLLECTION = 'relay_privileged_commands';
export const RELAY_PRIVILEGED_PAIRING_CHALLENGES_COLLECTION = 'relay_privileged_pairing_challenges';
export const RELAY_PRIVILEGED_PAIRING_REQUESTS_COLLECTION = 'relay_privileged_pairing_requests';

export const PRIVILEGED_SESSION_IDLE_MS = 15 * 60 * 1_000;
export const MAX_PRIVILEGED_DEVICE_LABEL_LENGTH = 80;
export const MAX_PRIVILEGED_HOSTNAME_LENGTH = 255;
export const MIN_PRIVILEGED_PASSWORD_LENGTH = 12;
export const MAX_PRIVILEGED_PASSWORD_LENGTH = 128;
export const MAX_PRIVILEGED_ADMINISTRATORS = 10;

export type PrivilegedRole = 'admin' | 'publisher';

export type PrivilegedCapability =
  | 'privileged.status.read'
  | 'operators.manage'
  | 'publisher.assign'
  | 'devices.manage'
  | 'settings.manage'
  | 'knowledge.manage';

export const ADMIN_PRIVILEGED_CAPABILITIES: readonly PrivilegedCapability[] = [
  'privileged.status.read',
  'operators.manage',
  'publisher.assign',
  'devices.manage',
  'settings.manage',
  'knowledge.manage',
];

export const PUBLISHER_PRIVILEGED_CAPABILITIES: readonly PrivilegedCapability[] = [
  'privileged.status.read',
  'knowledge.manage',
];

export type RelayPrivilegedAccountRecord = {
  id: string;
  operatorId: string;
  role: PrivilegedRole;
  active: boolean;
  mustChangePassword: boolean;
  credentialVersion: number;
  created: string;
  updated: string;
};

export type RelayPrivilegedStateRecord = {
  id: string;
  key: 'primary';
  /** Permanent application owner retained for backward compatibility and recovery. */
  adminOperatorId: string;
  /** Full administrators, including the permanent owner. Missing on legacy records. */
  adminOperatorIds?: string[];
  publisherOperatorId: string | null;
  assignmentVersion: number;
  rosterMigrationVersion: number;
  updatedByOperatorId: string | null;
  updatedAt: string;
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
  revokedByOperatorId: string | null;
  revision: number;
  created: string;
  updated: string;
};

export type PrivilegedSessionState =
  | 'signed-out'
  | 'pairing-required'
  | 'active'
  | 'locked'
  | 'offline';

export type PrivilegedSessionView = {
  state: PrivilegedSessionState;
  accountId: string | null;
  operatorId: string | null;
  operatorName: string | null;
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

export type RelayOperatorAdminView = {
  id: string;
  displayName: string;
  active: boolean;
  revision: number;
  role: PrivilegedRole | null;
  created: string;
  updated: string;
};

export type RelayPrivilegedAccountAdminView = {
  accountId: string;
  operatorId: string;
  role: PrivilegedRole;
  active: boolean;
  credentialState: 'configured' | 'not-configured';
  mustChangePassword: boolean;
  credentialVersion: number;
  updatedAt: string | null;
};

export type RelayPrivilegedDeviceAdminView = {
  id: string;
  deviceId: string;
  accountId: string;
  operatorId: string;
  operatorName: string;
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
  operators: RelayOperatorAdminView[];
  privilegedAccounts: RelayPrivilegedAccountAdminView[];
  devices: RelayPrivilegedDeviceAdminView[];
  settings: RelayAdministrationSettingSummary[];
  adminOperatorId: string;
  publisherOperatorId: string | null;
  assignmentRevision: number;
  generatedAt: string;
};

const MAX_ADMINISTRATION_OPERATORS = 500;
const MAX_ADMINISTRATION_ACCOUNTS = 10;
const MAX_ADMINISTRATION_DEVICES = 500;

const CAPABILITY_SET = new Set<PrivilegedCapability>(ADMIN_PRIVILEGED_CAPABILITIES);
const SESSION_STATES = new Set<PrivilegedSessionState>([
  'signed-out',
  'pairing-required',
  'active',
  'locked',
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
  return value === 'admin' || value === 'publisher';
}

type PrivilegedAdministratorState = {
  adminOperatorId?: unknown;
  adminOperatorIds?: unknown;
};

export function getPrivilegedAdministratorOperatorIds(
  state: PrivilegedAdministratorState,
): string[] {
  const candidates = [
    state.adminOperatorId,
    ...(Array.isArray(state.adminOperatorIds) ? state.adminOperatorIds : []),
  ];
  const administratorIds: string[] = [];
  for (const candidate of candidates) {
    if (!boundedString(candidate, 200) || administratorIds.includes(candidate)) continue;
    administratorIds.push(candidate);
    if (administratorIds.length === MAX_PRIVILEGED_ADMINISTRATORS) break;
  }
  return administratorIds;
}

export function isPrivilegedAdministrator(
  state: PrivilegedAdministratorState,
  operatorId: string,
): boolean {
  return getPrivilegedAdministratorOperatorIds(state).includes(operatorId);
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
  return [
    ...(input.role === 'admin' ? ADMIN_PRIVILEGED_CAPABILITIES : PUBLISHER_PRIVILEGED_CAPABILITIES),
  ];
}

export function normalizePrivilegedSessionView(value: unknown): PrivilegedSessionView | null {
  if (!isRecord(value)) return null;
  const { state, accountId, operatorId, operatorName, role, capabilities, deviceId, expiresAt } =
    value;

  if (
    typeof state !== 'string' ||
    !SESSION_STATES.has(state as PrivilegedSessionState) ||
    !nullableBoundedString(accountId, 200) ||
    !nullableBoundedString(operatorId, 200) ||
    !nullableBoundedString(operatorName, 120) ||
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
      operatorId === null ||
      operatorName === null ||
      role === null ||
      expiresAt === null)
  ) {
    return null;
  }

  let allowedCapabilities: readonly PrivilegedCapability[] = [];
  if (role === 'admin') {
    allowedCapabilities = ADMIN_PRIVILEGED_CAPABILITIES;
  } else if (role === 'publisher') {
    allowedCapabilities = PUBLISHER_PRIVILEGED_CAPABILITIES;
  }
  const allowed = new Set(allowedCapabilities);
  const normalizedCapabilities = capabilities
    .filter(isPrivilegedCapability)
    .filter((capability) => allowed.has(capability))
    .filter((capability, index, list) => list.indexOf(capability) === index);

  return {
    state: state as PrivilegedSessionState,
    accountId,
    operatorId,
    operatorName,
    role: role as PrivilegedRole | null,
    capabilities: normalizedCapabilities,
    deviceId,
    expiresAt,
  };
}

function normalizeOperatorAdminView(value: unknown): RelayOperatorAdminView | null {
  if (!isRecord(value)) return null;
  const { id, displayName, active, revision, role, created, updated } = value;
  if (
    !boundedString(id, 200) ||
    !boundedString(displayName, 120) ||
    typeof active !== 'boolean' ||
    !nonNegativeInteger(revision) ||
    (role !== null && !isPrivilegedRole(role)) ||
    !canonicalTimestamp(created) ||
    !canonicalTimestamp(updated)
  ) {
    return null;
  }
  return {
    id,
    displayName,
    active,
    revision,
    role: role as PrivilegedRole | null,
    created,
    updated,
  };
}

function normalizePrivilegedAccountAdminView(
  value: unknown,
): RelayPrivilegedAccountAdminView | null {
  if (!isRecord(value)) return null;
  const {
    accountId,
    operatorId,
    role,
    active,
    credentialState,
    mustChangePassword,
    credentialVersion,
    updatedAt,
  } = value;
  if (
    !boundedString(accountId, 200) ||
    !boundedString(operatorId, 200) ||
    !isPrivilegedRole(role) ||
    typeof active !== 'boolean' ||
    (credentialState !== 'configured' && credentialState !== 'not-configured') ||
    typeof mustChangePassword !== 'boolean' ||
    !nonNegativeInteger(credentialVersion) ||
    (updatedAt !== null && !canonicalTimestamp(updatedAt))
  ) {
    return null;
  }
  return {
    accountId,
    operatorId,
    role,
    active,
    credentialState,
    mustChangePassword,
    credentialVersion,
    updatedAt,
  };
}

function normalizePrivilegedDeviceAdminView(value: unknown): RelayPrivilegedDeviceAdminView | null {
  if (!isRecord(value)) return null;
  const {
    id,
    deviceId,
    accountId,
    operatorId,
    operatorName,
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
    !boundedString(operatorId, 200) ||
    !boundedString(operatorName, 120) ||
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
    operatorId,
    operatorName,
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

export function normalizeRelayAdministrationSnapshot(
  value: unknown,
): RelayAdministrationSnapshot | null {
  if (!isRecord(value)) return null;
  const {
    operators,
    privilegedAccounts,
    devices,
    settings,
    adminOperatorId,
    publisherOperatorId,
    assignmentRevision,
    generatedAt,
  } = value;

  const normalizedOperators = normalizeBoundedList(
    operators,
    MAX_ADMINISTRATION_OPERATORS,
    normalizeOperatorAdminView,
  );
  const normalizedAccounts = normalizeBoundedList(
    privilegedAccounts,
    MAX_ADMINISTRATION_ACCOUNTS,
    normalizePrivilegedAccountAdminView,
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
    !normalizedOperators ||
    !normalizedAccounts ||
    !normalizedDevices ||
    !normalizedSettings ||
    !hasUniqueSettings(normalizedSettings) ||
    !boundedString(adminOperatorId, 200) ||
    !nullableBoundedString(publisherOperatorId, 200) ||
    publisherOperatorId === adminOperatorId ||
    normalizedOperators.some(
      (operator) => operator.id === publisherOperatorId && operator.role === 'admin',
    ) ||
    !nonNegativeInteger(assignmentRevision) ||
    !canonicalTimestamp(generatedAt)
  ) {
    return null;
  }

  return {
    operators: normalizedOperators,
    privilegedAccounts: normalizedAccounts,
    devices: normalizedDevices,
    settings: normalizedSettings,
    adminOperatorId,
    publisherOperatorId,
    assignmentRevision,
    generatedAt,
  };
}
