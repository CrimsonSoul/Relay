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
    username: null,
    displayName: null,
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
      username: 'ryan',
      displayName: 'Ryan Bledsoe',
      storedRole: 'administrator' as const,
      role: 'owner' as const,
      credentialState: 'configured' as const,
      credentialVersion: 1,
    })),
    setupCredential: vi.fn(async () => ({
      accountId: 'account-publisher',
      username: 'tristan',
      displayName: 'Tristan Bowles',
      storedRole: 'publisher' as const,
      role: 'publisher' as const,
      credentialState: 'configured' as const,
      credentialVersion: 1,
    })),
  };
  const approvalCodes = {
    listPending: vi.fn(() => []),
    generate: vi.fn(),
    cancel: vi.fn(() => false),
  };

  beforeEach(() => {
    handlers = new Map();
    sessionListener = null;
    runtime = {
      getView: vi.fn(() => signedOutView()),
      login: vi.fn(async () => ({ ...signedOutView(), state: 'active' as const })),
      logout: vi.fn(async () => undefined),
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
      getApprovalCodes: () => approvalCodes as never,
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

  function untrustedResult(channel: string): unknown {
    if (channel === IPC_CHANNELS.PRIVILEGED_GET_SESSION) return { state: 'signed-out' };
    if (channel === IPC_CHANNELS.PRIVILEGED_APPROVAL_LIST) return [];
    if (channel === IPC_CHANNELS.PRIVILEGED_APPROVAL_CANCEL) return false;
    return { ok: false, error: 'unauthorized' };
  }

  it('registers every approved privileged IPC channel', () => {
    setup();

    expect([...handlers.keys()]).toEqual([
      IPC_CHANNELS.PRIVILEGED_GET_SESSION,
      IPC_CHANNELS.PRIVILEGED_LOGIN,
      IPC_CHANNELS.PRIVILEGED_LOGOUT,
      IPC_CHANNELS.PRIVILEGED_REAUTHENTICATE,
      IPC_CHANNELS.PRIVILEGED_CREATE_PAIRING_CHALLENGE,
      IPC_CHANNELS.PRIVILEGED_COMPLETE_PAIRING,
      IPC_CHANNELS.PRIVILEGED_SUBMIT_COMMAND,
      IPC_CHANNELS.PRIVILEGED_SETUP_INITIAL_ADMIN,
      IPC_CHANNELS.PRIVILEGED_SETUP_CREDENTIAL,
      IPC_CHANNELS.PRIVILEGED_APPROVAL_LIST,
      IPC_CHANNELS.PRIVILEGED_APPROVAL_GENERATE,
      IPC_CHANNELS.PRIVILEGED_APPROVAL_CANCEL,
    ]);
  });

  it('enforces trusted sender checks before every runtime action', async () => {
    assertTrustedIpcSender.mockReturnValue(false);
    setup();

    for (const channel of handlers.keys()) {
      await expect(invoke(channel, {})).resolves.toMatchObject(untrustedResult(channel));
    }
    expect(runtime.login).not.toHaveBeenCalled();
    expect(assertTrustedIpcSender).toHaveBeenCalledTimes(12);
  });

  it('strictly validates login and returns generic credential errors', async () => {
    setup();

    await expect(
      invoke(IPC_CHANNELS.PRIVILEGED_LOGIN, {
        username: 'ryan',
        password: PASSWORD,
        token: 'unexpected',
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid-input' });
    expect(runtime.login).not.toHaveBeenCalled();

    vi.mocked(runtime.login).mockRejectedValueOnce(new Error('PocketBase sensitive details'));
    await expect(
      invoke(IPC_CHANNELS.PRIVILEGED_LOGIN, {
        username: 'ryan',
        password: PASSWORD,
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid-credentials' });
  });

  it('forwards valid login and reauthentication without changing password bytes', async () => {
    setup();
    const spacedPassword = ` ${PASSWORD} `;

    await invoke(IPC_CHANNELS.PRIVILEGED_LOGIN, {
      username: 'ryan',
      password: spacedPassword,
    });
    await invoke(IPC_CHANNELS.PRIVILEGED_REAUTHENTICATE, { password: spacedPassword });

    expect(runtime.login).toHaveBeenCalledWith({
      username: 'ryan',
      password: spacedPassword,
    });
    expect(runtime.reauthenticate).toHaveBeenCalledWith(spacedPassword);
  });

  it('creates pairing challenges only from the server renderer', async () => {
    setup(false);
    await expect(
      invoke(IPC_CHANNELS.PRIVILEGED_CREATE_PAIRING_CHALLENGE, 'account-admin'),
    ).resolves.toEqual({ ok: false, error: 'unauthorized' });
    expect(runtime.createPairingChallenge).not.toHaveBeenCalled();
  });

  it('validates and forwards the selected publisher account for local pairing', async () => {
    setup();

    await expect(
      invoke(IPC_CHANNELS.PRIVILEGED_CREATE_PAIRING_CHALLENGE, 'account-publisher'),
    ).resolves.toMatchObject({ ok: true });
    expect(runtime.createPairingChallenge).toHaveBeenCalledWith('account-publisher');

    await expect(
      invoke(IPC_CHANNELS.PRIVILEGED_CREATE_PAIRING_CHALLENGE, { accountId: '../publisher' }),
    ).resolves.toEqual({ ok: false, error: 'invalid-input' });
  });

  it('allows first administrator setup only through trusted local server IPC', async () => {
    setup();
    const input = {
      username: '  Ryan ',
      password: PASSWORD,
      passwordConfirm: PASSWORD,
    };
    await expect(invoke(IPC_CHANNELS.PRIVILEGED_SETUP_INITIAL_ADMIN, input)).resolves.toMatchObject(
      {
        ok: true,
        value: { accountId: 'account-admin', credentialState: 'configured' },
      },
    );
    expect(accountManager.setupInitialAdministrator).toHaveBeenCalledWith({
      ...input,
      username: 'ryan',
    });

    handlers.clear();
    setup(false);
    await expect(invoke(IPC_CHANNELS.PRIVILEGED_SETUP_INITIAL_ADMIN, input)).resolves.toEqual({
      ok: false,
      error: 'unauthorized',
    });
  });

  it('requires an active local administrator before publisher setup or recovery', async () => {
    const input = {
      accountId: 'account-publisher',
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
      username: 'ryan',
      displayName: 'Ryan Bledsoe',
      role: 'owner',
      capabilities: ['settings.manage'],
      deviceId: null,
      expiresAt: null,
    });
    await expect(invoke(IPC_CHANNELS.PRIVILEGED_SETUP_CREDENTIAL, input)).resolves.toMatchObject({
      ok: true,
      value: { accountId: 'account-publisher' },
    });
    expect(accountManager.setupCredential).toHaveBeenCalledWith({
      actorAccountId: 'account-admin',
      ...input,
    });
  });

  it('lists, generates, and cancels web approval codes only through trusted server IPC', async () => {
    const request = {
      requestId: 'approval-1',
      operation: 'credential-recovery' as const,
      sourceLabel: 'Chrome from 10.0.0.8',
      createdAt: '2026-07-20T12:00:00.000Z',
      expiresAt: '2026-07-20T12:10:00.000Z',
    };
    approvalCodes.listPending.mockReturnValueOnce([request]);
    approvalCodes.generate.mockReturnValueOnce({ request, code: '123456' });
    approvalCodes.cancel.mockReturnValueOnce(true);
    setup();

    await expect(invoke(IPC_CHANNELS.PRIVILEGED_APPROVAL_LIST)).resolves.toEqual([request]);
    await expect(invoke(IPC_CHANNELS.PRIVILEGED_APPROVAL_GENERATE, 'approval-1')).resolves.toEqual({
      ok: true,
      value: { request, code: '123456' },
    });
    await expect(invoke(IPC_CHANNELS.PRIVILEGED_APPROVAL_CANCEL, 'approval-1')).resolves.toBe(true);
    expect(approvalCodes.generate).toHaveBeenCalledWith('approval-1');
    expect(approvalCodes.cancel).toHaveBeenCalledWith('approval-1');

    handlers.clear();
    setup(false);
    await expect(invoke(IPC_CHANNELS.PRIVILEGED_APPROVAL_LIST)).resolves.toEqual([]);
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
      username: 'ryan',
      displayName: 'Ryan Bledsoe',
      role: 'owner',
      capabilities: ['privileged.status.read', 'not-real'],
      deviceId: 'device-1',
      expiresAt: null,
      token: 'must-not-broadcast',
    });

    expect(broadcast).toHaveBeenCalledWith(IPC_CHANNELS.PRIVILEGED_SESSION_CHANGED, {
      state: 'active',
      accountId: 'account-admin',
      username: 'ryan',
      displayName: 'Ryan Bledsoe',
      role: 'owner',
      capabilities: ['privileged.status.read'],
      deviceId: 'device-1',
      expiresAt: null,
    });
    expect(JSON.stringify(broadcast.mock.calls)).not.toContain('must-not-broadcast');
  });
});
