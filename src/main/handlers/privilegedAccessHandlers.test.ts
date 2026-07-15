import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@shared/ipc';
import {
  setupPrivilegedAccessHandlers,
  type PrivilegedAccessRuntime,
} from './privilegedAccessHandlers';

const PASSWORD = 'Test-access-value-123!';

function signedOutView() {
  return {
    state: 'signed-out' as const,
    accountId: null,
    operatorId: null,
    operatorName: null,
    role: null,
    capabilities: [],
    deviceId: null,
    expiresAt: null,
  };
}

describe('setupPrivilegedAccessHandlers', () => {
  let handlers: Map<string, (event: unknown, input?: unknown) => unknown>;
  let runtime: PrivilegedAccessRuntime;
  let assertTrustedIpcSender: ReturnType<typeof vi.fn>;
  let broadcast: ReturnType<typeof vi.fn>;
  let sessionListener: ((view: unknown) => void) | null;
  const accountManager = {
    setupInitialAdministrator: vi.fn(async () => ({
      accountId: 'account-admin',
      operatorId: 'operator-admin',
      role: 'admin' as const,
      credentialState: 'configured' as const,
      credentialVersion: 1,
    })),
    setupCredential: vi.fn(async () => ({
      accountId: 'account-publisher',
      operatorId: 'operator-publisher',
      role: 'publisher' as const,
      credentialState: 'configured' as const,
      credentialVersion: 1,
    })),
  };

  beforeEach(() => {
    handlers = new Map();
    sessionListener = null;
    runtime = {
      getView: vi.fn(() => signedOutView()),
      login: vi.fn(async () => ({ ...signedOutView(), state: 'active' as const })),
      logout: vi.fn(async () => undefined),
      lock: vi.fn(() => undefined),
      reauthenticate: vi.fn(async () => ({
        proofId: 'proof-1',
        expiresAt: '2026-07-15T12:05:00.000Z',
      })),
      createPairingChallenge: vi.fn(async () => ({
        challengeId: 'challenge-1',
        accountId: 'account-admin',
        code: 'ABCD2345',
        expiresAt: '2026-07-15T12:10:00.000Z',
      })),
      completePairing: vi.fn(async () => ({
        deviceId: 'device-1',
        fingerprint: 'a'.repeat(64),
        pairedAt: '2026-07-15T12:00:00.000Z',
      })),
      submitPublicCommand: vi.fn(async () => ({
        ok: true as const,
        requestId: 'request-1',
        value: { status: 'ready' },
      })),
    };
    assertTrustedIpcSender = vi.fn(() => true);
    broadcast = vi.fn();
  });

  function setup(isServer = true) {
    setupPrivilegedAccessHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      getRuntime: () => runtime,
      isServer: () => isServer,
      assertTrustedIpcSender,
      getAccountManager: () => accountManager,
      broadcast,
      subscribeSessionChanged: (listener) => {
        sessionListener = listener;
        return () => {
          sessionListener = null;
        };
      },
    });
  }

  async function invoke(channel: string, input?: unknown) {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`Missing handler ${channel}`);
    return handler({ sender: 'trusted' }, input);
  }

  it('registers every approved privileged IPC channel', () => {
    setup();

    expect([...handlers.keys()]).toEqual([
      IPC_CHANNELS.PRIVILEGED_GET_SESSION,
      IPC_CHANNELS.PRIVILEGED_LOGIN,
      IPC_CHANNELS.PRIVILEGED_LOGOUT,
      IPC_CHANNELS.PRIVILEGED_LOCK,
      IPC_CHANNELS.PRIVILEGED_REAUTHENTICATE,
      IPC_CHANNELS.PRIVILEGED_CREATE_PAIRING_CHALLENGE,
      IPC_CHANNELS.PRIVILEGED_COMPLETE_PAIRING,
      IPC_CHANNELS.PRIVILEGED_SUBMIT_COMMAND,
      IPC_CHANNELS.PRIVILEGED_SETUP_INITIAL_ADMIN,
      IPC_CHANNELS.PRIVILEGED_SETUP_CREDENTIAL,
    ]);
  });

  it('enforces trusted sender checks before every runtime action', async () => {
    assertTrustedIpcSender.mockReturnValue(false);
    setup();

    for (const channel of handlers.keys()) {
      await expect(invoke(channel, {})).resolves.toMatchObject(
        channel === IPC_CHANNELS.PRIVILEGED_GET_SESSION
          ? { state: 'signed-out' }
          : { ok: false, error: 'unauthorized' },
      );
    }
    expect(runtime.login).not.toHaveBeenCalled();
    expect(assertTrustedIpcSender).toHaveBeenCalledTimes(10);
  });

  it('strictly validates login and returns generic credential errors', async () => {
    setup();

    await expect(
      invoke(IPC_CHANNELS.PRIVILEGED_LOGIN, {
        operatorId: 'operator-admin',
        password: PASSWORD,
        token: 'unexpected',
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid-input' });
    expect(runtime.login).not.toHaveBeenCalled();

    vi.mocked(runtime.login).mockRejectedValueOnce(new Error('PocketBase sensitive details'));
    await expect(
      invoke(IPC_CHANNELS.PRIVILEGED_LOGIN, {
        operatorId: 'operator-admin',
        password: PASSWORD,
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid-credentials' });
  });

  it('forwards valid login and reauthentication without changing password bytes', async () => {
    setup();
    const spacedPassword = ` ${PASSWORD} `;

    await invoke(IPC_CHANNELS.PRIVILEGED_LOGIN, {
      operatorId: 'operator-admin',
      password: spacedPassword,
    });
    await invoke(IPC_CHANNELS.PRIVILEGED_REAUTHENTICATE, { password: spacedPassword });

    expect(runtime.login).toHaveBeenCalledWith({
      operatorId: 'operator-admin',
      password: spacedPassword,
    });
    expect(runtime.reauthenticate).toHaveBeenCalledWith(spacedPassword);
  });

  it('creates pairing challenges only from the server renderer', async () => {
    setup(false);
    await expect(invoke(IPC_CHANNELS.PRIVILEGED_CREATE_PAIRING_CHALLENGE)).resolves.toEqual({
      ok: false,
      error: 'unauthorized',
    });
    expect(runtime.createPairingChallenge).not.toHaveBeenCalled();
  });

  it('allows first administrator setup only through trusted local server IPC', async () => {
    setup();
    const input = {
      operatorId: 'operator-admin',
      password: PASSWORD,
      passwordConfirm: PASSWORD,
    };
    await expect(invoke(IPC_CHANNELS.PRIVILEGED_SETUP_INITIAL_ADMIN, input)).resolves.toMatchObject(
      {
        ok: true,
        value: { operatorId: 'operator-admin', credentialState: 'configured' },
      },
    );
    expect(accountManager.setupInitialAdministrator).toHaveBeenCalledWith(input);

    handlers.clear();
    setup(false);
    await expect(invoke(IPC_CHANNELS.PRIVILEGED_SETUP_INITIAL_ADMIN, input)).resolves.toEqual({
      ok: false,
      error: 'unauthorized',
    });
  });

  it('requires an active local administrator before publisher setup or recovery', async () => {
    const input = {
      operatorId: 'operator-publisher',
      password: PASSWORD,
      passwordConfirm: PASSWORD,
    };
    setup();
    await expect(invoke(IPC_CHANNELS.PRIVILEGED_SETUP_CREDENTIAL, input)).resolves.toEqual({
      ok: false,
      error: 'unauthorized',
    });

    vi.mocked(runtime.getView).mockReturnValue({
      state: 'active',
      accountId: 'account-admin',
      operatorId: 'operator-admin',
      operatorName: 'Ryan Bledsoe',
      role: 'admin',
      capabilities: ['settings.manage'],
      deviceId: null,
      expiresAt: '2026-07-15T23:15:00.000Z',
    });
    await expect(invoke(IPC_CHANNELS.PRIVILEGED_SETUP_CREDENTIAL, input)).resolves.toMatchObject({
      ok: true,
      value: { operatorId: 'operator-publisher' },
    });
    expect(accountManager.setupCredential).toHaveBeenCalledWith({
      actorOperatorId: 'operator-admin',
      ...input,
    });
  });

  it('rejects internal command names at the generic command bridge', async () => {
    setup();
    await expect(
      invoke(IPC_CHANNELS.PRIVILEGED_SUBMIT_COMMAND, {
        command: 'privileged.reauth.confirm',
        payload: { authenticatedAt: '2026-07-15T12:00:00.000Z' },
        expectedRevision: null,
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid-request' });
    expect(runtime.submitPublicCommand).not.toHaveBeenCalled();
  });

  it('broadcasts only normalized public session fields', () => {
    setup();
    sessionListener?.({
      state: 'active',
      accountId: 'account-admin',
      operatorId: 'operator-admin',
      operatorName: 'Ryan Bledsoe',
      role: 'admin',
      capabilities: ['privileged.status.read', 'not-real'],
      deviceId: 'device-1',
      expiresAt: '2026-07-15T12:15:00.000Z',
      token: 'must-not-broadcast',
    });

    expect(broadcast).toHaveBeenCalledWith(IPC_CHANNELS.PRIVILEGED_SESSION_CHANGED, {
      state: 'active',
      accountId: 'account-admin',
      operatorId: 'operator-admin',
      operatorName: 'Ryan Bledsoe',
      role: 'admin',
      capabilities: ['privileged.status.read'],
      deviceId: 'device-1',
      expiresAt: '2026-07-15T12:15:00.000Z',
    });
    expect(JSON.stringify(broadcast.mock.calls)).not.toContain('must-not-broadcast');
  });
});
