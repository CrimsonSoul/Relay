import {
  MAX_PRIVILEGED_DEVICE_LABEL_LENGTH,
  isPrivilegedRole,
  isRelayAdministrableSetting,
  type PrivilegedRole,
  type RelayAdministrableSetting,
  type RelayAdministrationSettingValueMap,
} from './privilegedAccess';
import {
  MAX_DYNATRACE_ALERTING_PROFILES,
  MAX_DYNATRACE_ALERTING_PROFILE_LENGTH,
  getDynatraceApiTokenError,
  getDynatraceEnvironmentUrlError,
  normalizeDynatraceEnvironmentUrl,
} from './dynatraceProblems';
import { getOperatorDisplayNameError, normalizeOperatorDisplayName } from './operators';
import { KNOWLEDGE_MAX_CATEGORY_LENGTH } from './knowledge';

export const MAX_PRIVILEGED_COMMAND_BYTES = 64 * 1024;
export const MAX_PRIVILEGED_REQUEST_ID_LENGTH = 128;
export const PRIVILEGED_COMMAND_MAX_CLOCK_SKEW_MS = 60 * 1_000;
export const PRIVILEGED_COMMAND_MAX_LIFETIME_MS = 90 * 1_000;

const MAX_CANONICAL_DEPTH = 16;
const MAX_CANONICAL_NODES = 2_000;
const MAX_CANONICAL_STRING_LENGTH = 32 * 1024;
const MAX_CANONICAL_ARRAY_LENGTH = 1_000;
const MAX_CANONICAL_OBJECT_KEYS = 200;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{64,512}$/;

export type RelayAdministrationSettingReplacePayload = {
  [K in RelayAdministrableSetting]: {
    setting: K;
    value: RelayAdministrationSettingValueMap[K];
    expectedRevision: number;
    reauthRequestId?: string;
  };
}[RelayAdministrableSetting];

export type PrivilegedCommandPayloadMap = {
  'privileged.status.read': { clientVersion: string };
  'privileged.reauth.confirm': { authenticatedAt: string };
  'administration.snapshot.read': Record<string, never>;
  'operator.create': { displayName: string };
  'operator.rename': { operatorId: string; displayName: string; expectedRevision: number };
  'operator.active.set': { operatorId: string; active: boolean; expectedRevision: number };
  'publisher.assign': {
    operatorId: string | null;
    expectedStateRevision: number;
    reauthRequestId: string;
  };
  'privileged.device.rename': { deviceId: string; label: string; expectedRevision: number };
  'privileged.device.revoke': {
    deviceId: string;
    expectedRevision: number;
    reauthRequestId: string;
  };
  'administration.setting.replace': RelayAdministrationSettingReplacePayload;
  'knowledge.upload.validate': { uploadId: string; preliminaryChecksum: string };
  'knowledge.snapshot.read': { query: string; cursor: string | null; pageSize: number };
  'knowledge.document.publish': { uploadId: string; title: string; category: string };
  'knowledge.document.replace': {
    uploadId: string;
    documentId: string;
    expectedRevision: number;
    title: string;
    category: string;
  };
  'knowledge.document.title.set': {
    documentId: string;
    title: string;
    expectedRevision: number;
  };
  'knowledge.document.category.set': {
    documentId: string;
    category: string;
    expectedRevision: number;
  };
  'knowledge.category.rename': {
    from: string;
    to: string;
    expectedDocumentRevisions: Record<string, number>;
  };
  'knowledge.document.trash': { documentId: string; expectedRevision: number };
  'knowledge.document.restore': { documentId: string; expectedRevision: number };
  'knowledge.document.delete': {
    documentId: string;
    expectedRevision: number;
    reauthRequestId: string;
  };
  'knowledge.audit.read': { cursor: string | null; pageSize: number; targetId: string | null };
};

export type PrivilegedCommandName = keyof PrivilegedCommandPayloadMap;
export type InternalPrivilegedCommandName = 'privileged.reauth.confirm';
export type PublicPrivilegedCommandName = Exclude<
  PrivilegedCommandName,
  InternalPrivilegedCommandName
>;

export type PrivilegedCommandSigningBody<K extends PrivilegedCommandName = PrivilegedCommandName> =
  {
    version: 1;
    requestId: string;
    accountId: string;
    deviceId: string;
    roleClaim: PrivilegedRole;
    command: K;
    payload: PrivilegedCommandPayloadMap[K];
    payloadHash: string;
    expectedRevision: number | null;
    issuedAt: string;
    expiresAt: string;
  };

export type SignedPrivilegedCommandEnvelope<
  K extends PrivilegedCommandName = PrivilegedCommandName,
> = PrivilegedCommandSigningBody<K> & {
  signature: string;
};

export type PrivilegedCommandError =
  | 'unauthorized'
  | 'locked'
  | 'offline'
  | 'pairing-required'
  | 'invalid-request'
  | 'expired'
  | 'replayed'
  | 'conflict'
  | 'server-error';

export type PrivilegedCommandResult<T = unknown> =
  | { ok: true; requestId: string; value: T }
  | {
      ok: false;
      requestId?: string;
      error: PrivilegedCommandError;
      message?: string;
      currentRevision?: number;
      refresh?: true;
    };

export type PrivilegedEnvelopeValidationResult =
  | { ok: true; envelope: SignedPrivilegedCommandEnvelope }
  | { ok: false; error: 'invalid-request' | 'expired' };

type CanonicalizationState = {
  nodes: number;
};

function assertCanonicalNode(state: CanonicalizationState, depth: number): void {
  if (depth > MAX_CANONICAL_DEPTH) {
    throw new TypeError('Privileged command values are nested too deeply.');
  }
  state.nodes += 1;
  if (state.nodes > MAX_CANONICAL_NODES) {
    throw new TypeError('Privileged command contains too many values.');
  }
}

function compareCanonicalKeys(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function canonicalizeArray(value: unknown[], state: CanonicalizationState, depth: number): string {
  if (value.length > MAX_CANONICAL_ARRAY_LENGTH) {
    throw new TypeError('Privileged command array is too long.');
  }
  return `[${value.map((entry) => canonicalize(entry, state, depth + 1)).join(',')}]`;
}

function canonicalizeObject(value: object, state: CanonicalizationState, depth: number): string {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Privileged command contains an unsupported object.');
  }
  const record = value as Record<string, unknown>;
  // Locale-aware sorting is intentionally avoided: signatures require identical UTF-16 ordering.
  const keys = Object.keys(record).sort(compareCanonicalKeys);
  if (keys.length > MAX_CANONICAL_OBJECT_KEYS) {
    throw new TypeError('Privileged command object has too many keys.');
  }
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key], state, depth + 1)}`)
    .join(',')}}`;
}

function canonicalize(value: unknown, state: CanonicalizationState, depth: number): string {
  assertCanonicalNode(state, depth);

  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Privileged command numbers must be finite.');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    if (value.length > MAX_CANONICAL_STRING_LENGTH) {
      throw new TypeError('Privileged command string is too long.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return canonicalizeArray(value, state, depth);
  if (typeof value === 'object') return canonicalizeObject(value, state, depth);
  throw new TypeError('Privileged command contains an unsupported value.');
}

export function canonicalizePrivilegedValue(value: unknown): string {
  return canonicalize(value, { nodes: 0 }, 0);
}

export function canonicalPrivilegedSigningBytes(
  envelope: SignedPrivilegedCommandEnvelope,
): Uint8Array {
  const body: PrivilegedCommandSigningBody = {
    version: envelope.version,
    requestId: envelope.requestId,
    accountId: envelope.accountId,
    deviceId: envelope.deviceId,
    roleClaim: envelope.roleClaim,
    command: envelope.command,
    payload: envelope.payload,
    payloadHash: envelope.payloadHash,
    expectedRevision: envelope.expectedRevision,
    issuedAt: envelope.issuedAt,
    expiresAt: envelope.expiresAt,
  };
  const bytes = new TextEncoder().encode(canonicalizePrivilegedValue(body));
  if (bytes.byteLength > MAX_PRIVILEGED_COMMAND_BYTES) {
    throw new TypeError('Privileged command exceeds the maximum size.');
  }
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  // Exact command schemas use the same locale-independent key order as canonical signing.
  const actual = Object.keys(record).sort(compareCanonicalKeys);
  const sortedExpected = [...expected].sort(compareCanonicalKeys);
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function boundedIdentifier(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    IDENTIFIER_PATTERN.test(value)
  );
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 100) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export function isPrivilegedSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

export function isPublicPrivilegedCommandName(
  value: unknown,
): value is PublicPrivilegedCommandName {
  return typeof value === 'string' && PUBLIC_PRIVILEGED_COMMANDS.has(value);
}

const PUBLIC_PRIVILEGED_COMMANDS = new Set<string>([
  'privileged.status.read',
  'administration.snapshot.read',
  'operator.create',
  'operator.rename',
  'operator.active.set',
  'publisher.assign',
  'privileged.device.rename',
  'privileged.device.revoke',
  'administration.setting.replace',
  'knowledge.upload.validate',
  'knowledge.snapshot.read',
  'knowledge.document.publish',
  'knowledge.document.replace',
  'knowledge.document.title.set',
  'knowledge.document.category.set',
  'knowledge.category.rename',
  'knowledge.document.trash',
  'knowledge.document.restore',
  'knowledge.document.delete',
  'knowledge.audit.read',
]);

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function normalizeDeviceLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized && normalized.length <= MAX_PRIVILEGED_DEVICE_LABEL_LENGTH ? normalized : null;
}

function normalizedKnowledgeText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized && normalized.length <= max ? normalized : null;
}

function normalizeKnowledgeCursor(value: unknown): string | null | undefined {
  if (value === null) return null;
  return boundedIdentifier(value, 200) ? value : undefined;
}

function normalizeKnowledgeDocumentRevision(
  payload: Record<string, unknown>,
): { documentId: string; expectedRevision: number } | null {
  return boundedIdentifier(payload.documentId, 200) && nonNegativeInteger(payload.expectedRevision)
    ? { documentId: payload.documentId, expectedRevision: payload.expectedRevision }
    : null;
}

function normalizeKnowledgeRevisions(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > 500) return null;
  const revisions: Record<string, number> = {};
  for (const [id, revision] of entries) {
    if (!boundedIdentifier(id, 200) || !nonNegativeInteger(revision)) return null;
    revisions[id] = revision;
  }
  return revisions;
}

function normalizeAlertingProfiles(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_DYNATRACE_ALERTING_PROFILES) return null;
  const profiles: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') return null;
    const profile = entry.trim().replace(/\s+/g, ' ');
    const key = profile.toLocaleLowerCase('en');
    if (!profile || profile.length > MAX_DYNATRACE_ALERTING_PROFILE_LENGTH || seen.has(key)) {
      return null;
    }
    seen.add(key);
    profiles.push(profile);
  }
  return profiles;
}

function normalizeEnvironmentSettingValue(value: Record<string, unknown>): {
  environmentUrl: string;
} | null {
  if (!hasExactKeys(value, ['environmentUrl'])) return null;
  const { environmentUrl } = value;
  if (typeof environmentUrl !== 'string' || getDynatraceEnvironmentUrlError(environmentUrl)) {
    return null;
  }
  return { environmentUrl: normalizeDynatraceEnvironmentUrl(environmentUrl) };
}

function normalizeTokenSettingValue(value: Record<string, unknown>): {
  apiToken: string;
  environmentUrl?: string;
} | null {
  if (!hasExactKeys(value, ['apiToken']) && !hasExactKeys(value, ['apiToken', 'environmentUrl'])) {
    return null;
  }
  const { apiToken, environmentUrl } = value;
  if (typeof apiToken !== 'string' || getDynatraceApiTokenError(apiToken)) return null;
  if (
    environmentUrl !== undefined &&
    (typeof environmentUrl !== 'string' || getDynatraceEnvironmentUrlError(environmentUrl))
  ) {
    return null;
  }
  return {
    apiToken: apiToken.trim(),
    ...(environmentUrl === undefined
      ? {}
      : { environmentUrl: normalizeDynatraceEnvironmentUrl(environmentUrl) }),
  };
}

function normalizeRelayAdministrationSettingValue<K extends RelayAdministrableSetting>(
  setting: K,
  value: unknown,
): RelayAdministrationSettingValueMap[K] | null {
  if (!isRecord(value)) return null;
  if (setting === 'dynatrace.environment-url') {
    return normalizeEnvironmentSettingValue(value) as RelayAdministrationSettingValueMap[K] | null;
  }
  if (setting === 'dynatrace.platform-token') {
    return normalizeTokenSettingValue(value) as RelayAdministrationSettingValueMap[K] | null;
  }
  if (!hasExactKeys(value, ['profiles'])) return null;
  const profiles = normalizeAlertingProfiles(value.profiles);
  return profiles ? ({ profiles } as RelayAdministrationSettingValueMap[K]) : null;
}

export function getRelayAdministrationSettingValueError(
  setting: RelayAdministrableSetting,
  value: unknown,
): string | null {
  if (
    setting === 'dynatrace.alerting-profiles' &&
    isRecord(value) &&
    Array.isArray(value.profiles)
  ) {
    const normalized = value.profiles.map((entry) =>
      typeof entry === 'string' ? entry.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en') : '',
    );
    if (new Set(normalized).size !== normalized.length)
      return 'Remove duplicate alerting profiles.';
  }
  return normalizeRelayAdministrationSettingValue(setting, value)
    ? null
    : 'Enter a supported value for this Relay setting.';
}

type NormalizedCommandPayload = PrivilegedCommandPayloadMap[PrivilegedCommandName];

function normalizeStatusPayload(payload: Record<string, unknown>): NormalizedCommandPayload | null {
  if (!hasExactKeys(payload, ['clientVersion'])) return null;
  const { clientVersion } = payload;
  if (typeof clientVersion !== 'string' || !clientVersion || clientVersion.length > 100)
    return null;
  return { clientVersion };
}

function normalizeReauthenticationPayload(
  payload: Record<string, unknown>,
): NormalizedCommandPayload | null {
  if (!hasExactKeys(payload, ['authenticatedAt'])) return null;
  const { authenticatedAt } = payload;
  return canonicalTimestamp(authenticatedAt) ? { authenticatedAt } : null;
}

function normalizeOperatorCreatePayload(
  payload: Record<string, unknown>,
): NormalizedCommandPayload | null {
  if (!hasExactKeys(payload, ['displayName']) || typeof payload.displayName !== 'string')
    return null;
  const displayName = normalizeOperatorDisplayName(payload.displayName);
  return getOperatorDisplayNameError(displayName) ? null : { displayName };
}

function normalizeOperatorRenamePayload(
  payload: Record<string, unknown>,
): NormalizedCommandPayload | null {
  if (!hasExactKeys(payload, ['operatorId', 'displayName', 'expectedRevision'])) return null;
  const { operatorId, displayName: rawDisplayName, expectedRevision } = payload;
  if (
    !boundedIdentifier(operatorId, 200) ||
    typeof rawDisplayName !== 'string' ||
    !nonNegativeInteger(expectedRevision)
  ) {
    return null;
  }
  const displayName = normalizeOperatorDisplayName(rawDisplayName);
  return getOperatorDisplayNameError(displayName)
    ? null
    : { operatorId, displayName, expectedRevision };
}

function normalizeOperatorActivePayload(
  payload: Record<string, unknown>,
): NormalizedCommandPayload | null {
  if (!hasExactKeys(payload, ['operatorId', 'active', 'expectedRevision'])) return null;
  const { operatorId, active, expectedRevision } = payload;
  return boundedIdentifier(operatorId, 200) &&
    typeof active === 'boolean' &&
    nonNegativeInteger(expectedRevision)
    ? { operatorId, active, expectedRevision }
    : null;
}

function normalizePublisherAssignmentPayload(
  payload: Record<string, unknown>,
): NormalizedCommandPayload | null {
  if (!hasExactKeys(payload, ['operatorId', 'expectedStateRevision', 'reauthRequestId']))
    return null;
  const { operatorId, expectedStateRevision, reauthRequestId } = payload;
  return (operatorId === null || boundedIdentifier(operatorId, 200)) &&
    nonNegativeInteger(expectedStateRevision) &&
    boundedIdentifier(reauthRequestId, MAX_PRIVILEGED_REQUEST_ID_LENGTH)
    ? { operatorId, expectedStateRevision, reauthRequestId }
    : null;
}

function normalizeDeviceRenamePayload(
  payload: Record<string, unknown>,
): NormalizedCommandPayload | null {
  if (!hasExactKeys(payload, ['deviceId', 'label', 'expectedRevision'])) return null;
  const { deviceId, expectedRevision } = payload;
  const label = normalizeDeviceLabel(payload.label);
  return boundedIdentifier(deviceId, 200) && label && nonNegativeInteger(expectedRevision)
    ? { deviceId, label, expectedRevision }
    : null;
}

function normalizeDeviceRevokePayload(
  payload: Record<string, unknown>,
): NormalizedCommandPayload | null {
  if (!hasExactKeys(payload, ['deviceId', 'expectedRevision', 'reauthRequestId'])) return null;
  const { deviceId, expectedRevision, reauthRequestId } = payload;
  return boundedIdentifier(deviceId, 200) &&
    nonNegativeInteger(expectedRevision) &&
    boundedIdentifier(reauthRequestId, MAX_PRIVILEGED_REQUEST_ID_LENGTH)
    ? { deviceId, expectedRevision, reauthRequestId }
    : null;
}

function normalizeSettingReplacementPayload(
  payload: Record<string, unknown>,
): NormalizedCommandPayload | null {
  const hasRequiredKeys = hasExactKeys(payload, ['setting', 'value', 'expectedRevision']);
  const hasReauthentication = hasExactKeys(payload, [
    'setting',
    'value',
    'expectedRevision',
    'reauthRequestId',
  ]);
  if (!hasRequiredKeys && !hasReauthentication) return null;
  const { setting, expectedRevision, reauthRequestId } = payload;
  if (!isRelayAdministrableSetting(setting) || !nonNegativeInteger(expectedRevision)) return null;
  if (
    reauthRequestId !== undefined &&
    !boundedIdentifier(reauthRequestId, MAX_PRIVILEGED_REQUEST_ID_LENGTH)
  ) {
    return null;
  }
  const normalizedValue = normalizeRelayAdministrationSettingValue(setting, payload.value);
  if (!normalizedValue) return null;
  return {
    setting,
    value: normalizedValue,
    expectedRevision,
    ...(reauthRequestId === undefined ? {} : { reauthRequestId }),
  } as PrivilegedCommandPayloadMap['administration.setting.replace'];
}

// Exact-key validation across the full signed command union is intentionally centralized.
// eslint-disable-next-line sonarjs/cognitive-complexity
function normalizePayload(
  command: PrivilegedCommandName,
  payload: unknown,
): PrivilegedCommandPayloadMap[PrivilegedCommandName] | null {
  if (!isRecord(payload)) return null;
  switch (command) {
    case 'privileged.status.read':
      return normalizeStatusPayload(payload);
    case 'privileged.reauth.confirm':
      return normalizeReauthenticationPayload(payload);
    case 'administration.snapshot.read':
      return hasExactKeys(payload, []) ? {} : null;
    case 'operator.create':
      return normalizeOperatorCreatePayload(payload);
    case 'operator.rename':
      return normalizeOperatorRenamePayload(payload);
    case 'operator.active.set':
      return normalizeOperatorActivePayload(payload);
    case 'publisher.assign':
      return normalizePublisherAssignmentPayload(payload);
    case 'privileged.device.rename':
      return normalizeDeviceRenamePayload(payload);
    case 'privileged.device.revoke':
      return normalizeDeviceRevokePayload(payload);
    case 'administration.setting.replace':
      return normalizeSettingReplacementPayload(payload);
    case 'knowledge.upload.validate':
      return hasExactKeys(payload, ['uploadId', 'preliminaryChecksum']) &&
        boundedIdentifier(payload.uploadId, 200) &&
        isPrivilegedSha256(payload.preliminaryChecksum)
        ? { uploadId: payload.uploadId, preliminaryChecksum: payload.preliminaryChecksum }
        : null;
    case 'knowledge.snapshot.read': {
      if (!hasExactKeys(payload, ['query', 'cursor', 'pageSize'])) return null;
      const cursor = normalizeKnowledgeCursor(payload.cursor);
      return typeof payload.query === 'string' &&
        payload.query.length <= 200 &&
        cursor !== undefined &&
        Number.isInteger(payload.pageSize) &&
        (payload.pageSize as number) >= 1 &&
        (payload.pageSize as number) <= 100
        ? { query: payload.query.trim(), cursor, pageSize: payload.pageSize as number }
        : null;
    }
    case 'knowledge.document.publish': {
      if (!hasExactKeys(payload, ['uploadId', 'title', 'category'])) return null;
      const title = normalizedKnowledgeText(payload.title, 240);
      const category = normalizedKnowledgeText(payload.category, KNOWLEDGE_MAX_CATEGORY_LENGTH);
      return boundedIdentifier(payload.uploadId, 200) && title && category
        ? { uploadId: payload.uploadId, title, category }
        : null;
    }
    case 'knowledge.document.replace': {
      if (
        !hasExactKeys(payload, ['uploadId', 'documentId', 'expectedRevision', 'title', 'category'])
      )
        return null;
      const revision = normalizeKnowledgeDocumentRevision(payload);
      const title = normalizedKnowledgeText(payload.title, 240);
      const category = normalizedKnowledgeText(payload.category, KNOWLEDGE_MAX_CATEGORY_LENGTH);
      return revision && boundedIdentifier(payload.uploadId, 200) && title && category
        ? { uploadId: payload.uploadId, ...revision, title, category }
        : null;
    }
    case 'knowledge.document.title.set':
    case 'knowledge.document.category.set': {
      const key = command === 'knowledge.document.title.set' ? 'title' : 'category';
      if (!hasExactKeys(payload, ['documentId', key, 'expectedRevision'])) return null;
      const revision = normalizeKnowledgeDocumentRevision(payload);
      const text = normalizedKnowledgeText(
        payload[key],
        key === 'title' ? 240 : KNOWLEDGE_MAX_CATEGORY_LENGTH,
      );
      return revision && text ? { ...revision, [key]: text } : null;
    }
    case 'knowledge.category.rename': {
      if (!hasExactKeys(payload, ['from', 'to', 'expectedDocumentRevisions'])) return null;
      const from = normalizedKnowledgeText(payload.from, KNOWLEDGE_MAX_CATEGORY_LENGTH);
      const to = normalizedKnowledgeText(payload.to, KNOWLEDGE_MAX_CATEGORY_LENGTH);
      const expectedDocumentRevisions = normalizeKnowledgeRevisions(
        payload.expectedDocumentRevisions,
      );
      return from && to && expectedDocumentRevisions
        ? { from, to, expectedDocumentRevisions }
        : null;
    }
    case 'knowledge.document.trash':
    case 'knowledge.document.restore':
      return hasExactKeys(payload, ['documentId', 'expectedRevision'])
        ? normalizeKnowledgeDocumentRevision(payload)
        : null;
    case 'knowledge.document.delete': {
      if (!hasExactKeys(payload, ['documentId', 'expectedRevision', 'reauthRequestId']))
        return null;
      const revision = normalizeKnowledgeDocumentRevision(payload);
      return revision &&
        boundedIdentifier(payload.reauthRequestId, MAX_PRIVILEGED_REQUEST_ID_LENGTH)
        ? { ...revision, reauthRequestId: payload.reauthRequestId }
        : null;
    }
    case 'knowledge.audit.read': {
      if (!hasExactKeys(payload, ['cursor', 'pageSize', 'targetId'])) return null;
      const cursor = normalizeKnowledgeCursor(payload.cursor);
      const targetId = normalizeKnowledgeCursor(payload.targetId);
      return cursor !== undefined &&
        targetId !== undefined &&
        Number.isInteger(payload.pageSize) &&
        (payload.pageSize as number) >= 1 &&
        (payload.pageSize as number) <= 100
        ? { cursor, pageSize: payload.pageSize as number, targetId }
        : null;
    }
  }
}

export function normalizePrivilegedCommandPayload<K extends PrivilegedCommandName>(
  command: K,
  payload: unknown,
): PrivilegedCommandPayloadMap[K] | null {
  return normalizePayload(command, payload) as PrivilegedCommandPayloadMap[K] | null;
}

const ENVELOPE_KEYS = [
  'version',
  'requestId',
  'accountId',
  'deviceId',
  'roleClaim',
  'command',
  'payload',
  'payloadHash',
  'expectedRevision',
  'issuedAt',
  'expiresAt',
  'signature',
] as const;

export function validateSignedPrivilegedCommandEnvelope(
  value: unknown,
  nowMs = Date.now(),
): PrivilegedEnvelopeValidationResult {
  if (!isRecord(value) || !hasExactKeys(value, ENVELOPE_KEYS)) {
    return { ok: false, error: 'invalid-request' };
  }

  const {
    version,
    requestId,
    accountId,
    deviceId,
    roleClaim,
    command,
    payload,
    payloadHash,
    expectedRevision,
    issuedAt,
    expiresAt,
    signature,
  } = value;

  if (
    version !== 1 ||
    !boundedIdentifier(requestId, MAX_PRIVILEGED_REQUEST_ID_LENGTH) ||
    !boundedIdentifier(accountId, 200) ||
    !boundedIdentifier(deviceId, 200) ||
    !isPrivilegedRole(roleClaim) ||
    (command !== 'privileged.reauth.confirm' && !isPublicPrivilegedCommandName(command)) ||
    !isPrivilegedSha256(payloadHash) ||
    (expectedRevision !== null &&
      (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 0)) ||
    !canonicalTimestamp(issuedAt) ||
    !canonicalTimestamp(expiresAt) ||
    typeof signature !== 'string' ||
    !SIGNATURE_PATTERN.test(signature)
  ) {
    return { ok: false, error: 'invalid-request' };
  }

  const normalizedPayload = normalizePayload(command, payload);
  if (!normalizedPayload) return { ok: false, error: 'invalid-request' };

  const issuedAtMs = Date.parse(issuedAt);
  const expiresAtMs = Date.parse(expiresAt);
  if (expiresAtMs <= nowMs) return { ok: false, error: 'expired' };
  if (
    issuedAtMs > nowMs + PRIVILEGED_COMMAND_MAX_CLOCK_SKEW_MS ||
    expiresAtMs <= issuedAtMs ||
    expiresAtMs - issuedAtMs > PRIVILEGED_COMMAND_MAX_LIFETIME_MS
  ) {
    return { ok: false, error: 'invalid-request' };
  }

  const envelope = {
    version: 1,
    requestId,
    accountId,
    deviceId,
    roleClaim,
    command,
    payload: normalizedPayload,
    payloadHash,
    expectedRevision: expectedRevision as number | null,
    issuedAt,
    expiresAt,
    signature,
  } as SignedPrivilegedCommandEnvelope;

  try {
    canonicalPrivilegedSigningBytes(envelope);
  } catch {
    return { ok: false, error: 'invalid-request' };
  }
  return { ok: true, envelope };
}
