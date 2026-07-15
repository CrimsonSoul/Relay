import { isPrivilegedRole, type PrivilegedRole } from './privilegedAccess';

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

export type PrivilegedCommandPayloadMap = {
  'privileged.status.read': { clientVersion: string };
  'privileged.reauth.confirm': { authenticatedAt: string };
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
  | { ok: false; requestId?: string; error: PrivilegedCommandError; message?: string };

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
  return value === 'privileged.status.read';
}

function normalizePayload(
  command: PrivilegedCommandName,
  payload: unknown,
): PrivilegedCommandPayloadMap[PrivilegedCommandName] | null {
  if (!isRecord(payload)) return null;
  if (command === 'privileged.status.read') {
    if (!hasExactKeys(payload, ['clientVersion'])) return null;
    const { clientVersion } = payload;
    if (typeof clientVersion !== 'string' || !clientVersion || clientVersion.length > 100) {
      return null;
    }
    return { clientVersion };
  }

  if (!hasExactKeys(payload, ['authenticatedAt'])) return null;
  const { authenticatedAt } = payload;
  if (!canonicalTimestamp(authenticatedAt)) return null;
  return { authenticatedAt };
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
    (command !== 'privileged.status.read' && command !== 'privileged.reauth.confirm') ||
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
