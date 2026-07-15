export const RELAY_PRIVILEGED_ACCOUNTS_COLLECTION = 'relay_privileged_accounts';
export const RELAY_PRIVILEGED_STATE_COLLECTION = 'relay_privileged_state';
export const RELAY_PRIVILEGED_DEVICES_COLLECTION = 'relay_privileged_devices';
export const RELAY_PRIVILEGED_COMMANDS_COLLECTION = 'relay_privileged_commands';

export const PRIVILEGED_SESSION_IDLE_MS = 15 * 60 * 1_000;
export const MAX_PRIVILEGED_DEVICE_LABEL_LENGTH = 80;
export const MAX_PRIVILEGED_HOSTNAME_LENGTH = 255;
export const MIN_PRIVILEGED_PASSWORD_LENGTH = 12;
export const MAX_PRIVILEGED_PASSWORD_LENGTH = 128;

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
  adminOperatorId: string;
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

export function isPrivilegedRole(value: unknown): value is PrivilegedRole {
  return value === 'admin' || value === 'publisher';
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
