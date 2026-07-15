import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PrivilegedPairingError,
  PrivilegedPairingService,
  type PairingChallengeRecord,
  type PairingDeviceActivation,
  type PrivilegedPairingRepository,
} from '../PrivilegedPairingService';

const ACCOUNT_ID = 'account-admin';
const START_TIME = new Date('2026-07-15T12:00:00.000Z').getTime();
const LOCAL_CONTEXT = { isServerMode: true, trustedLocalSender: true } as const;

function createPublicKeyFixture() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const publicJwk = pair.publicKey.export({ format: 'jwk' });
  const spki = createPublicKey({ format: 'jwk', key: publicJwk }).export({
    format: 'der',
    type: 'spki',
  });
  return {
    publicJwk,
    fingerprint: createHash('sha256').update(spki).digest('hex'),
  };
}

describe('PrivilegedPairingService', () => {
  let nowMs: number;
  let savedChallenges: PairingChallengeRecord[];
  let activations: PairingDeviceActivation[];
  let repository: PrivilegedPairingRepository;
  let randomBytes: ReturnType<typeof vi.fn>;
  let createId: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_TIME);
    nowMs = START_TIME;
    savedChallenges = [];
    activations = [];
    repository = {
      saveChallenge: vi.fn(async (challenge) => {
        savedChallenges.push(challenge);
      }),
      updateChallenge: vi.fn(async () => undefined),
      findDeviceByFingerprint: vi.fn(async () => null),
      activateDevice: vi.fn(async (activation) => {
        activations.push(activation);
        return {
          deviceId: activation.deviceId,
          fingerprint: activation.fingerprint,
          pairedAt: activation.pairedAt,
        };
      }),
    };
    let randomCall = 0;
    randomBytes = vi.fn((size: number) => {
      randomCall += 1;
      return Buffer.alloc(size, randomCall * 7);
    });
    let id = 0;
    createId = vi.fn(() => `generated-id-${++id}`);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createService() {
    return new PrivilegedPairingService({
      createId,
      now: () => nowMs,
      randomBytes,
      repository,
    });
  }

  async function createChallenge(service = createService()) {
    const challenge = await service.createChallenge({ accountId: ACCOUNT_ID }, LOCAL_CONTEXT);
    return { challenge, service };
  }

  function completionInput(
    challenge: { challengeId: string; code: string },
    overrides: Record<string, unknown> = {},
  ) {
    const key = createPublicKeyFixture();
    return {
      accountId: ACCOUNT_ID,
      authenticatedAccountId: ACCOUNT_ID,
      challengeId: challenge.challengeId,
      code: challenge.code,
      deviceLabel: 'Ryan work laptop',
      fingerprint: key.fingerprint,
      hostname: 'RYAN-WORK-LAPTOP',
      publicJwk: key.publicJwk,
      ...overrides,
    };
  }

  it('creates a local-server-only 10-minute challenge without persisting raw secrets', async () => {
    const service = createService();

    await expect(
      service.createChallenge(
        { accountId: ACCOUNT_ID },
        { isServerMode: false, trustedLocalSender: true },
      ),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(
      service.createChallenge(
        { accountId: ACCOUNT_ID },
        { isServerMode: true, trustedLocalSender: false },
      ),
    ).rejects.toMatchObject({ code: 'unauthorized' });

    const challenge = await service.createChallenge({ accountId: ACCOUNT_ID }, LOCAL_CONTEXT);

    expect(challenge).toEqual({
      challengeId: 'generated-id-1',
      accountId: ACCOUNT_ID,
      code: expect.stringMatching(/^[A-HJ-NP-Z2-9]{8}$/),
      expiresAt: new Date(START_TIME + 10 * 60 * 1_000).toISOString(),
    });
    expect(randomBytes.mock.calls.some(([size]) => size === 32)).toBe(true);
    expect(savedChallenges).toHaveLength(1);
    expect(savedChallenges[0]).toMatchObject({
      challengeId: challenge.challengeId,
      accountId: ACCOUNT_ID,
      secretHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      status: 'pending',
    });
    const persisted = JSON.stringify(savedChallenges[0]);
    expect(persisted).not.toContain(challenge.code);
    expect(savedChallenges[0]).not.toHaveProperty('code');
    expect(savedChallenges[0]).not.toHaveProperty('secret');
  });

  it('expires the challenge in memory and server state after 10 minutes', async () => {
    const { challenge, service } = await createChallenge();
    nowMs += 10 * 60 * 1_000;
    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000);

    await expect(service.completePairing(completionInput(challenge))).rejects.toMatchObject({
      code: 'expired',
    });
    expect(repository.updateChallenge).toHaveBeenCalledWith(challenge.challengeId, {
      status: 'expired',
    });
  });

  it('binds the authenticated account and activates a validated P-256 device', async () => {
    const { challenge, service } = await createChallenge();
    const input = completionInput(challenge);

    await expect(
      service.completePairing({ ...input, authenticatedAccountId: 'different-account' }),
    ).rejects.toMatchObject({ code: 'unauthorized' });

    const result = await service.completePairing(input);

    expect(result).toEqual({
      deviceId: 'generated-id-2',
      fingerprint: input.fingerprint,
      pairedAt: new Date(START_TIME).toISOString(),
    });
    expect(activations[0]).toMatchObject({
      accountId: ACCOUNT_ID,
      deviceId: 'generated-id-2',
      fingerprint: input.fingerprint,
      hostnameSnapshot: 'RYAN-WORK-LAPTOP',
      label: 'Ryan work laptop',
      publicKey: JSON.stringify(input.publicJwk),
      state: 'active',
    });
  });

  it('is single-use but returns the same activation for an idempotent fingerprint retry', async () => {
    const { challenge, service } = await createChallenge();
    const input = completionInput(challenge);

    const first = await service.completePairing(input);
    for (let retry = 0; retry < 6; retry += 1) {
      await expect(service.completePairing(input)).resolves.toEqual(first);
    }
    expect(repository.activateDevice).toHaveBeenCalledOnce();

    const otherKey = createPublicKeyFixture();
    await expect(
      service.completePairing({
        ...input,
        fingerprint: otherKey.fingerprint,
        publicJwk: otherKey.publicJwk,
      }),
    ).rejects.toMatchObject({ code: 'used' });
  });

  it('coalesces concurrent idempotent retries before activating the device', async () => {
    const { challenge, service } = await createChallenge();
    const input = completionInput(challenge);

    const [first, second] = await Promise.all([
      service.completePairing(input),
      service.completePairing(input),
    ]);

    expect(second).toEqual(first);
    expect(repository.activateDevice).toHaveBeenCalledOnce();
  });

  it('rejects invalid public keys, fingerprint claims, hostnames, and labels', async () => {
    const cases = [
      { publicJwk: { kty: 'RSA' } },
      { publicJwk: { ...createPublicKeyFixture().publicJwk, d: 'private-material' } },
      { fingerprint: '0'.repeat(64) },
      { hostname: 'h'.repeat(256) },
      { deviceLabel: 'd'.repeat(81) },
    ];

    for (const invalid of cases) {
      const { challenge, service } = await createChallenge();
      await expect(
        service.completePairing(completionInput(challenge, invalid)),
      ).rejects.toMatchObject({ code: 'invalid-input' });
    }
  });

  it('rejects a fingerprint that is already paired', async () => {
    const { challenge, service } = await createChallenge();
    const input = completionInput(challenge);
    vi.mocked(repository.findDeviceByFingerprint).mockResolvedValueOnce({ deviceId: 'existing' });

    await expect(service.completePairing(input)).rejects.toMatchObject({ code: 'conflict' });
    expect(repository.activateDevice).not.toHaveBeenCalled();
  });

  it('locks a challenge after five failed human-code attempts', async () => {
    const { challenge, service } = await createChallenge();
    const input = completionInput(challenge);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(service.completePairing({ ...input, code: 'WRNG2222' })).rejects.toMatchObject({
        code: 'invalid-code',
      });
    }
    await expect(service.completePairing(input)).rejects.toBeInstanceOf(PrivilegedPairingError);
    await expect(service.completePairing(input)).rejects.toMatchObject({ code: 'locked' });
    expect(repository.updateChallenge).toHaveBeenCalledWith(challenge.challengeId, {
      attempts: 5,
      status: 'locked',
    });
    expect(repository.activateDevice).not.toHaveBeenCalled();
  });
});
