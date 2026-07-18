import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_PRIVILEGED_CAPABILITIES,
  OWNER_PRIVILEGED_CAPABILITIES,
  PRIVILEGED_SESSION_IDLE_MS,
  type RelayPrivilegedAccountRecord,
} from '@shared/privilegedAccess';
import {
  PrivilegedSessionError,
  PrivilegedSessionManager,
  type PrivilegedAuthorization,
} from '../PrivilegedSessionManager';

const USERNAME = 'ryan';
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

describe('PrivilegedSessionManager', () => {
  let currentAccount: RelayPrivilegedAccountRecord;
  let authClient: {
    authenticate: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    reauthenticate: ReturnType<typeof vi.fn>;
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
      expiresAt: new Date(START_TIME + PRIVILEGED_SESSION_IDLE_MS).toISOString(),
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

  it('locks exactly after 15 minutes of privileged inactivity', async () => {
    const manager = createManager();
    await manager.login({ username: USERNAME, password: PASSWORD });

    await vi.advanceTimersByTimeAsync(PRIVILEGED_SESSION_IDLE_MS - 1);
    expect(manager.getView().state).toBe('active');

    await vi.advanceTimersByTimeAsync(1);
    expect(manager.getView()).toMatchObject({ state: 'locked', expiresAt: null });
    expect(authClient.clear).toHaveBeenCalled();
  });

  it('refreshes the idle deadline only for privileged activity', async () => {
    const manager = createManager();
    await manager.login({ username: USERNAME, password: PASSWORD });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000);

    manager.recordPrivilegedActivity();
    const refreshedExpiry = new Date(
      START_TIME + 10 * 60 * 1_000 + PRIVILEGED_SESSION_IDLE_MS,
    ).toISOString();
    expect(manager.getView().expiresAt).toBe(refreshedExpiry);

    // Ordinary Relay use does not call recordPrivilegedActivity and cannot extend this deadline.
    await vi.advanceTimersByTimeAsync(PRIVILEGED_SESSION_IDLE_MS);
    expect(manager.getView().state).toBe('locked');
  });

  it('supports explicit lock, logout, and app-close disposal', async () => {
    const manager = createManager();
    await manager.login({ username: USERNAME, password: PASSWORD });

    manager.lock();
    expect(manager.getView().state).toBe('locked');

    await manager.logout();
    expect(manager.getView().state).toBe('signed-out');

    await manager.login({ username: USERNAME, password: PASSWORD });
    manager.dispose();
    expect(manager.getView().state).toBe('signed-out');
    expect(authClient.clear).toHaveBeenCalledTimes(3);
  });

  it('locks on account disablement, replacement, username change, or credential replacement', async () => {
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
      expect(manager.getView().state).toBe('locked');
    }
  });

  it('invalidates the affected session after ownership or Publisher authority changes', async () => {
    const manager = createManager();
    await manager.login({ username: USERNAME, password: PASSWORD });

    manager.handleAuthorityChanged(['account-charles', 'account-admin']);

    expect(manager.getView().state).toBe('locked');
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
      expiresAt: new Date(START_TIME + PRIVILEGED_SESSION_IDLE_MS).toISOString(),
    });

    await vi.advanceTimersByTimeAsync(PRIVILEGED_SESSION_IDLE_MS);
    expect(manager.getView().state).toBe('locked');
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

  it('rejects reauthentication after lock or when the fresh account no longer matches', async () => {
    const manager = createManager();
    await manager.login({ username: USERNAME, password: PASSWORD });
    manager.lock();

    await expect(manager.reauthenticate(PASSWORD)).rejects.toMatchObject({ code: 'locked' });

    await manager.login({ username: USERNAME, password: PASSWORD });
    authClient.reauthenticate.mockResolvedValueOnce(accountRecord({ id: 'replacement-account' }));
    await expect(manager.reauthenticate(PASSWORD)).rejects.toMatchObject({ code: 'unauthorized' });
    expect(manager.getView().state).toBe('locked');
  });

  it('locks immediately when the fresh password authentication fails', async () => {
    const manager = createManager();
    await manager.login({ username: USERNAME, password: PASSWORD });
    authClient.reauthenticate.mockRejectedValueOnce(new Error('invalid credentials'));

    await expect(manager.reauthenticate(PASSWORD)).rejects.toThrow(
      'Unable to authorize this privileged account.',
    );
    expect(manager.getView().state).toBe('locked');
    expect(authClient.clear).toHaveBeenCalledOnce();
  });
});
