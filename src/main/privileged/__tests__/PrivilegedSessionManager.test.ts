import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_PRIVILEGED_CAPABILITIES,
  OWNER_PRIVILEGED_CAPABILITIES,
  type RelayPrivilegedAccountRecord,
} from '@shared/privilegedAccess';
import {
  PrivilegedSessionError,
  PrivilegedSessionManager,
  type PrivilegedAuthorization,
} from '../PrivilegedSessionManager';

const USERNAME = 'ryan';
// eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Deliberate synthetic credential fixture exercises session authentication behavior.
const PASSWORD = 'Test-access-value-123!';
const START_TIME = new Date('2026-07-15T12:00:00.000Z').getTime();

function accountRecord(
  overrides: Partial<RelayPrivilegedAccountRecord> = {},
): RelayPrivilegedAccountRecord {
  return {
    id: 'account-admin',
    username: USERNAME,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe('PrivilegedSessionManager', () => {
  let currentAccount: RelayPrivilegedAccountRecord;
  let authClient: {
    authenticate: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    reauthenticate: ReturnType<typeof vi.fn>;
    reauthenticateRemotely?: ReturnType<typeof vi.fn>;
  };
  let authorization: PrivilegedAuthorization;
  let resolveAuthorization: ReturnType<typeof vi.fn>;
  let confirmReauthentication: ReturnType<typeof vi.fn>;
  let onViewChanged: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START_TIME);
    currentAccount = accountRecord();
    authClient = {
      authenticate: vi.fn(async () => currentAccount),
      clear: vi.fn(),
      reauthenticate: vi.fn(async () => currentAccount),
    };
    authorization = {
      assigned: true,
      deviceId: 'device-work-laptop',
      paired: true,
      role: 'owner',
    };
    resolveAuthorization = vi.fn(async () => authorization);
    confirmReauthentication = vi.fn(async () => ({ requestId: 'reauth-command-id' }));
    onViewChanged = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createManager() {
    return new PrivilegedSessionManager({
      authClient,
      confirmReauthentication,
      now: Date.now,
      onViewChanged,
      resolveAuthorization,
    });
  }

  it('authenticates with username and returns the effective owner role without operator selection', async () => {
    const manager = createManager();

    const view = await manager.login({ username: USERNAME, password: PASSWORD });

    expect(view).toEqual({
      state: 'active',
      accountId: 'account-admin',
      username: USERNAME,
      displayName: 'Ryan Bledsoe',
      role: 'owner',
      capabilities: expect.arrayContaining(ADMIN_PRIVILEGED_CAPABILITIES),
      deviceId: 'device-work-laptop',
      expiresAt: null,
    });
    expect(JSON.stringify(view)).not.toContain(PASSWORD);
    expect(authClient.authenticate).toHaveBeenCalledWith(USERNAME, PASSWORD);
    expect(JSON.stringify(view)).not.toContain('operator');
  });

  it('normalizes username casing and whitespace before authentication', async () => {
    const manager = createManager();

    await manager.login({ username: '  RyAn  ', password: PASSWORD });

    expect(authClient.authenticate).toHaveBeenCalledWith('ryan', PASSWORD);
    expect(manager.getView()).toMatchObject({ state: 'active', username: 'ryan' });
  });

  it('keeps an authenticated session active without an idle timeout', async () => {
    const manager = createManager();
    await manager.login({ username: USERNAME, password: PASSWORD });

    await vi.advanceTimersByTimeAsync(30 * 24 * 60 * 60 * 1_000);
    expect(manager.getView()).toMatchObject({ state: 'active', expiresAt: null });
    expect(authClient.clear).not.toHaveBeenCalled();
  });

  it('supports explicit sign out and app-close disposal', async () => {
    const manager = createManager();
    await manager.login({ username: USERNAME, password: PASSWORD });

    await manager.logout();
    expect(manager.getView().state).toBe('signed-out');

    await manager.login({ username: USERNAME, password: PASSWORD });
    manager.dispose();
    expect(manager.getView().state).toBe('signed-out');
    expect(authClient.clear).toHaveBeenCalledTimes(2);
  });

  it('signs out an active session when replacement authentication fails', async () => {
    const manager = createManager();
    await manager.login({ username: USERNAME, password: PASSWORD });
    authClient.authenticate.mockRejectedValueOnce(new Error('replacement authentication failed'));

    await expect(manager.login({ username: 'charles', password: PASSWORD })).rejects.toThrow(
      'replacement authentication failed',
    );

    expect(manager.getView()).toMatchObject({ state: 'signed-out', accountId: null });
    expect(authClient.clear).toHaveBeenCalledOnce();
  });

  it('does not let a cancelled late login overwrite a fresh session', async () => {
    const manager = createManager();
    await manager.login({ username: USERNAME, password: PASSWORD });
    const staleAuthentication = deferred<RelayPrivilegedAccountRecord>();
    authClient.authenticate
      .mockImplementationOnce(async () => staleAuthentication.promise)
      .mockResolvedValueOnce(currentAccount);

    const staleLogin = manager.login({ username: 'charles', password: PASSWORD });
    const rejection = staleLogin.catch((error: unknown) => error);
    await vi.waitFor(() => expect(authClient.authenticate).toHaveBeenCalledTimes(2));
    manager.logout();
    await manager.login({ username: USERNAME, password: PASSWORD });

    staleAuthentication.resolve(
      accountRecord({
        id: 'account-charles',
        username: 'charles',
        displayName: 'Charles Gibbs',
      }),
    );
    await expect(rejection).resolves.toMatchObject({ code: 'unauthorized' });

    expect(manager.getView()).toMatchObject({
      state: 'active',
      accountId: 'account-admin',
      username: USERNAME,
    });
    expect(authClient.clear).toHaveBeenCalledOnce();
  });

  it('does not resurrect a pending login after disposal', async () => {
    const pendingAuthentication = deferred<RelayPrivilegedAccountRecord>();
    authClient.authenticate.mockImplementationOnce(async () => pendingAuthentication.promise);
    const manager = createManager();

    const login = manager.login({ username: USERNAME, password: PASSWORD });
    const rejection = login.catch((error: unknown) => error);
    await vi.waitFor(() => expect(authClient.authenticate).toHaveBeenCalledOnce());
    manager.dispose();
    pendingAuthentication.resolve(currentAccount);
    await expect(rejection).resolves.toMatchObject({ code: 'unauthorized' });

    expect(manager.getView()).toMatchObject({ state: 'signed-out', accountId: null });
    expect(onViewChanged.mock.calls.some(([view]) => view.state === 'active')).toBe(false);
  });

  it('signs out on account disablement, replacement, username change, or credential replacement', async () => {
    const cases: Array<RelayPrivilegedAccountRecord | null> = [
      accountRecord({ active: false }),
      accountRecord({ id: 'replacement-account' }),
      accountRecord({ username: 'charles' }),
      accountRecord({ credentialVersion: 2 }),
      null,
    ];

    for (const changedAccount of cases) {
      const manager = createManager();
      await manager.login({ username: USERNAME, password: PASSWORD });
      manager.handleAccountChanged(changedAccount);
      expect(manager.getView().state).toBe('signed-out');
    }
  });

  it('invalidates the affected session after ownership or Publisher authority changes', async () => {
    const manager = createManager();
    await manager.login({ username: USERNAME, password: PASSWORD });

    manager.handleAuthorityChanged(['account-charles', 'account-admin']);

    expect(manager.getView().state).toBe('signed-out');
    expect(authClient.clear).toHaveBeenCalledOnce();
  });

  it('keeps the session active when only the account display name changes', async () => {
    const manager = createManager();
    await manager.login({ username: USERNAME, password: PASSWORD });

    manager.handleAccountChanged(accountRecord({ displayName: 'Ryan B.' }));

    expect(manager.getView().state).toBe('active');
  });

  it('returns pairing-required for an authenticated but unpaired remote device', async () => {
    authorization = { ...authorization, deviceId: null, paired: false };
    const manager = createManager();

    const view = await manager.login({ username: USERNAME, password: PASSWORD });

    expect(view).toMatchObject({
      state: 'pairing-required',
      accountId: 'account-admin',
      capabilities: [],
      deviceId: null,
      expiresAt: null,
    });

    await vi.advanceTimersByTimeAsync(30 * 24 * 60 * 60 * 1_000);
    expect(manager.getView().state).toBe('pairing-required');
  });

  it('activates the authenticated account only after a paired device is bound', async () => {
    authorization = { ...authorization, deviceId: null, paired: false };
    const manager = createManager();
    await manager.login({ username: USERNAME, password: PASSWORD });

    const view = manager.activatePairedDevice('device-new-laptop');

    expect(view).toMatchObject({
      state: 'active',
      accountId: 'account-admin',
      deviceId: 'device-new-laptop',
      capabilities: OWNER_PRIVILEGED_CAPABILITIES,
    });
  });

  it('clears authentication when current authorization cannot be resolved', async () => {
    resolveAuthorization.mockRejectedValueOnce(new Error('lookup failed'));
    const manager = createManager();

    await expect(manager.login({ username: USERNAME, password: PASSWORD })).rejects.toThrow(
      'Unable to authorize this privileged account.',
    );
    expect(authClient.clear).toHaveBeenCalledOnce();
    expect(manager.getView().state).toBe('signed-out');
  });

  it('rejects inactive, unassigned, and mismatched accounts generically', async () => {
    const manager = createManager();
    currentAccount = accountRecord({ active: false });
    await expect(manager.login({ username: USERNAME, password: PASSWORD })).rejects.toBeInstanceOf(
      PrivilegedSessionError,
    );

    currentAccount = accountRecord();
    authorization = { ...authorization, assigned: false, role: null };
    await expect(manager.login({ username: USERNAME, password: PASSWORD })).rejects.toMatchObject({
      code: 'unauthorized',
    });

    currentAccount = accountRecord({ username: 'charles' });
    await expect(manager.login({ username: USERNAME, password: PASSWORD })).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('enforces password bounds without trimming or retaining the password', async () => {
    const manager = createManager();

    await expect(manager.login({ username: USERNAME, password: 'short' })).rejects.toMatchObject({
      code: 'invalid-input',
    });
    await expect(
      manager.login({ username: USERNAME, password: 'x'.repeat(129) }),
    ).rejects.toMatchObject({ code: 'invalid-input' });

    const spacedPassword = ` ${PASSWORD} `;
    await manager.login({ username: USERNAME, password: spacedPassword });
    expect(authClient.authenticate).toHaveBeenCalledWith(USERNAME, spacedPassword);
    expect(Object.values(manager)).not.toContain(spacedPassword);
  });

  it('reauthenticates with a fresh password check and returns a five-minute opaque proof', async () => {
    const manager = createManager();
    await manager.login({ username: USERNAME, password: PASSWORD });
    await vi.advanceTimersByTimeAsync(60_000);

    const proof = await manager.reauthenticate(PASSWORD);

    expect(authClient.reauthenticate).toHaveBeenCalledWith(USERNAME, PASSWORD);
    expect(confirmReauthentication).toHaveBeenCalledWith({
      accountId: 'account-admin',
      authenticatedAt: new Date(START_TIME + 60_000).toISOString(),
      deviceId: 'device-work-laptop',
      displayName: 'Ryan Bledsoe',
      role: 'owner',
      username: USERNAME,
    });
    expect(proof).toEqual({
      proofId: 'reauth-command-id',
      expiresAt: new Date(START_TIME + 6 * 60_000).toISOString(),
    });
  });

  it('uses a server-owned proof for paired-client reauthentication', async () => {
    const serverExpiresAt = new Date(START_TIME + 4 * 60_000).toISOString();
    authClient.reauthenticateRemotely = vi.fn(async () => ({
      account: currentAccount,
      requestId: 'server-reauth-proof',
      expiresAt: serverExpiresAt,
    }));
    const manager = createManager();
    await manager.login({ username: USERNAME, password: PASSWORD });

    const proof = await manager.reauthenticate(PASSWORD);

    expect(authClient.reauthenticateRemotely).toHaveBeenCalledWith(
      USERNAME,
      PASSWORD,
      'device-work-laptop',
    );
    expect(authClient.reauthenticate).not.toHaveBeenCalled();
    expect(confirmReauthentication).not.toHaveBeenCalled();
    expect(proof).toEqual({
      proofId: 'server-reauth-proof',
      expiresAt: serverExpiresAt,
    });
  });

  it('signs out when reauthentication confirmation cannot be completed', async () => {
    const manager = createManager();
    await manager.login({ username: USERNAME, password: PASSWORD });
    confirmReauthentication.mockRejectedValueOnce(new Error('confirmation unavailable'));

    await expect(manager.reauthenticate(PASSWORD)).rejects.toMatchObject({ code: 'unauthorized' });
    expect(manager.getView().state).toBe('signed-out');
    expect(authClient.clear).toHaveBeenCalledOnce();
  });

  it('rejects reauthentication after sign out or when the fresh account no longer matches', async () => {
    const manager = createManager();
    await manager.login({ username: USERNAME, password: PASSWORD });
    await manager.logout();

    await expect(manager.reauthenticate(PASSWORD)).rejects.toMatchObject({ code: 'unauthorized' });

    await manager.login({ username: USERNAME, password: PASSWORD });
    authClient.reauthenticate.mockResolvedValueOnce(accountRecord({ id: 'replacement-account' }));
    await expect(manager.reauthenticate(PASSWORD)).rejects.toMatchObject({ code: 'unauthorized' });
    expect(manager.getView().state).toBe('signed-out');
  });

  it('signs out immediately when the fresh password authentication fails', async () => {
    const manager = createManager();
    await manager.login({ username: USERNAME, password: PASSWORD });
    authClient.reauthenticate.mockRejectedValueOnce(new Error('invalid credentials'));

    await expect(manager.reauthenticate(PASSWORD)).rejects.toThrow(
      'Unable to authorize this privileged account.',
    );
    expect(manager.getView().state).toBe('signed-out');
    expect(authClient.clear).toHaveBeenCalledOnce();
  });
});
