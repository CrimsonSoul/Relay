import { createHash, createPublicKey, generateKeyPairSync, sign as signBytes } from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_PRIVILEGED_CAPABILITIES,
  type PrivilegedCapability,
  type RelayPrivilegedAccountRecord,
  type RelayPrivilegedDeviceRecord,
  type RelayPrivilegedStateRecord,
} from '@shared/privilegedAccess';
import {
  canonicalPrivilegedSigningBytes,
  canonicalizePrivilegedValue,
  type SignedPrivilegedCommandEnvelope,
} from '@shared/privilegedCommands';
import {
  PrivilegedCommandConflictError,
  PrivilegedCommandProcessor,
  PrivilegedCommandSafeError,
  type PrivilegedCommandClaim,
  type PrivilegedCommandRepository,
  type StoredPrivilegedCommand,
} from '../PrivilegedCommandProcessor';

const NOW = new Date('2026-07-15T12:00:00.000Z').getTime();
const ACCOUNT_ID = 'account-admin';
const DEVICE_ID = 'device-work-laptop';
const PRIVATE_ADDRESS = ['10', '0', '0', '8'].join('.');

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function accountRecord(
  overrides: Partial<RelayPrivilegedAccountRecord> = {},
): RelayPrivilegedAccountRecord {
  return {
    id: ACCOUNT_ID,
    username: 'ryan',
    displayName: 'Ryan Bledsoe',
    storedRole: 'administrator',
    active: true,
    mustChangePassword: false,
    credentialVersion: 1,
    revision: 3,
    created: '2026-07-15T11:00:00.000Z',
    updated: '2026-07-15T11:00:00.000Z',
    ...overrides,
  };
}

function stateRecord(
  overrides: Partial<RelayPrivilegedStateRecord> = {},
): RelayPrivilegedStateRecord {
  return {
    id: 'privileged-state',
    key: 'primary',
    ownerAccountId: 'account-owner',
    publisherAccountId: null,
    assignmentVersion: 3,
    identityMigrationVersion: 1,
    updatedByAccountId: null,
    created: '2026-07-15T11:00:00.000Z',
    updated: '2026-07-15T11:00:00.000Z',
    ...overrides,
  };
}

describe('PrivilegedCommandProcessor', () => {
  let privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];
  let publicJwk: JsonWebKey;
  let device: RelayPrivilegedDeviceRecord;
  let repository: PrivilegedCommandRepository;
  let handler: ReturnType<typeof vi.fn>;
  let logger: { warn: ReturnType<typeof vi.fn> };
  let lastClaim: PrivilegedCommandClaim | null;
  let completed: Array<{
    requestId: string;
    update: Parameters<PrivilegedCommandRepository['completeCommand']>[1];
  }>;

  beforeEach(() => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    privateKey = pair.privateKey;
    publicJwk = pair.publicKey.export({ format: 'jwk' });
    const spki = createPublicKey({ format: 'jwk', key: publicJwk }).export({
      format: 'der',
      type: 'spki',
    });
    device = {
      id: 'device-record',
      accountId: ACCOUNT_ID,
      deviceId: DEVICE_ID,
      hostnameSnapshot: 'RYAN-WORK-LAPTOP',
      label: 'Ryan work laptop',
      publicKey: JSON.stringify(publicJwk),
      fingerprint: sha256(spki),
      state: 'active',
      pairedAt: '2026-07-15T11:00:00.000Z',
      lastUsedAt: null,
      revokedAt: null,
      revokedByAccountId: null,
      revision: 4,
      created: '2026-07-15T11:00:00.000Z',
      updated: '2026-07-15T11:00:00.000Z',
    };
    lastClaim = null;
    completed = [];
    repository = {
      getAccount: vi.fn(async () => accountRecord()),
      getState: vi.fn(async () => stateRecord()),
      getDevice: vi.fn(async () => device),
      claimCommand: vi.fn(async (claim) => {
        lastClaim = claim;
        return { kind: 'created', command: storedCommand(claim) };
      }),
      tryBeginCommand: vi.fn(async () => true),
      completeCommand: vi.fn(async (requestId, update) => {
        completed.push({ requestId, update });
      }),
      getCommand: vi.fn(async () => null),
      consumeReauthenticationProof: vi.fn(async () => true),
    };
    handler = vi.fn(async () => ({ serverVersion: '1.0.0', status: 'ready' }));
    logger = { warn: vi.fn() };
  });

  function envelope(
    overrides: Partial<SignedPrivilegedCommandEnvelope> = {},
  ): SignedPrivilegedCommandEnvelope {
    const payload = overrides.payload ?? { clientVersion: '1.0.0' };
    const unsigned: SignedPrivilegedCommandEnvelope = {
      version: 1,
      requestId: 'request-1',
      accountId: ACCOUNT_ID,
      deviceId: DEVICE_ID,
      roleClaim: 'admin',
      displayNameSnapshot: 'Forged Display Name',
      command: 'privileged.status.read',
      payload,
      payloadHash: sha256(canonicalizePrivilegedValue(payload)),
      expectedRevision: null,
      issuedAt: new Date(NOW - 1_000).toISOString(),
      expiresAt: new Date(NOW + 60_000).toISOString(),
      signature: 'A'.repeat(64),
      ...overrides,
    };
    unsigned.signature = signBytes(
      'sha256',
      canonicalPrivilegedSigningBytes(unsigned),
      privateKey,
    ).toString('base64url');
    return unsigned;
  }

  function createProcessor(
    overrides: Partial<ConstructorParameters<typeof PrivilegedCommandProcessor>[0]> = {},
  ) {
    return new PrivilegedCommandProcessor({
      logger,
      now: () => NOW,
      repository,
      statusHandler: handler,
      ...overrides,
    });
  }

  function storedCommand(
    claim: PrivilegedCommandClaim,
    overrides: Partial<StoredPrivilegedCommand> = {},
  ): StoredPrivilegedCommand {
    return {
      ...claim,
      id: 'command-record',
      state: 'processing',
      result: null,
      safeError: null,
      completedAt: null,
      updated: new Date(NOW).toISOString(),
      ...overrides,
    };
  }

  it('rejects malformed, expired, and payload-hash-mismatched input before repository access', async () => {
    const processor = createProcessor();

    await expect(processor.process({ nope: true })).resolves.toMatchObject({
      ok: false,
      error: 'invalid-request',
    });
    await expect(
      processor.process(envelope({ expiresAt: new Date(NOW).toISOString() })),
    ).resolves.toMatchObject({ ok: false, error: 'expired' });
    await expect(
      processor.process(envelope({ payloadHash: '0'.repeat(64) })),
    ).resolves.toMatchObject({ ok: false, error: 'invalid-request' });

    expect(repository.getAccount).not.toHaveBeenCalled();
    expect(repository.claimCommand).not.toHaveBeenCalled();
  });

  it('checks current account, assignment, and device state before cryptography', async () => {
    vi.mocked(repository.getAccount).mockResolvedValueOnce(accountRecord({ active: false }));
    const processor = createProcessor();
    await expect(processor.process(envelope())).resolves.toMatchObject({
      ok: false,
      error: 'unauthorized',
    });
    vi.mocked(repository.getAccount).mockResolvedValueOnce(
      accountRecord({ storedRole: 'publisher' }),
    );
    await expect(processor.process(envelope())).resolves.toMatchObject({
      ok: false,
      error: 'unauthorized',
    });

    vi.mocked(repository.getDevice).mockResolvedValueOnce({ ...device, state: 'revoked' });
    await expect(processor.process(envelope())).resolves.toMatchObject({
      ok: false,
      error: 'pairing-required',
    });
    expect(repository.claimCommand).not.toHaveBeenCalled();
  });

  it('derives the current role and capabilities instead of trusting claims', async () => {
    const capabilityResolver = vi.fn((): PrivilegedCapability[] => []);
    const processor = createProcessor({ capabilityResolver });

    await expect(processor.process(envelope({ roleClaim: 'publisher' }))).resolves.toMatchObject({
      ok: false,
      error: 'unauthorized',
    });
    expect(capabilityResolver).not.toHaveBeenCalled();

    await expect(processor.process(envelope())).resolves.toMatchObject({
      ok: false,
      error: 'unauthorized',
    });
    expect(capabilityResolver).toHaveBeenCalledWith(
      expect.objectContaining({ account: expect.objectContaining({ id: ACCOUNT_ID }) }),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('authorizes an additional assigned administrator with the full admin role', async () => {
    vi.mocked(repository.getAccount).mockResolvedValueOnce(
      accountRecord({
        id: 'account-charles',
        username: 'charles',
        displayName: 'Charles Gibbs',
      }),
    );
    vi.mocked(repository.getDevice).mockResolvedValueOnce({
      ...device,
      accountId: 'account-charles',
    });

    await expect(
      createProcessor().process(envelope({ accountId: 'account-charles' })),
    ).resolves.toMatchObject({ ok: true });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('requires the command-specific capability for administration commands', async () => {
    const administrationHandler = vi.fn(async () => ({ operators: [] }));
    const processor = createProcessor();
    processor.registerCommand(
      'administration.snapshot.read',
      'settings.manage',
      administrationHandler,
    );
    const currentEnvelope = envelope({
      command: 'administration.snapshot.read',
      payload: {},
    });

    await expect(processor.process(currentEnvelope)).resolves.toMatchObject({ ok: true });
    expect(administrationHandler).toHaveBeenCalledOnce();

    const publisherProcessor = createProcessor({
      capabilityResolver: () => ['privileged.status.read', 'knowledge.manage'],
    });
    publisherProcessor.registerCommand(
      'administration.snapshot.read',
      'settings.manage',
      administrationHandler,
    );
    await expect(
      publisherProcessor.process(
        envelope({
          requestId: 'request-2',
          command: 'administration.snapshot.read',
          payload: {},
        }),
      ),
    ).resolves.toMatchObject({ ok: false, error: 'unauthorized' });
  });

  it('returns bounded revision conflict details from registered handlers', async () => {
    const processor = createProcessor();
    processor.registerCommand('account.display-name.update', 'settings.manage', async () => {
      throw new PrivilegedCommandConflictError(9);
    });

    await expect(
      processor.process(
        envelope({
          command: 'account.display-name.update',
          payload: {
            accountId: 'account-2',
            displayName: 'Morgan Lee',
            expectedRevision: 8,
          },
        }),
      ),
    ).resolves.toEqual({
      ok: false,
      requestId: 'request-1',
      error: 'conflict',
      message: 'Refresh administration data and try again.',
      currentRevision: 9,
      refresh: true,
    });
  });

  it('persists and returns bounded storage admission errors from registered handlers', async () => {
    const processor = createProcessor();
    processor.registerCommand('administration.snapshot.read', 'settings.manage', async () => {
      throw new PrivilegedCommandSafeError('insufficient-storage');
    });

    await expect(
      processor.process(envelope({ command: 'administration.snapshot.read', payload: {} })),
    ).resolves.toEqual({
      ok: false,
      requestId: 'request-1',
      error: 'insufficient-storage',
    });
    expect(repository.completeCommand).toHaveBeenCalledWith(
      'request-1',
      expect.objectContaining({ state: 'failed', safeError: 'insufficient-storage' }),
    );
  });

  it('isolates resumable upload control traffic from the administrative command limiter', async () => {
    const commandLimiter = { tryConsume: vi.fn(() => ({ allowed: false })) };
    const knowledgeUploadCommandLimiter = { tryConsume: vi.fn(() => ({ allowed: true })) };
    const processor = createProcessor({
      commandLimiter: commandLimiter as never,
      knowledgeUploadCommandLimiter: knowledgeUploadCommandLimiter as never,
    });
    const uploadStatus = vi.fn(async () => ({ batch: {}, uploads: [] }));
    processor.registerCommand('knowledge.upload.status', 'knowledge.manage', uploadStatus);

    await expect(
      processor.process(
        envelope({ command: 'knowledge.upload.status', payload: { batchId: 'batch-1' } }),
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(knowledgeUploadCommandLimiter.tryConsume).toHaveBeenCalledWith(DEVICE_ID);
    expect(commandLimiter.tryConsume).not.toHaveBeenCalled();
  });

  it('verifies the registered fingerprint and ECDSA signature before claiming the request', async () => {
    const processor = createProcessor();
    vi.mocked(repository.getDevice).mockResolvedValueOnce({
      ...device,
      fingerprint: '0'.repeat(64),
    });
    await expect(processor.process(envelope())).resolves.toMatchObject({
      ok: false,
      error: 'pairing-required',
    });

    const tampered = envelope();
    tampered.signature = `${tampered.signature.slice(0, -2)}AA`;
    await expect(processor.process(tampered)).resolves.toMatchObject({
      ok: false,
      error: 'invalid-request',
    });
    expect(repository.claimCommand).not.toHaveBeenCalled();
  });

  it('checks expected revision before running an authorized command', async () => {
    const processor = createProcessor();

    await expect(processor.process(envelope({ expectedRevision: 99 }))).resolves.toMatchObject({
      ok: false,
      error: 'conflict',
    });
    expect(repository.claimCommand).not.toHaveBeenCalled();
  });

  it('claims a unique request before side effects and stores only a bounded safe result', async () => {
    const processor = createProcessor();
    const result = await processor.process(envelope());

    expect(result).toEqual({
      ok: true,
      requestId: 'request-1',
      value: { serverVersion: '1.0.0', status: 'ready' },
    });
    expect(lastClaim).toMatchObject({
      requestId: 'request-1',
      accountId: ACCOUNT_ID,
      deviceId: DEVICE_ID,
      operatorId: null,
      displayNameSnapshot: 'Ryan Bledsoe',
      bodyHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      state: 'processing',
    });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ capabilities: ADMIN_PRIVILEGED_CAPABILITIES }),
      { clientVersion: '1.0.0' },
    );
    expect(completed[0]?.update).toEqual({
      state: 'succeeded',
      result: { serverVersion: '1.0.0', status: 'ready' },
      safeError: null,
      completedAt: new Date(NOW).toISOString(),
    });
  });

  it('returns a completed identical request and rejects a conflicting replay', async () => {
    const currentEnvelope = envelope();
    const processor = createProcessor();
    const bodyHash = sha256(canonicalPrivilegedSigningBytes(currentEnvelope));
    vi.mocked(repository.claimCommand).mockResolvedValueOnce({
      kind: 'existing',
      command: storedCommand({ ...(lastClaim as never), bodyHash } as PrivilegedCommandClaim, {
        requestId: currentEnvelope.requestId,
        state: 'succeeded',
        result: { cached: true },
        completedAt: new Date(NOW - 1_000).toISOString(),
      }),
    });

    await expect(processor.process(currentEnvelope)).resolves.toEqual({
      ok: true,
      requestId: 'request-1',
      value: { cached: true },
    });
    expect(handler).not.toHaveBeenCalled();

    vi.mocked(repository.claimCommand).mockResolvedValueOnce({
      kind: 'existing',
      command: storedCommand(
        { ...(lastClaim as never), bodyHash: '0'.repeat(64) } as PrivilegedCommandClaim,
        { requestId: currentEnvelope.requestId },
      ),
    });
    await expect(processor.process(currentEnvelope)).resolves.toMatchObject({
      ok: false,
      error: 'replayed',
    });
  });

  it('recovers a stale in-progress request but leaves a current request alone', async () => {
    const currentEnvelope = envelope();
    const bodyHash = sha256(canonicalPrivilegedSigningBytes(currentEnvelope));
    const processor = createProcessor();
    vi.mocked(repository.claimCommand).mockResolvedValueOnce({
      kind: 'existing',
      command: storedCommand({ ...(lastClaim as never), bodyHash } as PrivilegedCommandClaim, {
        requestId: currentEnvelope.requestId,
        state: 'processing',
        updated: new Date(NOW - 3 * 60_000).toISOString(),
      }),
    });

    await expect(processor.process(currentEnvelope)).resolves.toMatchObject({ ok: true });
    expect(repository.tryBeginCommand).toHaveBeenCalledWith(
      'command-record',
      bodyHash,
      new Date(NOW - 2 * 60_000).toISOString(),
    );

    vi.mocked(repository.claimCommand).mockResolvedValueOnce({
      kind: 'existing',
      command: storedCommand({ ...(lastClaim as never), bodyHash } as PrivilegedCommandClaim, {
        requestId: currentEnvelope.requestId,
        state: 'processing',
        updated: new Date(NOW - 30_000).toISOString(),
      }),
    });
    await expect(processor.process(currentEnvelope)).resolves.toMatchObject({
      ok: false,
      error: 'conflict',
    });
  });

  it('bounds handler results and never logs raw errors, payloads, or signatures', async () => {
    const secret = 'sensitive-handler-detail';
    const currentEnvelope = envelope({ payload: { clientVersion: secret } });
    handler.mockRejectedValueOnce(new Error(secret));
    const processor = createProcessor();

    await expect(processor.process(currentEnvelope)).resolves.toMatchObject({
      ok: false,
      error: 'server-error',
    });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(currentEnvelope.signature);
    expect(completed[0]?.update).toMatchObject({ state: 'failed', safeError: 'server-error' });

    handler.mockResolvedValueOnce({ oversized: 'x'.repeat(20_000) });
    await expect(processor.process(envelope({ requestId: 'request-2' }))).resolves.toMatchObject({
      ok: false,
      error: 'server-error',
    });
  });

  it('supports trusted local-server commands without a device or signature', async () => {
    const processor = createProcessor();
    const command = {
      requestId: 'local-request',
      accountId: ACCOUNT_ID,
      command: 'privileged.status.read' as const,
      payload: { clientVersion: '1.0.0' },
      expectedRevision: null,
    };
    const session = {
      state: 'active' as const,
      accountId: ACCOUNT_ID,
      username: 'ryan',
      displayName: 'Ryan Bledsoe',
      role: 'admin' as const,
      capabilities: [...ADMIN_PRIVILEGED_CAPABILITIES],
      deviceId: null,
      expiresAt: null,
    };

    await expect(
      processor.processLocal(command, { isServerMode: false, trustedLocalSender: true, session }),
    ).resolves.toMatchObject({ ok: false, error: 'unauthorized' });
    await expect(
      processor.processLocal(command, { isServerMode: true, trustedLocalSender: false, session }),
    ).resolves.toMatchObject({ ok: false, error: 'unauthorized' });
    expect(repository.getAccount).not.toHaveBeenCalled();

    await expect(
      processor.processLocal(command, { isServerMode: true, trustedLocalSender: true, session }),
    ).resolves.toMatchObject({ ok: true, requestId: 'local-request' });
    expect(repository.getDevice).not.toHaveBeenCalled();
    expect(lastClaim).toMatchObject({ deviceId: null, signature: null });
    expect(handler).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'electron' }), {
      clientVersion: '1.0.0',
    });

    await expect(
      processor.processLocal(
        { ...command, requestId: 'web-local-request' },
        {
          isServerMode: true,
          trustedLocalSender: true,
          session,
          source: 'web',
          browserFamily: 'Chrome',
          addressLabel: PRIVATE_ADDRESS,
          rateLimitKey: 'web:session-a:account-admin',
        },
      ),
    ).resolves.toMatchObject({ ok: true, requestId: 'web-local-request' });
    expect(handler).toHaveBeenLastCalledWith(
      expect.objectContaining({
        source: 'web',
        browserFamily: 'Chrome',
        addressLabel: PRIVATE_ADDRESS,
      }),
      { clientVersion: '1.0.0' },
    );
  });

  it('creates an internal reauthentication attestation and consumes it once within five minutes', async () => {
    const reauthPayload = { authenticatedAt: new Date(NOW - 1_000).toISOString() };
    const reauthEnvelope = envelope({
      command: 'privileged.reauth.confirm',
      payload: reauthPayload,
      payloadHash: sha256(canonicalizePrivilegedValue(reauthPayload)),
      requestId: 'reauth-proof',
    });
    const processor = createProcessor();

    await expect(processor.process(reauthEnvelope)).resolves.toEqual({
      ok: true,
      requestId: 'reauth-proof',
      value: {
        accountId: ACCOUNT_ID,
        authenticatedAt: reauthPayload.authenticatedAt,
        deviceId: DEVICE_ID,
      },
    });

    vi.mocked(repository.getCommand).mockResolvedValueOnce(
      storedCommand(lastClaim as PrivilegedCommandClaim, {
        command: 'privileged.reauth.confirm',
        state: 'succeeded',
        result: {
          accountId: ACCOUNT_ID,
          authenticatedAt: reauthPayload.authenticatedAt,
          deviceId: DEVICE_ID,
        },
        completedAt: new Date(NOW - 60_000).toISOString(),
      }),
    );
    await expect(
      processor.consumeReauthenticationProof('reauth-proof', {
        accountId: ACCOUNT_ID,
        deviceId: DEVICE_ID,
      }),
    ).resolves.toBe(true);

    vi.mocked(repository.consumeReauthenticationProof).mockResolvedValueOnce(false);
    vi.mocked(repository.getCommand).mockResolvedValueOnce(
      storedCommand(lastClaim as PrivilegedCommandClaim, {
        command: 'privileged.reauth.confirm',
        state: 'succeeded',
        result: {
          accountId: ACCOUNT_ID,
          authenticatedAt: reauthPayload.authenticatedAt,
          deviceId: DEVICE_ID,
        },
        completedAt: new Date(NOW - 60_000).toISOString(),
      }),
    );
    await expect(
      processor.consumeReauthenticationProof('reauth-proof', {
        accountId: ACCOUNT_ID,
        deviceId: DEVICE_ID,
      }),
    ).resolves.toBe(false);
  });
});
