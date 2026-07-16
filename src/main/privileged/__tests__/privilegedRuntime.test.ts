import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelayPrivilegedAccountRecord } from '@shared/privilegedAccess';
import { canonicalPrivilegedSigningBytes } from '@shared/privilegedCommands';
import {
  PrivilegedRuntime,
  installPrivilegedE2EControl,
  resolveProductionPairingTarget,
  type PrivilegedClientTransport,
} from '../privilegedRuntime';

const OPERATOR_ID = 'operator-ryan-bledsoe';
const ACCOUNT_ID = 'account-admin';
const DEVICE_ID = 'device-work-laptop';
const PASSWORD = 'Test-access-value-123!';
const START_TIME = new Date('2026-07-15T12:00:00.000Z').getTime();

const account: RelayPrivilegedAccountRecord = {
  id: ACCOUNT_ID,
  operatorId: OPERATOR_ID,
  role: 'admin',
  active: true,
  mustChangePassword: false,
  credentialVersion: 1,
  created: '2026-07-15T11:00:00.000Z',
  updated: '2026-07-15T11:00:00.000Z',
};

describe('PrivilegedRuntime', () => {
  let keyPair: ReturnType<typeof generateKeyPairSync>;
  let authClient: {
    authenticate: ReturnType<typeof vi.fn>;
    reauthenticate: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };
  let deviceStore: {
    create: ReturnType<typeof vi.fn>;
    findForAccount: ReturnType<typeof vi.fn>;
    load: ReturnType<typeof vi.fn>;
    bind: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    removePending: ReturnType<typeof vi.fn>;
    sign: ReturnType<typeof vi.fn>;
  };
  let clientTransport: PrivilegedClientTransport;
  let submitCommand: ReturnType<typeof vi.fn>;
  let completePairing: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_TIME);
    keyPair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    authClient = {
      authenticate: vi.fn(async () => account),
      reauthenticate: vi.fn(async () => account),
      clear: vi.fn(),
    };
    submitCommand = vi.fn(async (envelope) => ({
      ok: true as const,
      requestId: envelope.requestId,
      value: { status: 'ready' },
    }));
    completePairing = vi.fn(async () => ({
      deviceId: DEVICE_ID,
      fingerprint: 'f'.repeat(64),
      pairedAt: new Date(START_TIME).toISOString(),
    }));
    clientTransport = {
      completePairing,
      dispose: vi.fn(),
      submitCommand,
    };
    deviceStore = {
      create: vi.fn(async () => ({
        pendingKeyId: 'pending-key',
        accountId: ACCOUNT_ID,
        label: 'Ryan work laptop',
        publicJwk: keyPair.publicKey.export({ format: 'jwk' }),
        fingerprint: 'f'.repeat(64),
      })),
      findForAccount: vi.fn(async () => ({
        accountId: ACCOUNT_ID,
        deviceId: DEVICE_ID,
        label: 'Ryan work laptop',
        publicJwk: keyPair.publicKey.export({ format: 'jwk' }),
        fingerprint: 'f'.repeat(64),
      })),
      load: vi.fn(),
      bind: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      removePending: vi.fn(async () => undefined),
      sign: vi.fn(async (_accountId, _deviceId, bytes: Uint8Array) =>
        sign('sha256', bytes, keyPair.privateKey).toString('base64url'),
      ),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createClientRuntime(overrides: Record<string, unknown> = {}) {
    return new PrivilegedRuntime({
      authClient,
      clientTransport,
      createId: () => 'request-1',
      deviceStore,
      hostname: 'RYAN-WORK-LAPTOP',
      mode: 'client',
      now: () => START_TIME,
      resolveAccountIdentity: vi.fn(async () => ({
        assigned: true,
        operatorName: 'Ryan Bledsoe',
      })),
      ...overrides,
    } as never);
  }

  it('proves an existing paired device with a signed status command during login', async () => {
    const runtime = createClientRuntime();

    const view = await runtime.login({ operatorId: OPERATOR_ID, password: PASSWORD });

    expect(view).toMatchObject({ state: 'active', deviceId: DEVICE_ID });
    expect(submitCommand).toHaveBeenCalledOnce();
    const envelope = submitCommand.mock.calls[0]?.[0];
    expect(envelope).toMatchObject({
      accountId: ACCOUNT_ID,
      deviceId: DEVICE_ID,
      command: 'privileged.status.read',
      roleClaim: 'admin',
    });
    expect(envelope.payloadHash).toBe(
      createHash('sha256')
        .update(JSON.stringify({ clientVersion: '1' }))
        .digest('hex'),
    );
    expect(
      keyPair.publicKey.asymmetricKeyType === 'ec' &&
        canonicalPrivilegedSigningBytes(envelope).byteLength > 0,
    ).toBe(true);
  });

  it('returns pairing-required without a key, then binds and activates a paired device', async () => {
    deviceStore.findForAccount.mockResolvedValueOnce(null);
    const runtime = createClientRuntime();
    await runtime.login({ operatorId: OPERATOR_ID, password: PASSWORD });
    expect(runtime.getView().state).toBe('pairing-required');

    const result = await runtime.completePairing({
      challengeId: 'challenge-1',
      code: 'ABCD2345',
      deviceLabel: 'Ryan work laptop',
    });

    expect(completePairing).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        authenticatedAccountId: ACCOUNT_ID,
        challengeId: 'challenge-1',
        hostname: 'RYAN-WORK-LAPTOP',
        publicJwk: expect.objectContaining({ kty: 'EC', crv: 'P-256' }),
      }),
    );
    expect(deviceStore.bind).toHaveBeenCalledWith(ACCOUNT_ID, 'pending-key', DEVICE_ID);
    expect(result).toMatchObject({ deviceId: DEVICE_ID });
    expect(runtime.getView()).toMatchObject({ state: 'active', deviceId: DEVICE_ID });
  });

  it('removes an unbound private key when pairing cannot be completed', async () => {
    deviceStore.findForAccount.mockResolvedValueOnce(null);
    completePairing.mockRejectedValueOnce(new Error('offline'));
    const runtime = createClientRuntime();
    await runtime.login({ operatorId: OPERATOR_ID, password: PASSWORD });

    await expect(
      runtime.completePairing({
        challengeId: 'challenge-1',
        code: 'ABCD2345',
        deviceLabel: 'Ryan work laptop',
      }),
    ).rejects.toThrow('offline');

    expect(deviceStore.removePending).toHaveBeenCalledWith(ACCOUNT_ID, 'pending-key');
    expect(deviceStore.bind).not.toHaveBeenCalled();
  });

  it('uses trusted local processing and creates challenges only on the server', async () => {
    const processor = {
      process: vi.fn(),
      processLocal: vi.fn(async () => ({ ok: true as const, requestId: 'local-1', value: {} })),
    };
    const pairingService = {
      createChallenge: vi.fn(async () => ({
        challengeId: 'challenge-1',
        accountId: ACCOUNT_ID,
        code: 'ABCD2345',
        expiresAt: new Date(START_TIME + 600_000).toISOString(),
      })),
      completePairing: vi.fn(),
      dispose: vi.fn(),
    };
    const resolvePairingTarget = vi.fn(async (targetAccountId: string) =>
      ['account-admin', 'account-publisher'].includes(targetAccountId),
    );
    const runtime = new PrivilegedRuntime({
      authClient,
      commandProcessor: processor,
      createId: () => 'local-1',
      deviceStore,
      hostname: 'RELAY-SERVER',
      mode: 'server',
      now: () => START_TIME,
      pairingService,
      resolvePairingTarget,
      resolveAccountIdentity: vi.fn(async () => ({
        assigned: true,
        operatorName: 'Ryan Bledsoe',
      })),
    } as never);
    await runtime.login({ operatorId: OPERATOR_ID, password: PASSWORD });

    await runtime.submitPublicCommand({
      command: 'privileged.status.read',
      payload: { clientVersion: '1' },
      expectedRevision: null,
    });
    const challenge = await runtime.createPairingChallenge('account-publisher');

    expect(processor.processLocal).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ACCOUNT_ID, operatorId: OPERATOR_ID }),
      expect.objectContaining({ isServerMode: true, trustedLocalSender: true }),
    );
    expect(processor.process).not.toHaveBeenCalled();
    expect(pairingService.createChallenge).toHaveBeenCalledWith(
      { accountId: 'account-publisher' },
      { isServerMode: true, trustedLocalSender: true },
    );
    expect(resolvePairingTarget).toHaveBeenCalledWith('account-publisher');
    expect(challenge.code).toBe('ABCD2345');
  });

  it.each(['account-ordinary', 'account-former-publisher'])(
    'rejects an ineligible pairing target %s',
    async (targetAccountId) => {
      const pairingService = {
        createChallenge: vi.fn(),
        completePairing: vi.fn(),
        dispose: vi.fn(),
      };
      const resolvePairingTarget = vi.fn(async () => false);
      const runtime = new PrivilegedRuntime({
        authClient,
        commandProcessor: { process: vi.fn(), processLocal: vi.fn() },
        deviceStore,
        hostname: 'RELAY-SERVER',
        mode: 'server',
        now: () => START_TIME,
        pairingService,
        resolveAccountIdentity: vi.fn(async () => ({
          assigned: true,
          operatorName: 'Ryan Bledsoe',
        })),
        resolvePairingTarget,
      } as never);
      await runtime.login({ operatorId: OPERATOR_ID, password: PASSWORD });

      await expect(runtime.createPairingChallenge(targetAccountId)).rejects.toMatchObject({
        code: 'unauthorized',
      });
      expect(pairingService.createChallenge).not.toHaveBeenCalled();
    },
  );

  it('requires device-management capability before creating a pairing challenge', async () => {
    authClient.authenticate.mockResolvedValueOnce({
      ...account,
      operatorId: 'operator-tristan-bowles',
      role: 'publisher',
    });
    const pairingService = {
      createChallenge: vi.fn(),
      completePairing: vi.fn(),
      dispose: vi.fn(),
    };
    const runtime = new PrivilegedRuntime({
      authClient,
      commandProcessor: { process: vi.fn(), processLocal: vi.fn() },
      deviceStore,
      hostname: 'RELAY-SERVER',
      mode: 'server',
      now: () => START_TIME,
      pairingService,
      resolveAccountIdentity: vi.fn(async () => ({
        assigned: true,
        operatorName: 'Tristan Bowles',
      })),
    } as never);
    await runtime.login({ operatorId: 'operator-tristan-bowles', password: PASSWORD });

    await expect(runtime.createPairingChallenge(ACCOUNT_ID)).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(pairingService.createChallenge).not.toHaveBeenCalled();
  });

  it('broadcasts public session changes and disposes isolated privileged resources', async () => {
    const runtime = createClientRuntime();
    const listener = vi.fn();
    const unsubscribe = runtime.onSessionChanged(listener);
    await runtime.login({ operatorId: OPERATOR_ID, password: PASSWORD });

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ state: 'active' }));
    unsubscribe();
    await runtime.dispose();

    expect(authClient.clear).toHaveBeenCalled();
    expect(clientTransport.dispose).toHaveBeenCalled();
    expect(runtime.getView().state).toBe('signed-out');
  });
});

describe('resolveProductionPairingTarget', () => {
  const publisherAccount = {
    ...account,
    id: 'account-publisher',
    operatorId: 'operator-tristan-bowles',
    role: 'publisher' as const,
  };

  it('accepts only an active account holding the current administrator or publisher assignment', async () => {
    const getFirstListItem = vi.fn(async () => ({
      adminOperatorId: OPERATOR_ID,
      publisherOperatorId: 'operator-tristan-bowles',
    }));
    const getOne = vi.fn(async () => publisherAccount);
    const pb = {
      collection: vi.fn((name: string) =>
        name === 'relay_privileged_state' ? { getFirstListItem } : { getOne },
      ),
    };

    await expect(resolveProductionPairingTarget(pb as never, 'account-publisher')).resolves.toBe(
      true,
    );

    getOne.mockResolvedValueOnce({ ...publisherAccount, active: false });
    await expect(resolveProductionPairingTarget(pb as never, 'account-publisher')).resolves.toBe(
      false,
    );

    getOne.mockRejectedValueOnce(new Error('PocketBase unavailable'));
    await expect(resolveProductionPairingTarget(pb as never, 'account-publisher')).resolves.toBe(
      false,
    );
  });
});

describe('installPrivilegedE2EControl', () => {
  afterEach(() => {
    delete process.env.RELAY_E2E_PRIVILEGED_FIXTURES;
    delete (globalThis as typeof globalThis & { __relayE2EPrivileged?: unknown })
      .__relayE2EPrivileged;
  });

  it('installs a main-process-only inactivity control behind the explicit E2E flag', () => {
    process.env.RELAY_E2E_PRIVILEGED_FIXTURES = '1';
    const runtime = {
      getView: vi.fn(() => ({ state: 'locked' })),
      lock: vi.fn(),
    };

    const cleanup = installPrivilegedE2EControl(() => runtime as never);
    const fixture = (
      globalThis as typeof globalThis & {
        __relayE2EPrivileged?: { simulateInactivity(): { state: string } | null };
      }
    ).__relayE2EPrivileged;

    expect(fixture?.simulateInactivity()).toEqual({ state: 'locked' });
    expect(runtime.lock).toHaveBeenCalledOnce();
    cleanup();
    expect(
      (globalThis as typeof globalThis & { __relayE2EPrivileged?: unknown }).__relayE2EPrivileged,
    ).toBeUndefined();
  });
});
