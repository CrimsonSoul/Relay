import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  RelayPrivilegedAccountRecord,
  RelayPrivilegedStateRecord,
} from '@shared/privilegedAccess';
import { KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION } from '@shared/knowledge';
import { canonicalPrivilegedSigningBytes } from '@shared/privilegedCommands';
import {
  PrivilegedRuntime,
  installPrivilegedE2EControl,
  resolveProductionPairingTarget,
  startKnowledgeSearchIndexerBestEffort,
  type PrivilegedClientTransport,
} from '../privilegedRuntime';

const USERNAME = 'ryan';
const ACCOUNT_ID = 'account-admin';
const DEVICE_ID = 'device-work-laptop';
const PASSWORD = 'Test-access-value-123!';
const START_TIME = new Date('2026-07-15T12:00:00.000Z').getTime();

const account: RelayPrivilegedAccountRecord = {
  id: ACCOUNT_ID,
  username: USERNAME,
  displayName: 'Ryan Bledsoe',
  storedRole: 'administrator',
  active: true,
  mustChangePassword: false,
  credentialVersion: 1,
  revision: 3,
  created: '2026-07-15T11:00:00.000Z',
  updated: '2026-07-15T11:00:00.000Z',
};

const state: RelayPrivilegedStateRecord = {
  id: 'privileged-state',
  key: 'primary',
  ownerAccountId: ACCOUNT_ID,
  publisherAccountId: 'account-publisher',
  assignmentVersion: 1,
  identityMigrationVersion: 1,
  updatedByAccountId: ACCOUNT_ID,
  created: '2026-07-15T11:00:00.000Z',
  updated: '2026-07-15T11:00:00.000Z',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

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
  let authorityChanged:
    | ((snapshot: {
        account: RelayPrivilegedAccountRecord;
        state: RelayPrivilegedStateRecord;
      }) => void)
    | null;
  let stopAuthorityMonitor: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_TIME);
    keyPair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    authClient = {
      authenticate: vi.fn(async () => account),
      reauthenticate: vi.fn(async () => account),
      clear: vi.fn(),
    };
    authorityChanged = null;
    stopAuthorityMonitor = vi.fn(async () => undefined);
    Object.assign(authClient, {
      monitorAuthority: vi.fn(async (_accountId, listener) => {
        authorityChanged = listener.onSnapshot;
        return stopAuthorityMonitor;
      }),
    });
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
    delete process.env.RELAY_E2E_KNOWLEDGE_CHUNK_DELAY_MS;
    delete process.env.RELAY_E2E_PRIVILEGED_FIXTURES;
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
        role: 'admin',
      })),
      ...overrides,
    } as never);
  }

  it('proves an existing paired device with a signed status command during login', async () => {
    const runtime = createClientRuntime();

    const view = await runtime.login({ username: USERNAME, password: PASSWORD });

    expect(view).toMatchObject({ state: 'active', deviceId: DEVICE_ID });
    expect(submitCommand).toHaveBeenCalledOnce();
    const envelope = submitCommand.mock.calls[0]?.[0];
    expect(envelope).toMatchObject({
      accountId: ACCOUNT_ID,
      deviceId: DEVICE_ID,
      command: 'privileged.status.read',
      roleClaim: 'admin',
      displayNameSnapshot: 'Ryan Bledsoe',
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

  it('locks a remote owner promptly when ownership transfers', async () => {
    const runtime = createClientRuntime({
      resolveAccountIdentity: vi.fn(async () => ({ assigned: true, role: 'owner' })),
    });
    await runtime.login({ username: USERNAME, password: PASSWORD });

    authorityChanged?.({
      account,
      state: { ...state, ownerAccountId: 'account-charles', assignmentVersion: 2 },
    });

    expect(runtime.getView()).toMatchObject({ state: 'locked', role: 'owner' });
  });

  it('locks a replaced remote Publisher while leaving an unrelated administrator usable', async () => {
    const publisherAccount = {
      ...account,
      id: 'account-publisher',
      username: 'tristan',
      displayName: 'Tristan Bowles',
      storedRole: 'publisher' as const,
    };
    authClient.authenticate.mockResolvedValueOnce(publisherAccount);
    const publisherRuntime = createClientRuntime({
      resolveAccountIdentity: vi.fn(async () => ({ assigned: true, role: 'publisher' })),
    });
    await publisherRuntime.login({ username: 'tristan', password: PASSWORD });
    authorityChanged?.({
      account: publisherAccount,
      state: { ...state, publisherAccountId: 'account-new-publisher', assignmentVersion: 2 },
    });
    expect(publisherRuntime.getView()).toMatchObject({ state: 'locked', role: 'publisher' });

    const unrelatedAdmin = {
      ...account,
      id: 'account-charles',
      username: 'charles',
      displayName: 'Charles Gibbs',
    };
    authClient.authenticate.mockResolvedValueOnce(unrelatedAdmin);
    const adminRuntime = createClientRuntime();
    await adminRuntime.login({ username: 'charles', password: PASSWORD });
    authorityChanged?.({
      account: unrelatedAdmin,
      state: { ...state, publisherAccountId: 'account-new-publisher', assignmentVersion: 2 },
    });
    expect(adminRuntime.getView()).toMatchObject({ state: 'active', role: 'admin' });
  });

  it('locks after a remote authorization failure proves the projected authority is stale', async () => {
    const runtime = createClientRuntime();
    await runtime.login({ username: USERNAME, password: PASSWORD });
    submitCommand.mockResolvedValueOnce({
      ok: false as const,
      requestId: 'request-1',
      error: 'unauthorized' as const,
    });

    await expect(
      runtime.submitPublicCommand({
        command: 'privileged.status.read',
        payload: { clientVersion: '1' },
        expectedRevision: null,
      }),
    ).resolves.toMatchObject({ ok: false, error: 'unauthorized' });
    expect(runtime.getView().state).toBe('locked');
    expect(stopAuthorityMonitor).toHaveBeenCalledOnce();
  });

  it('does not clear fresh authentication when a login pairing probe is unauthorized', async () => {
    const runtime = createClientRuntime();
    await runtime.login({ username: USERNAME, password: PASSWORD });
    authClient.clear.mockClear();
    submitCommand.mockResolvedValueOnce({
      ok: false as const,
      requestId: 'request-1',
      error: 'unauthorized' as const,
    });

    await expect(runtime.login({ username: USERNAME, password: PASSWORD })).resolves.toMatchObject({
      state: 'pairing-required',
      accountId: ACCOUNT_ID,
    });
    expect(authClient.clear).not.toHaveBeenCalled();
  });

  it('ignores a delayed old monitor after logout and relogin', async () => {
    const runtime = createClientRuntime();
    const firstMonitor = deferred<void>();
    const firstStop = vi.fn(async () => undefined);
    const secondStop = vi.fn(async () => undefined);
    const listeners: Array<{
      onSnapshot(snapshot: {
        account: RelayPrivilegedAccountRecord;
        state: RelayPrivilegedStateRecord;
      }): void;
    }> = [];
    const monitorAuthority = vi
      .fn()
      .mockImplementationOnce(async (_accountId, listener) => {
        listeners.push(listener);
        await firstMonitor.promise;
        return firstStop;
      })
      .mockImplementationOnce(async (_accountId, listener) => {
        listeners.push(listener);
        return secondStop;
      });
    Object.assign(authClient, { monitorAuthority });

    const firstLogin = runtime.login({ username: USERNAME, password: PASSWORD });
    await vi.waitFor(() => expect(monitorAuthority).toHaveBeenCalledOnce());
    await runtime.logout();
    await expect(runtime.login({ username: USERNAME, password: PASSWORD })).resolves.toMatchObject({
      state: 'active',
      accountId: ACCOUNT_ID,
    });

    listeners[0]!.onSnapshot({
      account: { ...account, credentialVersion: 2 },
      state: { ...state, ownerAccountId: 'account-charles', assignmentVersion: 2 },
    });
    expect(runtime.getView()).toMatchObject({ state: 'active', accountId: ACCOUNT_ID });

    firstMonitor.resolve();
    await firstLogin;
    expect(firstStop).toHaveBeenCalledOnce();
    expect(secondStop).not.toHaveBeenCalled();
  });

  it('does not let a cancelled old monitor rejection lock a relogged session', async () => {
    const runtime = createClientRuntime();
    const firstMonitor = deferred<void>();
    const secondStop = vi.fn(async () => undefined);
    const monitorAuthority = vi
      .fn()
      .mockImplementationOnce(async () => {
        await firstMonitor.promise;
        throw Object.assign(new Error('cancelled old monitor'), {
          code: 'invalid-credentials',
        });
      })
      .mockResolvedValueOnce(secondStop);
    Object.assign(authClient, { monitorAuthority });

    const firstLogin = runtime.login({ username: USERNAME, password: PASSWORD });
    await vi.waitFor(() => expect(monitorAuthority).toHaveBeenCalledOnce());
    await runtime.logout();
    await runtime.login({ username: USERNAME, password: PASSWORD });

    firstMonitor.resolve();
    await expect(firstLogin).resolves.toMatchObject({ state: 'active', accountId: ACCOUNT_ID });
    expect(runtime.getView()).toMatchObject({ state: 'active', accountId: ACCOUNT_ID });
    expect(secondStop).not.toHaveBeenCalled();
  });

  it('delays chunk creation only behind the explicit E2E fixture controls', async () => {
    process.env.RELAY_E2E_PRIVILEGED_FIXTURES = '1';
    process.env.RELAY_E2E_KNOWLEDGE_CHUNK_DELAY_MS = '150';
    const createRecord = vi.fn(async () => ({ id: 'chunk-1' }));
    Object.assign(authClient, { createRecord });
    const runtime = createClientRuntime();
    await runtime.login({ username: USERNAME, password: PASSWORD });

    const pending = runtime.createPrivilegedRecord(KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION, {});
    await Promise.resolve();
    expect(createRecord).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);

    await expect(pending).resolves.toEqual({ id: 'chunk-1' });
    expect(createRecord).toHaveBeenCalledOnce();
  });

  it('returns pairing-required without a key, then binds and activates a paired device', async () => {
    deviceStore.findForAccount.mockResolvedValueOnce(null);
    const runtime = createClientRuntime();
    await runtime.login({ username: USERNAME, password: PASSWORD });
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
    await runtime.login({ username: USERNAME, password: PASSWORD });

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
        role: 'admin',
      })),
    } as never);
    await runtime.login({ username: USERNAME, password: PASSWORD });

    await runtime.submitPublicCommand({
      command: 'privileged.status.read',
      payload: { clientVersion: '1' },
      expectedRevision: null,
    });
    const challenge = await runtime.createPairingChallenge('account-publisher');

    expect(processor.processLocal).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ACCOUNT_ID }),
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
          role: 'admin',
        })),
        resolvePairingTarget,
      } as never);
      await runtime.login({ username: USERNAME, password: PASSWORD });

      await expect(runtime.createPairingChallenge(targetAccountId)).rejects.toMatchObject({
        code: 'unauthorized',
      });
      expect(pairingService.createChallenge).not.toHaveBeenCalled();
    },
  );

  it('requires device-management capability before creating a pairing challenge', async () => {
    authClient.authenticate.mockResolvedValueOnce({
      ...account,
      id: 'account-publisher',
      username: 'tristan',
      displayName: 'Tristan Bowles',
      storedRole: 'publisher',
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
        role: 'publisher',
      })),
    } as never);
    await runtime.login({ username: 'tristan', password: PASSWORD });

    await expect(runtime.createPairingChallenge(ACCOUNT_ID)).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(pairingService.createChallenge).not.toHaveBeenCalled();
  });

  it('broadcasts public session changes and disposes isolated privileged resources', async () => {
    const runtime = createClientRuntime();
    const listener = vi.fn();
    const unsubscribe = runtime.onSessionChanged(listener);
    await runtime.login({ username: USERNAME, password: PASSWORD });

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ state: 'active' }));
    unsubscribe();
    await runtime.dispose();

    expect(authClient.clear).toHaveBeenCalled();
    expect(clientTransport.dispose).toHaveBeenCalled();
    expect(runtime.getView().state).toBe('signed-out');
  });

  it('awaits server-owned background resources during privileged runtime disposal', async () => {
    const additionalDisposable = { dispose: vi.fn(async () => undefined) };
    const pairingService = {
      createChallenge: vi.fn(),
      completePairing: vi.fn(),
      dispose: vi.fn(),
    };
    const runtime = new PrivilegedRuntime({
      additionalDisposable,
      authClient,
      commandProcessor: { process: vi.fn(), processLocal: vi.fn() },
      deviceStore,
      hostname: 'RELAY-SERVER',
      mode: 'server',
      pairingService,
      resolveAccountIdentity: vi.fn(async () => ({
        assigned: true,
        role: 'admin',
      })),
    } as never);

    await runtime.dispose();

    expect(additionalDisposable.dispose).toHaveBeenCalledOnce();
    expect(pairingService.dispose).toHaveBeenCalledOnce();
  });
});

describe('resolveProductionPairingTarget', () => {
  const publisherAccount = {
    ...account,
    id: 'account-publisher',
    username: 'tristan',
    displayName: 'Tristan Bowles',
    storedRole: 'publisher' as const,
  };

  it('accepts only an active account holding the current administrator or publisher assignment', async () => {
    const getFirstListItem = vi.fn(async () => ({
      ownerAccountId: ACCOUNT_ID,
      publisherAccountId: 'account-publisher',
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

  it('accepts Charles as an active additional administrator pairing target', async () => {
    const getFirstListItem = vi.fn(async () => ({
      ownerAccountId: ACCOUNT_ID,
      publisherAccountId: null,
    }));
    const getOne = vi.fn(async () => ({
      ...account,
      id: 'account-charles',
      username: 'charles',
      displayName: 'Charles Gibbs',
      storedRole: 'administrator' as const,
      active: true,
    }));
    const pb = {
      collection: vi.fn((name: string) =>
        name === 'relay_privileged_state' ? { getFirstListItem } : { getOne },
      ),
    };

    await expect(resolveProductionPairingTarget(pb as never, 'account-charles')).resolves.toBe(
      true,
    );
  });
});

describe('server Wiki search indexer lifecycle', () => {
  it('starts backfill without awaiting it and contains a rejected startup', async () => {
    const pending = deferred<void>();
    const start = vi.fn(() => pending.promise);

    expect(() => startKnowledgeSearchIndexerBestEffort({ start })).not.toThrow();
    expect(start).toHaveBeenCalledOnce();

    pending.resolve();
    await pending.promise;

    const rejectedStart = vi.fn(async () => {
      throw new Error('search-storage-unavailable');
    });
    expect(() => startKnowledgeSearchIndexerBestEffort({ start: rejectedStart })).not.toThrow();
    await vi.waitFor(() => expect(rejectedStart).toHaveBeenCalledOnce());
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
