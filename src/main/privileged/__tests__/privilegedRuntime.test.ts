import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  RelayPrivilegedAccountRecord,
  RelayPrivilegedStateRecord,
} from '@shared/privilegedAccess';
import { KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION } from '@shared/knowledge';
import { canonicalPrivilegedSigningBytes } from '@shared/privilegedCommands';
import { KnowledgeSearchIndexer } from '../../knowledge/KnowledgeSearchIndexer';
import { KnowledgeUploadCoordinator } from '../../knowledge/KnowledgeUploadCoordinator';
import { loggers } from '../../logger';
import { PrivilegedServerQueue } from '../PrivilegedPocketBaseTransport';
import {
  PrivilegedRuntime,
  createProductionPrivilegedRuntime,
  resolveProductionPairingTarget,
  startKnowledgeSearchIndexerBestEffort,
  type PrivilegedClientTransport,
} from '../privilegedRuntime';

const productionRuntimeMocks = vi.hoisted(() => ({
  knowledgeCommandOptions: null as { searchIndexer?: unknown } | null,
}));

vi.mock('../../knowledge/registerKnowledgeManagementCommands', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../knowledge/registerKnowledgeManagementCommands')>();
  return {
    ...actual,
    registerKnowledgeManagementCommands: vi.fn((options: { searchIndexer?: unknown }) => {
      productionRuntimeMocks.knowledgeCommandOptions = options;
      return actual.registerKnowledgeManagementCommands(options as never);
    }),
  };
});

const USERNAME = 'ryan';
const ACCOUNT_ID = 'account-admin';
const DEVICE_ID = 'device-work-laptop';
// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Deliberate synthetic credential fixture exercises the privileged runtime boundary.
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

const replacementAccount: RelayPrivilegedAccountRecord = {
  ...account,
  id: 'account-charles',
  username: 'charles',
  displayName: 'Charles Gibbs',
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

  function replacementDevice() {
    return {
      accountId: replacementAccount.id,
      deviceId: 'device-charles-laptop',
      label: 'Charles work laptop',
      publicJwk: keyPair.publicKey.export({ format: 'jwk' }),
      fingerprint: 'c'.repeat(64),
    };
  }

  function prepareReplacementLogin(): void {
    authClient.authenticate.mockResolvedValueOnce(replacementAccount);
    deviceStore.findForAccount.mockResolvedValueOnce(replacementDevice());
  }

  function loginReplacement(runtime: ReturnType<typeof createClientRuntime>) {
    prepareReplacementLogin();
    return runtime.login({ username: replacementAccount.username, password: PASSWORD });
  }

  function loginUnpairedReplacement(runtime: ReturnType<typeof createClientRuntime>) {
    authClient.authenticate.mockResolvedValueOnce(replacementAccount);
    deviceStore.findForAccount.mockResolvedValueOnce(null);
    return runtime.login({ username: replacementAccount.username, password: PASSWORD });
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

  it('signs out a remote owner promptly when ownership transfers', async () => {
    const runtime = createClientRuntime({
      resolveAccountIdentity: vi.fn(async () => ({ assigned: true, role: 'owner' })),
    });
    await runtime.login({ username: USERNAME, password: PASSWORD });

    authorityChanged?.({
      account,
      state: { ...state, ownerAccountId: 'account-charles', assignmentVersion: 2 },
    });

    expect(runtime.getView()).toMatchObject({ state: 'signed-out', role: null });
  });

  it('signs out a replaced remote Publisher while leaving an unrelated administrator usable', async () => {
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
    expect(publisherRuntime.getView()).toMatchObject({ state: 'signed-out', role: null });

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

  it('signs out after a remote authorization failure proves the projected authority is stale', async () => {
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
    expect(runtime.getView().state).toBe('signed-out');
    expect(stopAuthorityMonitor).toHaveBeenCalledOnce();
  });

  it('does not submit an old account command after its signing wait crosses into another session', async () => {
    const runtime = createClientRuntime();
    await runtime.login({ username: USERNAME, password: PASSWORD });
    submitCommand.mockClear();
    deviceStore.sign.mockClear();
    deviceStore.findForAccount.mockClear();
    authClient.clear.mockClear();

    const staleSignature = deferred<string>();
    deviceStore.sign.mockImplementationOnce(async () => staleSignature.promise);
    const staleCommand = runtime.submitPublicCommand({
      command: 'privileged.status.read',
      payload: { clientVersion: '1' },
      expectedRevision: null,
    });
    await vi.waitFor(() => expect(deviceStore.sign).toHaveBeenCalledOnce());

    const replacementDeviceLookup = deferred<ReturnType<typeof replacementDevice>>();
    authClient.authenticate.mockResolvedValueOnce(replacementAccount);
    deviceStore.findForAccount.mockImplementationOnce(async () => replacementDeviceLookup.promise);
    const replacementLogin = runtime.login({
      username: replacementAccount.username,
      password: PASSWORD,
    });
    await vi.waitFor(() => expect(deviceStore.findForAccount).toHaveBeenCalledOnce());
    staleSignature.resolve('stale-session-signature');

    await expect(staleCommand).resolves.toMatchObject({ ok: false, error: 'unauthorized' });
    expect(submitCommand).not.toHaveBeenCalled();

    replacementDeviceLookup.resolve(replacementDevice());
    await replacementLogin;
    expect(submitCommand).toHaveBeenCalledOnce();
    expect(submitCommand.mock.calls[0]?.[0]).toMatchObject({
      accountId: replacementAccount.id,
      deviceId: 'device-charles-laptop',
    });
    expect(runtime.getView()).toMatchObject({
      state: 'active',
      accountId: replacementAccount.id,
      deviceId: 'device-charles-laptop',
    });
    expect(authClient.clear).not.toHaveBeenCalled();
  });

  it('rejects a command started while another account login is replacing shared authentication', async () => {
    const runtime = createClientRuntime();
    await runtime.login({ username: USERNAME, password: PASSWORD });
    submitCommand.mockClear();
    deviceStore.sign.mockClear();
    deviceStore.findForAccount.mockClear();

    const replacementDeviceLookup = deferred<ReturnType<typeof replacementDevice>>();
    authClient.authenticate.mockResolvedValueOnce(replacementAccount);
    deviceStore.findForAccount.mockImplementationOnce(async () => replacementDeviceLookup.promise);
    const replacementLogin = runtime.login({
      username: replacementAccount.username,
      password: PASSWORD,
    });
    await vi.waitFor(() => expect(deviceStore.findForAccount).toHaveBeenCalledOnce());

    await expect(
      runtime.submitPublicCommand({
        command: 'privileged.status.read',
        payload: { clientVersion: '1' },
        expectedRevision: null,
      }),
    ).resolves.toMatchObject({ ok: false, error: 'unauthorized' });
    expect(deviceStore.sign).not.toHaveBeenCalled();
    expect(submitCommand).not.toHaveBeenCalled();

    replacementDeviceLookup.resolve(replacementDevice());
    await replacementLogin;
    expect(deviceStore.sign).toHaveBeenCalledOnce();
    expect(submitCommand).toHaveBeenCalledOnce();
    expect(runtime.getView()).toMatchObject({
      state: 'active',
      accountId: replacementAccount.id,
      deviceId: 'device-charles-laptop',
    });
  });

  it('rejects a second authentication transition while a login is still pending', async () => {
    const runtime = createClientRuntime();
    await runtime.login({ username: USERNAME, password: PASSWORD });
    authClient.authenticate.mockClear();
    authClient.reauthenticate.mockClear();
    deviceStore.findForAccount.mockClear();

    const replacementDeviceLookup = deferred<ReturnType<typeof replacementDevice>>();
    authClient.authenticate.mockResolvedValueOnce(replacementAccount);
    deviceStore.findForAccount.mockImplementationOnce(async () => replacementDeviceLookup.promise);
    const replacementLogin = runtime.login({
      username: replacementAccount.username,
      password: PASSWORD,
    });
    await vi.waitFor(() => expect(deviceStore.findForAccount).toHaveBeenCalledOnce());

    await expect(runtime.reauthenticate(PASSWORD)).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(authClient.authenticate).toHaveBeenCalledOnce();
    expect(authClient.reauthenticate).not.toHaveBeenCalled();

    replacementDeviceLookup.resolve(replacementDevice());
    await replacementLogin;
    expect(runtime.getView()).toMatchObject({
      state: 'active',
      accountId: replacementAccount.id,
      deviceId: 'device-charles-laptop',
    });
  });

  it('allows a fresh login after logout while the cancelled authentication is still pending', async () => {
    const runtime = createClientRuntime();
    await runtime.login({ username: USERNAME, password: PASSWORD });
    const listener = vi.fn();
    runtime.onSessionChanged(listener);
    authClient.authenticate.mockClear();

    const replacementAuthentication = deferred<RelayPrivilegedAccountRecord>();
    authClient.authenticate
      .mockImplementationOnce(async () => replacementAuthentication.promise)
      .mockResolvedValueOnce(account);
    const replacementLogin = runtime.login({
      username: replacementAccount.username,
      password: PASSWORD,
    });
    const rejection = replacementLogin.catch((error: unknown) => error);
    await vi.waitFor(() => expect(authClient.authenticate).toHaveBeenCalledOnce());

    await runtime.logout();
    await expect(runtime.login({ username: USERNAME, password: PASSWORD })).resolves.toMatchObject({
      state: 'active',
      accountId: ACCOUNT_ID,
      deviceId: DEVICE_ID,
    });

    replacementAuthentication.resolve(replacementAccount);
    await expect(rejection).resolves.toMatchObject({ code: 'unauthorized' });

    expect(runtime.getView()).toMatchObject({
      state: 'active',
      accountId: ACCOUNT_ID,
      deviceId: DEVICE_ID,
    });
    expect(
      listener.mock.calls.some(
        ([view]) => view.state === 'active' && view.accountId === replacementAccount.id,
      ),
    ).toBe(false);
  });

  it('signs out a stale active client view when replacement authentication fails', async () => {
    const runtime = createClientRuntime();
    await runtime.login({ username: USERNAME, password: PASSWORD });
    submitCommand.mockClear();
    deviceStore.sign.mockClear();
    authClient.authenticate.mockRejectedValueOnce(new Error('replacement authentication failed'));

    await expect(
      runtime.login({ username: replacementAccount.username, password: PASSWORD }),
    ).rejects.toThrow('replacement authentication failed');

    expect(runtime.getView()).toMatchObject({ state: 'signed-out', accountId: null });
    await expect(
      runtime.submitPublicCommand({
        command: 'privileged.status.read',
        payload: { clientVersion: '1' },
        expectedRevision: null,
      }),
    ).resolves.toMatchObject({ ok: false, error: 'unauthorized' });
    expect(deviceStore.sign).not.toHaveBeenCalled();
    expect(submitCommand).not.toHaveBeenCalled();
  });

  it('does not resurrect a pending login after runtime disposal', async () => {
    const pendingAuthentication = deferred<RelayPrivilegedAccountRecord>();
    authClient.authenticate.mockImplementationOnce(async () => pendingAuthentication.promise);
    const runtime = createClientRuntime();

    const login = runtime.login({ username: USERNAME, password: PASSWORD });
    const rejection = login.catch((error: unknown) => error);
    await vi.waitFor(() => expect(authClient.authenticate).toHaveBeenCalledOnce());
    await runtime.dispose();

    pendingAuthentication.resolve(account);
    await expect(rejection).resolves.toMatchObject({ code: 'unauthorized' });

    expect(runtime.getView()).toMatchObject({ state: 'signed-out', accountId: null });
    expect(
      (
        authClient as typeof authClient & {
          monitorAuthority: ReturnType<typeof vi.fn>;
        }
      ).monitorAuthority,
    ).not.toHaveBeenCalled();
    expect(authClient.clear).toHaveBeenCalled();
  });

  it.each([
    {
      responseLabel: 'unauthorized',
      response: {
        ok: false as const,
        requestId: 'request-1',
        error: 'unauthorized' as const,
      },
    },
    {
      responseLabel: 'successful',
      response: {
        ok: true as const,
        requestId: 'request-1',
        value: { status: 'old-account-data' },
      },
    },
  ])(
    'does not apply an old account $responseLabel response after a replacement session starts',
    async ({ response }) => {
      const runtime = createClientRuntime();
      await runtime.login({ username: USERNAME, password: PASSWORD });
      submitCommand.mockClear();
      authClient.clear.mockClear();

      const staleResponse = deferred<typeof response>();
      submitCommand.mockImplementationOnce(async () => staleResponse.promise);
      const staleCommand = runtime.submitPublicCommand({
        command: 'privileged.status.read',
        payload: { clientVersion: '1' },
        expectedRevision: null,
      });
      await vi.waitFor(() => expect(submitCommand).toHaveBeenCalledOnce());

      await loginReplacement(runtime);

      staleResponse.resolve(response);
      await expect(staleCommand).resolves.toMatchObject({ ok: false, error: 'unauthorized' });

      expect(runtime.getView()).toMatchObject({
        state: 'active',
        accountId: replacementAccount.id,
        deviceId: 'device-charles-laptop',
      });
      expect(authClient.clear).not.toHaveBeenCalled();
    },
  );

  it('does not sign out a fresh same-account session for an earlier session response', async () => {
    const runtime = createClientRuntime();
    await runtime.login({ username: USERNAME, password: PASSWORD });
    submitCommand.mockClear();
    authClient.clear.mockClear();

    const staleResponse = deferred<{
      ok: false;
      requestId: string;
      error: 'unauthorized';
    }>();
    submitCommand.mockImplementationOnce(async () => staleResponse.promise);
    const staleCommand = runtime.submitPublicCommand({
      command: 'privileged.status.read',
      payload: { clientVersion: '1' },
      expectedRevision: null,
    });
    await vi.waitFor(() => expect(submitCommand).toHaveBeenCalledOnce());

    await runtime.login({ username: USERNAME, password: PASSWORD });
    staleResponse.resolve({
      ok: false,
      requestId: 'request-1',
      error: 'unauthorized',
    });
    await expect(staleCommand).resolves.toMatchObject({ ok: false, error: 'unauthorized' });

    expect(runtime.getView()).toMatchObject({
      state: 'active',
      accountId: ACCOUNT_ID,
      deviceId: DEVICE_ID,
    });
    expect(authClient.clear).not.toHaveBeenCalled();
  });

  it('retires an earlier command as soon as reauthentication starts', async () => {
    const runtime = createClientRuntime();
    await runtime.login({ username: USERNAME, password: PASSWORD });
    submitCommand.mockClear();
    deviceStore.sign.mockClear();

    const staleSignature = deferred<string>();
    deviceStore.sign.mockImplementationOnce(async () => staleSignature.promise);
    const staleCommand = runtime.submitPublicCommand({
      command: 'privileged.status.read',
      payload: { clientVersion: '1' },
      expectedRevision: null,
    });
    await vi.waitFor(() => expect(deviceStore.sign).toHaveBeenCalledOnce());

    const refreshedAuthentication = deferred<{
      account: RelayPrivilegedAccountRecord;
      requestId: string;
      expiresAt: string;
    }>();
    const reauthenticateRemotely = vi.fn(async () => refreshedAuthentication.promise);
    Object.assign(authClient, { reauthenticateRemotely });
    const reauthentication = runtime.reauthenticate(PASSWORD);
    await vi.waitFor(() => expect(reauthenticateRemotely).toHaveBeenCalledOnce());

    staleSignature.resolve('stale-session-signature');
    await expect(staleCommand).resolves.toMatchObject({ ok: false, error: 'unauthorized' });
    expect(submitCommand).not.toHaveBeenCalled();

    refreshedAuthentication.resolve({
      account,
      requestId: 'reauth-request-1',
      expiresAt: new Date(START_TIME + 300_000).toISOString(),
    });
    await expect(reauthentication).resolves.toMatchObject({ proofId: 'reauth-request-1' });
    expect(runtime.getView()).toMatchObject({
      state: 'active',
      accountId: ACCOUNT_ID,
      deviceId: DEVICE_ID,
    });
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

  it('does not create a privileged record after its delayed session is replaced', async () => {
    process.env.RELAY_E2E_PRIVILEGED_FIXTURES = '1';
    process.env.RELAY_E2E_KNOWLEDGE_CHUNK_DELAY_MS = '150';
    const createRecord = vi.fn(async () => ({ id: 'chunk-1' }));
    Object.assign(authClient, { createRecord });
    const runtime = createClientRuntime();
    await runtime.login({ username: USERNAME, password: PASSWORD });

    const pending = runtime.createPrivilegedRecord(KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION, {});
    const rejection = pending.catch((error: unknown) => error);
    await Promise.resolve();
    await loginReplacement(runtime);
    await vi.advanceTimersByTimeAsync(150);

    await expect(rejection).resolves.toMatchObject({ code: 'unauthorized' });
    expect(createRecord).not.toHaveBeenCalled();
    expect(runtime.getView()).toMatchObject({
      state: 'active',
      accountId: replacementAccount.id,
      deviceId: 'device-charles-laptop',
    });
  });

  it('does not return a privileged record response to a replacement session', async () => {
    const staleRecord = deferred<{ id: string }>();
    const createRecord = vi.fn(async () => staleRecord.promise);
    Object.assign(authClient, { createRecord });
    const runtime = createClientRuntime();
    await runtime.login({ username: USERNAME, password: PASSWORD });

    const pending = runtime.createPrivilegedRecord(KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION, {});
    await vi.waitFor(() => expect(createRecord).toHaveBeenCalledOnce());
    await loginReplacement(runtime);
    staleRecord.resolve({ id: 'chunk-1' });

    await expect(pending).rejects.toMatchObject({ code: 'unauthorized' });
    expect(runtime.getView()).toMatchObject({
      state: 'active',
      accountId: replacementAccount.id,
      deviceId: 'device-charles-laptop',
    });
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

  it('does not bind or activate an old account pairing after another account logs in', async () => {
    deviceStore.findForAccount.mockResolvedValueOnce(null);
    const pairingResponse = deferred<{
      deviceId: string;
      fingerprint: string;
      pairedAt: string;
    }>();
    completePairing.mockImplementationOnce(async () => pairingResponse.promise);
    const runtime = createClientRuntime();
    await runtime.login({ username: USERNAME, password: PASSWORD });

    const pairing = runtime.completePairing({
      challengeId: 'challenge-1',
      code: 'ABCD2345',
      deviceLabel: 'Ryan work laptop',
    });
    const rejection = pairing.catch((error: unknown) => error);
    await vi.waitFor(() => expect(completePairing).toHaveBeenCalledOnce());
    await loginUnpairedReplacement(runtime);

    pairingResponse.resolve({
      deviceId: DEVICE_ID,
      fingerprint: 'f'.repeat(64),
      pairedAt: new Date(START_TIME).toISOString(),
    });
    await expect(rejection).resolves.toMatchObject({ code: 'unauthorized' });

    expect(deviceStore.bind).not.toHaveBeenCalled();
    expect(deviceStore.removePending).toHaveBeenCalledWith(ACCOUNT_ID, 'pending-key');
    expect(runtime.getView()).toMatchObject({
      state: 'pairing-required',
      accountId: replacementAccount.id,
      deviceId: null,
    });
  });

  it('does not activate an old account device when the session changes during key binding', async () => {
    deviceStore.findForAccount.mockResolvedValueOnce(null);
    const binding = deferred<void>();
    deviceStore.bind.mockImplementationOnce(async () => binding.promise);
    const runtime = createClientRuntime();
    await runtime.login({ username: USERNAME, password: PASSWORD });

    const pairing = runtime.completePairing({
      challengeId: 'challenge-1',
      code: 'ABCD2345',
      deviceLabel: 'Ryan work laptop',
    });
    const rejection = pairing.catch((error: unknown) => error);
    await vi.waitFor(() => expect(deviceStore.bind).toHaveBeenCalledOnce());
    await loginUnpairedReplacement(runtime);

    binding.resolve();
    await expect(rejection).resolves.toMatchObject({ code: 'unauthorized' });

    expect(deviceStore.bind).toHaveBeenCalledWith(ACCOUNT_ID, 'pending-key', DEVICE_ID);
    expect(runtime.getView()).toMatchObject({
      state: 'pairing-required',
      accountId: replacementAccount.id,
      deviceId: null,
    });
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

  it('does not create a pairing challenge after its authorizing session is replaced', async () => {
    const targetResolution = deferred<boolean>();
    const resolvePairingTarget = vi.fn(async () => targetResolution.promise);
    const pairingService = {
      createChallenge: vi.fn(async () => ({
        challengeId: 'challenge-1',
        accountId: 'account-publisher',
        code: 'ABCD2345',
        expiresAt: new Date(START_TIME + 600_000).toISOString(),
      })),
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
        role: 'admin',
      })),
      resolvePairingTarget,
    } as never);
    await runtime.login({ username: USERNAME, password: PASSWORD });

    const challenge = runtime.createPairingChallenge('account-publisher');
    const rejection = challenge.catch((error: unknown) => error);
    await vi.waitFor(() => expect(resolvePairingTarget).toHaveBeenCalledOnce());
    authClient.authenticate.mockResolvedValueOnce(replacementAccount);
    await runtime.login({ username: replacementAccount.username, password: PASSWORD });

    targetResolution.resolve(true);
    await expect(rejection).resolves.toMatchObject({ code: 'unauthorized' });
    expect(pairingService.createChallenge).not.toHaveBeenCalled();
    expect(runtime.getView()).toMatchObject({
      state: 'active',
      accountId: replacementAccount.id,
    });
  });

  it('does not return a local command response after its server session is replaced', async () => {
    const localResponse = deferred<{
      ok: true;
      requestId: string;
      value: { status: string };
    }>();
    const processor = {
      process: vi.fn(),
      processLocal: vi.fn(async () => localResponse.promise),
    };
    const pairingService = {
      createChallenge: vi.fn(),
      completePairing: vi.fn(),
      dispose: vi.fn(),
    };
    const runtime = new PrivilegedRuntime({
      authClient,
      commandProcessor: processor,
      deviceStore,
      hostname: 'RELAY-SERVER',
      mode: 'server',
      now: () => START_TIME,
      pairingService,
      resolveAccountIdentity: vi.fn(async () => ({
        assigned: true,
        role: 'admin',
      })),
    } as never);
    await runtime.login({ username: USERNAME, password: PASSWORD });

    const command = runtime.submitPublicCommand({
      command: 'privileged.status.read',
      payload: { clientVersion: '1' },
      expectedRevision: null,
    });
    await vi.waitFor(() => expect(processor.processLocal).toHaveBeenCalledOnce());
    authClient.authenticate.mockResolvedValueOnce(replacementAccount);
    await runtime.login({ username: replacementAccount.username, password: PASSWORD });

    localResponse.resolve({
      ok: true,
      requestId: 'local-1',
      value: { status: 'old-account-data' },
    });
    await expect(command).resolves.toMatchObject({ ok: false, error: 'unauthorized' });
    expect(runtime.getView()).toMatchObject({
      state: 'active',
      accountId: replacementAccount.id,
    });
  });

  it('does not authorize local commands from a stale server view after replacement login fails', async () => {
    const processor = {
      process: vi.fn(),
      processLocal: vi.fn(async () => ({
        ok: true as const,
        requestId: 'local-1',
        value: { status: 'ready' },
      })),
    };
    const pairingService = {
      createChallenge: vi.fn(),
      completePairing: vi.fn(),
      dispose: vi.fn(),
    };
    const runtime = new PrivilegedRuntime({
      authClient,
      commandProcessor: processor,
      deviceStore,
      hostname: 'RELAY-SERVER',
      mode: 'server',
      now: () => START_TIME,
      pairingService,
      resolveAccountIdentity: vi.fn(async () => ({
        assigned: true,
        role: 'admin',
      })),
    } as never);
    await runtime.login({ username: USERNAME, password: PASSWORD });
    authClient.authenticate.mockRejectedValueOnce(new Error('replacement authentication failed'));

    await expect(
      runtime.login({ username: replacementAccount.username, password: PASSWORD }),
    ).rejects.toThrow('replacement authentication failed');

    expect(runtime.getView()).toMatchObject({ state: 'signed-out', accountId: null });
    await expect(
      runtime.submitPublicCommand({
        command: 'privileged.status.read',
        payload: { clientVersion: '1' },
        expectedRevision: null,
      }),
    ).resolves.toMatchObject({ ok: false, error: 'unauthorized' });
    expect(processor.processLocal).not.toHaveBeenCalled();
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

  it('broadcasts an active session only after public commands are available', async () => {
    const runtime = createClientRuntime();
    const commandResults: Array<ReturnType<typeof runtime.submitPublicCommand>> = [];
    runtime.onSessionChanged((view) => {
      if (view.state !== 'active') return;
      commandResults.push(
        runtime.submitPublicCommand({
          command: 'privileged.status.read',
          payload: { clientVersion: '1' },
          expectedRevision: null,
        }),
      );
    });

    await runtime.login({ username: USERNAME, password: PASSWORD });

    expect(commandResults).toHaveLength(1);
    await expect(commandResults[0]).resolves.toMatchObject({ ok: true });
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
  const serverClient = {
    collection: vi.fn(() => ({})),
    files: {},
  };

  afterEach(() => {
    productionRuntimeMocks.knowledgeCommandOptions = null;
    vi.restoreAllMocks();
  });

  it('starts backfill without awaiting it and contains a rejected startup', async () => {
    vi.spyOn(loggers.main, 'warn').mockImplementation(() => undefined);
    const pending = deferred<void>();
    const start = vi.fn(() => pending.promise);

    expect(() => startKnowledgeSearchIndexerBestEffort({ start })).not.toThrow();
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());

    pending.resolve();
    await pending.promise;

    const rejectedStart = vi.fn(async () => {
      throw new Error('search-storage-unavailable');
    });
    expect(() => startKnowledgeSearchIndexerBestEffort({ start: rejectedStart })).not.toThrow();
    await vi.waitFor(() => expect(rejectedStart).toHaveBeenCalledOnce());

    const throwingStart = vi.fn(() => {
      throw new Error('synchronous-start-failed');
    });
    expect(() =>
      startKnowledgeSearchIndexerBestEffort({ start: throwingStart as never }),
    ).not.toThrow();
    await vi.waitFor(() => expect(throwingStart).toHaveBeenCalledOnce());
  });

  it('does not start the indexer when upload runtime construction fails', async () => {
    const indexerStart = vi
      .spyOn(KnowledgeSearchIndexer.prototype, 'start')
      .mockResolvedValue(undefined);
    vi.spyOn(KnowledgeUploadCoordinator.prototype, 'start').mockRejectedValue(
      new Error('upload-start-failed'),
    );

    await expect(
      createProductionPrivilegedRuntime({
        config: { mode: 'server', port: 8090 } as never,
        dataDir: '/Users/test/RelayData/data',
        serverClient: serverClient as never,
      }),
    ).rejects.toThrow('upload-start-failed');
    expect(indexerStart).not.toHaveBeenCalled();
  });

  it('does not start the indexer when server queue construction fails', async () => {
    const indexerStart = vi
      .spyOn(KnowledgeSearchIndexer.prototype, 'start')
      .mockResolvedValue(undefined);
    vi.spyOn(KnowledgeUploadCoordinator.prototype, 'start').mockResolvedValue(undefined);
    vi.spyOn(PrivilegedServerQueue.prototype, 'start').mockRejectedValue(
      new Error('server-queue-start-failed'),
    );

    await expect(
      createProductionPrivilegedRuntime({
        config: { mode: 'server', port: 8090 } as never,
        dataDir: '/Users/test/RelayData/data',
        serverClient: serverClient as never,
      }),
    ).rejects.toThrow('server-queue-start-failed');
    expect(indexerStart).not.toHaveBeenCalled();
  });

  it('starts, injects, and disposes the same runtime-owned indexer instance', async () => {
    vi.spyOn(KnowledgeUploadCoordinator.prototype, 'start').mockResolvedValue(undefined);
    const uploadDispose = vi
      .spyOn(KnowledgeUploadCoordinator.prototype, 'dispose')
      .mockResolvedValue(undefined);
    vi.spyOn(PrivilegedServerQueue.prototype, 'start').mockResolvedValue(undefined);
    const queueDispose = vi
      .spyOn(PrivilegedServerQueue.prototype, 'dispose')
      .mockResolvedValue(undefined);
    const indexerStart = vi
      .spyOn(KnowledgeSearchIndexer.prototype, 'start')
      .mockResolvedValue(undefined);
    const indexerDispose = vi
      .spyOn(KnowledgeSearchIndexer.prototype, 'dispose')
      .mockResolvedValue(undefined);

    const runtime = await createProductionPrivilegedRuntime({
      config: { mode: 'server', port: 8090 } as never,
      dataDir: '/Users/test/RelayData/data',
      serverClient: serverClient as never,
    });
    const startedIndexer = indexerStart.mock.instances[0];
    expect(productionRuntimeMocks.knowledgeCommandOptions?.searchIndexer).toBe(startedIndexer);

    await runtime.dispose();

    expect(indexerDispose).toHaveBeenCalledOnce();
    expect(indexerDispose.mock.instances[0]).toBe(startedIndexer);
    expect(queueDispose).toHaveBeenCalledBefore(uploadDispose);
    expect(uploadDispose).toHaveBeenCalledBefore(indexerDispose);
  });

  it('still awaits indexer disposal when an earlier server resource disposal fails', async () => {
    vi.spyOn(KnowledgeUploadCoordinator.prototype, 'start').mockResolvedValue(undefined);
    const uploadDispose = vi
      .spyOn(KnowledgeUploadCoordinator.prototype, 'dispose')
      .mockResolvedValue(undefined);
    vi.spyOn(PrivilegedServerQueue.prototype, 'start').mockResolvedValue(undefined);
    vi.spyOn(PrivilegedServerQueue.prototype, 'dispose').mockRejectedValue(
      new Error('queue-dispose-failed'),
    );
    vi.spyOn(KnowledgeSearchIndexer.prototype, 'start').mockResolvedValue(undefined);
    const indexerDispose = vi
      .spyOn(KnowledgeSearchIndexer.prototype, 'dispose')
      .mockResolvedValue(undefined);
    const runtime = await createProductionPrivilegedRuntime({
      config: { mode: 'server', port: 8090 } as never,
      dataDir: '/Users/test/RelayData/data',
      serverClient: serverClient as never,
    });

    await expect(runtime.dispose()).rejects.toThrow('queue-dispose-failed');
    expect(uploadDispose).toHaveBeenCalledOnce();
    expect(indexerDispose).toHaveBeenCalledOnce();
  });
});
