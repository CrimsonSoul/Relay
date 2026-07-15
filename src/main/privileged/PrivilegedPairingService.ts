import {
  createHash,
  createPublicKey,
  randomBytes as nodeRandomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';
import {
  MAX_PRIVILEGED_DEVICE_LABEL_LENGTH,
  MAX_PRIVILEGED_HOSTNAME_LENGTH,
  type PrivilegedPairingChallengeView,
} from '@shared/privilegedAccess';
import { createPrivilegedRateLimiters, type KeyedRateLimiter } from '../rateLimiter';

export const PRIVILEGED_PAIRING_CHALLENGE_MS = 10 * 60 * 1_000;
const PAIRING_CODE_LENGTH = 8;
const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_PAIRING_ATTEMPTS = 5;
const MAX_IDENTIFIER_LENGTH = 200;

export type PrivilegedPairingErrorCode =
  | 'conflict'
  | 'expired'
  | 'invalid-code'
  | 'invalid-input'
  | 'locked'
  | 'server-error'
  | 'unauthorized'
  | 'used';

export class PrivilegedPairingError extends Error {
  constructor(readonly code: PrivilegedPairingErrorCode) {
    super(pairingErrorMessage(code));
    this.name = 'PrivilegedPairingError';
  }
}

export type PairingChallengeStatus = 'pending' | 'consuming' | 'completed' | 'expired' | 'locked';

export type PairingChallengeRecord = {
  challengeId: string;
  accountId: string;
  secretHash: string;
  expiresAt: string;
  attempts: number;
  status: PairingChallengeStatus;
};

export type PairingChallengePatch = Partial<Pick<PairingChallengeRecord, 'attempts' | 'status'>> & {
  fingerprint?: string;
  deviceId?: string;
};

export type PairingDeviceActivation = {
  challengeId: string;
  secretHash: string;
  accountId: string;
  deviceId: string;
  hostnameSnapshot: string;
  label: string;
  publicKey: string;
  fingerprint: string;
  state: 'active';
  pairedAt: string;
  lastUsedAt: null;
  revokedAt: null;
  revokedByOperatorId: null;
  revision: 1;
};

export type PairingCompletion = {
  deviceId: string;
  fingerprint: string;
  pairedAt: string;
};

export interface PrivilegedPairingRepository {
  saveChallenge(challenge: PairingChallengeRecord): Promise<void>;
  updateChallenge(challengeId: string, patch: PairingChallengePatch): Promise<void>;
  findDeviceByFingerprint(fingerprint: string): Promise<{ deviceId: string } | null>;
  activateDevice(activation: PairingDeviceActivation): Promise<PairingCompletion>;
}

export type PairingCreationContext = {
  isServerMode: boolean;
  trustedLocalSender: boolean;
};

export type PairingCompletionInput = {
  challengeId: string;
  accountId: string;
  authenticatedAccountId: string;
  code: string;
  publicJwk: unknown;
  fingerprint: string;
  hostname: string;
  deviceLabel: string;
};

type PrivilegedPairingServiceOptions = {
  repository: PrivilegedPairingRepository;
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
  createId?: () => string;
  attemptLimiter?: KeyedRateLimiter;
};

type ChallengeState = {
  record: PairingChallengeRecord;
  code: string;
  secret: Buffer;
  timer: ReturnType<typeof setTimeout>;
  fingerprint: string | null;
  completion: Promise<PairingCompletion> | null;
  result: PairingCompletion | null;
};

type ValidatedDeviceInput = {
  publicJwk: JsonWebKey;
  publicKey: string;
  fingerprint: string;
  hostname: string;
  deviceLabel: string;
};

function pairingErrorMessage(code: PrivilegedPairingErrorCode): string {
  switch (code) {
    case 'conflict':
      return 'This device is already paired.';
    case 'expired':
      return 'The pairing challenge has expired.';
    case 'invalid-code':
      return 'The pairing code is invalid.';
    case 'invalid-input':
      return 'The pairing request is invalid.';
    case 'locked':
      return 'The pairing challenge is locked.';
    case 'server-error':
      return 'Pairing could not be completed.';
    case 'unauthorized':
      return 'Pairing is not authorized.';
    case 'used':
      return 'The pairing challenge has already been used.';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedIdentifier(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_IDENTIFIER_LENGTH ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)
  ) {
    throw new PrivilegedPairingError('invalid-input');
  }
  return normalized;
}

function boundedDisplayValue(value: string, max: number): string {
  const normalized = value.trim();
  const hasControlCharacter = Array.from(normalized).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (normalized.length === 0 || normalized.length > max || hasControlCharacter) {
    throw new PrivilegedPairingError('invalid-input');
  }
  return normalized;
}

function publicP256Jwk(value: unknown): JsonWebKey {
  if (!isRecord(value)) throw new PrivilegedPairingError('invalid-input');
  const keys = Object.keys(value);
  const expectedKeys = new Set(['crv', 'kty', 'x', 'y']);
  if (
    keys.length !== expectedKeys.size ||
    !keys.every((key) => expectedKeys.has(key)) ||
    value.kty !== 'EC' ||
    value.crv !== 'P-256' ||
    typeof value.x !== 'string' ||
    value.x.length === 0 ||
    typeof value.y !== 'string' ||
    value.y.length === 0
  ) {
    throw new PrivilegedPairingError('invalid-input');
  }
  return { crv: 'P-256', kty: 'EC', x: value.x, y: value.y };
}

function fingerprintOf(publicJwk: JsonWebKey): string {
  try {
    const publicKey = createPublicKey({ format: 'jwk', key: publicJwk });
    const spki = publicKey.export({ format: 'der', type: 'spki' });
    return createHash('sha256').update(spki).digest('hex');
  } catch {
    throw new PrivilegedPairingError('invalid-input');
  }
}

function validateDeviceInput(input: PairingCompletionInput): ValidatedDeviceInput {
  const publicJwk = publicP256Jwk(input.publicJwk);
  const fingerprint = fingerprintOf(publicJwk);
  if (input.fingerprint !== fingerprint) throw new PrivilegedPairingError('invalid-input');
  const hostname = boundedDisplayValue(input.hostname, MAX_PRIVILEGED_HOSTNAME_LENGTH);
  const deviceLabel = boundedDisplayValue(input.deviceLabel, MAX_PRIVILEGED_DEVICE_LABEL_LENGTH);
  return {
    publicJwk,
    publicKey: JSON.stringify(input.publicJwk),
    fingerprint,
    hostname,
    deviceLabel,
  };
}

function codeMatches(expected: string, received: string): boolean {
  if (!new RegExp(`^[${PAIRING_CODE_ALPHABET}]{${PAIRING_CODE_LENGTH}}$`).test(received)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

export class PrivilegedPairingService {
  private readonly repository: PrivilegedPairingRepository;
  private readonly now: () => number;
  private readonly randomBytes: (size: number) => Buffer;
  private readonly createId: () => string;
  private readonly attemptLimiter: KeyedRateLimiter;
  private readonly challenges = new Map<string, ChallengeState>();

  constructor(options: PrivilegedPairingServiceOptions) {
    this.repository = options.repository;
    this.now = options.now ?? Date.now;
    this.randomBytes = options.randomBytes ?? nodeRandomBytes;
    this.createId = options.createId ?? randomUUID;
    this.attemptLimiter =
      options.attemptLimiter ?? createPrivilegedRateLimiters().pairingVerification;
  }

  async createChallenge(
    input: { accountId: string },
    context: PairingCreationContext,
  ): Promise<PrivilegedPairingChallengeView> {
    if (!context.isServerMode || !context.trustedLocalSender) {
      throw new PrivilegedPairingError('unauthorized');
    }
    const accountId = boundedIdentifier(input.accountId);
    const challengeId = this.createId();
    const code = this.generateCode();
    const secret = this.randomBytes(32);
    if (secret.byteLength !== 32) throw new PrivilegedPairingError('server-error');
    const expiresAtMs = this.now() + PRIVILEGED_PAIRING_CHALLENGE_MS;
    const record: PairingChallengeRecord = {
      challengeId,
      accountId,
      secretHash: this.hashSecret(secret, challengeId, code),
      expiresAt: new Date(expiresAtMs).toISOString(),
      attempts: 0,
      status: 'pending',
    };
    await this.repository.saveChallenge(record);
    const timer = setTimeout(() => {
      void this.expireChallenge(challengeId).catch(() => undefined);
    }, PRIVILEGED_PAIRING_CHALLENGE_MS);
    timer.unref?.();
    this.challenges.set(challengeId, {
      record,
      code,
      secret,
      timer,
      fingerprint: null,
      completion: null,
      result: null,
    });
    return { challengeId, accountId, code, expiresAt: record.expiresAt };
  }

  async completePairing(input: PairingCompletionInput): Promise<PairingCompletion> {
    const challenge = await this.requirePendingChallenge(input);
    await this.verifyChallengeCode(challenge, input.code);
    const device = validateDeviceInput(input);
    const priorCompletion = this.getPriorCompletion(challenge, device.fingerprint);
    if (priorCompletion) return priorCompletion;

    const existing = await this.repository.findDeviceByFingerprint(device.fingerprint);
    if (existing) throw new PrivilegedPairingError('conflict');

    // The repository check yields, so another matching retry may have claimed the
    // challenge while this call was waiting. Recheck before any activation side effect.
    const concurrentCompletion = this.getPriorCompletion(challenge, device.fingerprint);
    if (concurrentCompletion) return concurrentCompletion;

    challenge.record.status = 'consuming';
    challenge.fingerprint = device.fingerprint;
    const completion = this.activateChallenge(challenge, device);
    challenge.completion = completion;
    return completion;
  }

  private async requirePendingChallenge(input: PairingCompletionInput): Promise<ChallengeState> {
    const challengeId = boundedIdentifier(input.challengeId);
    const accountId = boundedIdentifier(input.accountId);
    const authenticatedAccountId = boundedIdentifier(input.authenticatedAccountId);
    const challenge = this.challenges.get(challengeId);
    if (!challenge) throw new PrivilegedPairingError('expired');
    if (this.now() >= Date.parse(challenge.record.expiresAt)) {
      await this.expireChallenge(challengeId);
      throw new PrivilegedPairingError('expired');
    }
    if (accountId !== authenticatedAccountId || accountId !== challenge.record.accountId) {
      throw new PrivilegedPairingError('unauthorized');
    }
    if (challenge.record.status === 'locked') throw new PrivilegedPairingError('locked');
    return challenge;
  }

  private async verifyChallengeCode(challenge: ChallengeState, code: string): Promise<void> {
    const { challengeId } = challenge.record;
    if (challenge.record.status === 'completed' || challenge.record.status === 'consuming') {
      if (!codeMatches(challenge.code, code)) throw new PrivilegedPairingError('invalid-code');
      return;
    }
    if (!this.attemptLimiter.tryConsume(challengeId).allowed) {
      challenge.record.status = 'locked';
      await this.repository.updateChallenge(challengeId, { status: 'locked' });
      throw new PrivilegedPairingError('locked');
    }
    if (!codeMatches(challenge.code, code)) {
      await this.recordFailedAttempt(challenge);
      throw new PrivilegedPairingError('invalid-code');
    }
  }

  private getPriorCompletion(
    challenge: ChallengeState,
    fingerprint: string,
  ): PairingCompletion | Promise<PairingCompletion> | null {
    if (challenge.record.status === 'pending') return null;
    if (challenge.fingerprint !== fingerprint) throw new PrivilegedPairingError('used');
    if (challenge.record.status === 'completed' && challenge.result) return challenge.result;
    if (challenge.record.status === 'consuming' && challenge.completion) {
      return challenge.completion;
    }
    throw new PrivilegedPairingError('used');
  }

  dispose(): void {
    for (const challenge of this.challenges.values()) {
      clearTimeout(challenge.timer);
      challenge.secret.fill(0);
    }
    this.challenges.clear();
  }

  private async activateChallenge(
    challenge: ChallengeState,
    device: ValidatedDeviceInput,
  ): Promise<PairingCompletion> {
    const { record } = challenge;
    const deviceId = this.createId();
    const pairedAt = new Date(this.now()).toISOString();
    try {
      await this.repository.updateChallenge(record.challengeId, {
        fingerprint: device.fingerprint,
        status: 'consuming',
      });
      const result = await this.repository.activateDevice({
        challengeId: record.challengeId,
        secretHash: record.secretHash,
        accountId: record.accountId,
        deviceId,
        hostnameSnapshot: device.hostname,
        label: device.deviceLabel,
        publicKey: device.publicKey,
        fingerprint: device.fingerprint,
        state: 'active',
        pairedAt,
        lastUsedAt: null,
        revokedAt: null,
        revokedByOperatorId: null,
        revision: 1,
      });
      challenge.record.status = 'completed';
      challenge.result = result;
      await this.repository.updateChallenge(record.challengeId, {
        deviceId: result.deviceId,
        fingerprint: result.fingerprint,
        status: 'completed',
      });
      return result;
    } catch (error) {
      if (error instanceof PrivilegedPairingError) throw error;
      challenge.record.status = 'locked';
      await this.repository
        .updateChallenge(record.challengeId, { status: 'locked' })
        .catch(() => undefined);
      throw new PrivilegedPairingError('server-error');
    }
  }

  private async recordFailedAttempt(challenge: ChallengeState): Promise<void> {
    challenge.record.attempts += 1;
    if (challenge.record.attempts >= MAX_PAIRING_ATTEMPTS) {
      challenge.record.status = 'locked';
    }
    await this.repository.updateChallenge(challenge.record.challengeId, {
      attempts: challenge.record.attempts,
      status: challenge.record.status,
    });
  }

  private async expireChallenge(challengeId: string): Promise<void> {
    const challenge = this.challenges.get(challengeId);
    if (!challenge) return;
    clearTimeout(challenge.timer);
    challenge.secret.fill(0);
    this.challenges.delete(challengeId);
    this.attemptLimiter.clear(challengeId);
    if (challenge.record.status !== 'completed') {
      challenge.record.status = 'expired';
      await this.repository.updateChallenge(challengeId, { status: 'expired' });
    }
  }

  private generateCode(): string {
    const bytes = this.randomBytes(PAIRING_CODE_LENGTH);
    if (bytes.byteLength !== PAIRING_CODE_LENGTH) {
      throw new PrivilegedPairingError('server-error');
    }
    return Array.from(
      bytes,
      (byte) => PAIRING_CODE_ALPHABET[byte % PAIRING_CODE_ALPHABET.length] as string,
    ).join('');
  }

  private hashSecret(secret: Buffer, challengeId: string, code: string): string {
    return createHash('sha256')
      .update(secret)
      .update('\0')
      .update(challengeId)
      .update('\0')
      .update(code)
      .digest('hex');
  }
}
