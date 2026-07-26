import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import PocketBase from 'pocketbase';
import { IPC_CHANNELS, type PbConnectionResult } from '@shared/ipc';
import { loggers } from '../logger';
import {
  authenticateRelayAppUser,
  setupPocketbaseConnectionHandlers,
} from './pocketbaseConnectionHandlers';
import { clearRelayAppUserAuthCoordinator } from '../pocketbase/RelayAppUserAuthCoordinator';

const mockAppUserAuthWithPassword = vi.fn();
const mockSuperuserAuthWithPassword = vi.fn();
const mockAuthRefresh = vi.fn();
function createMockAuthStore() {
  return {
    token: 'pb-token',
    record: {
      id: 'user-1',
      email: 'relay@relay.app',
      collectionId: '_pb_users_auth_',
      collectionName: 'users',
    },
    get isValid() {
      return Boolean(this.token);
    },
    save(
      token: string,
      record?: {
        id: string;
        email: string;
        collectionId: string;
        collectionName: string;
      } | null,
    ) {
      this.token = token;
      this.record = record ?? {
        id: '',
        email: '',
        collectionId: '',
        collectionName: '',
      };
    },
    clear() {
      this.token = '';
      this.record = { id: '', email: '', collectionId: '', collectionName: '' };
    },
  };
}
let currentAuthStore = createMockAuthStore();

const mockCollection = vi.fn((name: string) => {
  if (name === '_superusers') {
    return {
      authWithPassword: async (...args: unknown[]) => {
        const result = await mockSuperuserAuthWithPassword(...args);
        currentAuthStore.token = 'superuser-token';
        currentAuthStore.record = {
          id: 'superuser-1',
          email: 'admin@relay.app',
          collectionId: '_superusers',
          collectionName: '_superusers',
        };
        return result;
      },
      authRefresh: mockAuthRefresh,
    };
  }

  return {
    authWithPassword: async (...args: unknown[]) => {
      const result = await mockAppUserAuthWithPassword(...args);
      currentAuthStore.token = 'pb-token';
      currentAuthStore.record = {
        id: 'user-1',
        email: 'relay@relay.app',
        collectionId: '_pb_users_auth_',
        collectionName: 'users',
      };
      return result;
    },
    authRefresh: mockAuthRefresh,
  };
});
const mockPbProcess = {
  isRunning: vi.fn(),
  getLocalUrl: vi.fn(),
};

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('pocketbase', () => ({
  BaseAuthStore: class MockBaseAuthStore {},
  default: vi.fn().mockImplementation(function MockPocketBase() {
    return {
      collection: mockCollection,
      authStore: currentAuthStore,
    };
  }),
}));

vi.mock('../logger', () => ({
  loggers: {
    pocketbase: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

// Trusted-sender guard: unit-tested in ../utils/trustedSender.test.ts and
// exercised for real (positive + negative) in authHandlers.test.ts.
// Here it is mocked to pass so each handler's own behavior is what's tested.
vi.mock('../utils/trustedSender', () => ({
  assertTrustedIpcSender: () => true,
  isTrustedIpcSender: () => true,
}));

describe('pocketbaseConnectionHandlers', () => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};

  const mockAppConfig = {
    load: vi.fn(),
  };

  const getAppConfig = vi.fn(() => mockAppConfig as never);
  const getPbProcess = vi.fn(() => null as never);
  const mockOfflineCache = {
    getUsableCacheMarker: vi.fn(),
    hasUsableCacheFor: vi.fn(),
  };
  const getOfflineCache = vi.fn(() => mockOfflineCache as never);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    clearRelayAppUserAuthCoordinator();
    mockPbProcess.isRunning.mockReturnValue(false);
    mockPbProcess.getLocalUrl.mockReturnValue('http://127.0.0.1:8090');
    currentAuthStore = createMockAuthStore();

    vi.mocked(ipcMain.handle).mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers[channel] = handler;
        return ipcMain;
      },
    );

    mockOfflineCache.getUsableCacheMarker.mockReturnValue(null);
    mockOfflineCache.hasUsableCacheFor.mockReturnValue(false);
    setupPocketbaseConnectionHandlers(getAppConfig, getPbProcess, getOfflineCache);
  });

  it('returns client bootstrap connection data when auth succeeds', async () => {
    mockAppConfig.load.mockReturnValue({
      mode: 'client',
      serverUrl: 'https://relay.example.com',
      secret: 'super-secret-passphrase',
    });
    mockAppUserAuthWithPassword.mockResolvedValue({});

    const result = (await handlers[IPC_CHANNELS.PB_GET_CONNECTION]()) as PbConnectionResult;

    expect(mockCollection).toHaveBeenCalledWith('_pb_users_auth_');
    expect(mockAppUserAuthWithPassword).toHaveBeenCalledWith(
      'relay@relay.app',
      'super-secret-passphrase',
      expect.objectContaining({ requestKey: null, signal: expect.any(AbortSignal) }),
    );
    expect(result).toEqual({
      ok: true,
      connection: {
        pbUrl: 'https://relay.example.com',
        auth: {
          token: 'pb-token',
          record: {
            id: 'user-1',
            email: 'relay@relay.app',
            collectionId: '_pb_users_auth_',
            collectionName: 'users',
          },
        },
      },
    });
  });

  it('never returns the saved config secret in the bootstrap payload', async () => {
    mockAppConfig.load.mockReturnValue({
      mode: 'client',
      serverUrl: 'https://relay.example.com',
      secret: 'super-secret-passphrase',
    });
    mockAppUserAuthWithPassword.mockResolvedValue({});

    const result = (await handlers[IPC_CHANNELS.PB_GET_CONNECTION]()) as PbConnectionResult;

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain('super-secret-passphrase');
  });

  it('single-flights concurrent renderer connection authentication', async () => {
    mockAppConfig.load.mockReturnValue({
      mode: 'client',
      serverUrl: 'https://relay.example.com',
      secret: 'super-secret-passphrase',
    });
    let release!: () => void;
    mockAppUserAuthWithPassword.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );

    const first = handlers[IPC_CHANNELS.PB_GET_CONNECTION]() as Promise<PbConnectionResult>;
    const second = handlers[IPC_CHANNELS.PB_GET_CONNECTION]() as Promise<PbConnectionResult>;
    await vi.waitFor(() => expect(mockAppUserAuthWithPassword).toHaveBeenCalledOnce());
    release();

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true }),
    ]);
    expect(mockAppUserAuthWithPassword).toHaveBeenCalledOnce();
  });

  it('authenticates an explicitly supplied web passphrase and never logs its bytes', async () => {
    const webPassphrase = ['submitted', 'web', 'passphrase'].join('-');
    const config = {
      mode: 'server' as const,
      port: 8090,
      bindHost: '0.0.0.0' as const,
      secret: 'different-saved-secret',
    };
    mockAppUserAuthWithPassword.mockRejectedValue(
      Object.assign(new Error(`rejected ${webPassphrase}`), { status: 401 }),
    );

    await expect(
      authenticateRelayAppUser(config, 'http://127.0.0.1:8090', webPassphrase, 'Web login failed', {
        allowServerSuperuserFallback: false,
      }),
    ).resolves.toEqual({ ok: false, error: 'auth-failed' });

    expect(mockAppUserAuthWithPassword).toHaveBeenCalledWith(
      'relay@relay.app',
      webPassphrase,
      expect.objectContaining({ requestKey: null }),
    );
    expect(mockAppUserAuthWithPassword).toHaveBeenCalledOnce();
    expect(mockSuperuserAuthWithPassword).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(loggers.pocketbase.warn).mock.calls)).not.toContain(
      webPassphrase,
    );
  });

  it('returns the local PocketBase URL in server mode when the process is running', async () => {
    getPbProcess.mockReturnValueOnce(mockPbProcess as never);
    mockPbProcess.isRunning.mockReturnValue(true);
    mockPbProcess.getLocalUrl.mockReturnValue('http://127.0.0.1:8090');
    mockAppConfig.load.mockReturnValue({
      mode: 'server',
      port: 8090,
      secret: 'super-secret-passphrase',
    });
    mockAppUserAuthWithPassword.mockResolvedValue({});

    const result = (await handlers[IPC_CHANNELS.PB_GET_CONNECTION]()) as PbConnectionResult;

    expect(result).toEqual({
      ok: true,
      connection: {
        pbUrl: 'http://127.0.0.1:8090',
        auth: {
          token: 'pb-token',
          record: {
            id: 'user-1',
            email: 'relay@relay.app',
            collectionId: '_pb_users_auth_',
            collectionName: 'users',
          },
        },
      },
    });
  });

  it('uses the configured server URL in client mode even if a local PB process is running', async () => {
    mockAppConfig.load.mockReturnValue({
      mode: 'client',
      // eslint-disable-next-line sonarjs/no-clear-text-protocols
      serverUrl: 'http://192.168.1.50:8090',
      secret: 'super-secret',
    });
    getPbProcess.mockReturnValue(mockPbProcess as never);
    mockPbProcess.isRunning.mockReturnValue(true);
    mockAppUserAuthWithPassword.mockResolvedValue({});

    const result = (await handlers[IPC_CHANNELS.PB_GET_CONNECTION]()) as PbConnectionResult;

    expect(result.ok).toBe(true);
    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    expect(PocketBase).toHaveBeenCalledWith('http://192.168.1.50:8090');
    expect(mockPbProcess.getLocalUrl).not.toHaveBeenCalled();
  });

  it('does not return a superuser token when server-mode app-user auth fails', async () => {
    getPbProcess.mockReturnValueOnce(mockPbProcess as never);
    mockPbProcess.isRunning.mockReturnValue(true);
    mockPbProcess.getLocalUrl.mockReturnValue('http://127.0.0.1:8090');
    mockAppConfig.load.mockReturnValue({
      mode: 'server',
      port: 8090,
      secret: 'super-secret-passphrase',
    });
    mockAppUserAuthWithPassword.mockRejectedValue(
      Object.assign(new Error('stale app user'), { status: 401 }),
    );
    mockSuperuserAuthWithPassword.mockResolvedValueOnce({});

    const result = (await handlers[IPC_CHANNELS.PB_GET_CONNECTION]()) as PbConnectionResult;

    expect(mockAppUserAuthWithPassword).toHaveBeenCalledWith(
      'relay@relay.app',
      'super-secret-passphrase',
      expect.objectContaining({ requestKey: null, signal: expect.any(AbortSignal) }),
    );
    expect(mockSuperuserAuthWithPassword).toHaveBeenCalledWith(
      'admin@relay.app',
      'super-secret-passphrase',
      expect.objectContaining({ requestKey: null, signal: expect.any(AbortSignal) }),
    );
    expect(result).toEqual({ ok: false, error: 'auth-failed' });
    expect(JSON.stringify(result)).not.toContain('superuser-token');
    expect(JSON.stringify(result)).not.toContain('admin@relay.app');
  });

  it('does not attempt server-mode superuser fallback for transient app-user failures', async () => {
    vi.useFakeTimers();
    getPbProcess.mockReturnValueOnce(mockPbProcess as never);
    mockPbProcess.isRunning.mockReturnValue(true);
    mockPbProcess.getLocalUrl.mockReturnValue('http://127.0.0.1:8090');
    mockAppConfig.load.mockReturnValue({
      mode: 'server',
      port: 8090,
      secret: 'super-secret-passphrase',
    });
    mockAppUserAuthWithPassword.mockRejectedValue(
      Object.assign(new Error('server error'), { status: 500 }),
    );

    const resultPromise = handlers[IPC_CHANNELS.PB_GET_CONNECTION]() as Promise<PbConnectionResult>;
    await vi.advanceTimersByTimeAsync(750);

    await expect(resultPromise).resolves.toEqual({ ok: false, error: 'auth-failed' });
    expect(mockAppUserAuthWithPassword).toHaveBeenCalledTimes(2);
    expect(mockSuperuserAuthWithPassword).not.toHaveBeenCalled();
  });

  it('does not attempt superuser fallback in client mode when app-user auth fails', async () => {
    mockAppConfig.load.mockReturnValue({
      mode: 'client',
      serverUrl: 'https://relay.example.com',
      secret: 'super-secret-passphrase',
    });
    mockAppUserAuthWithPassword.mockRejectedValue(new Error('bad credentials'));

    const result = (await handlers[IPC_CHANNELS.PB_GET_CONNECTION]()) as PbConnectionResult;

    expect(result).toEqual({ ok: false, error: 'auth-failed' });
    expect(mockSuperuserAuthWithPassword).not.toHaveBeenCalled();
  });

  it('retries transient client auth failures before returning the bootstrap connection', async () => {
    vi.useFakeTimers();
    mockAppConfig.load.mockReturnValue({
      mode: 'client',
      serverUrl: 'https://relay.example.com',
      secret: 'super-secret-passphrase',
    });
    mockAppUserAuthWithPassword
      .mockRejectedValueOnce(new Error('server still provisioning app user'))
      .mockResolvedValueOnce({});

    const resultPromise = handlers[IPC_CHANNELS.PB_GET_CONNECTION]() as Promise<PbConnectionResult>;
    await vi.advanceTimersByTimeAsync(750);

    await expect(resultPromise).resolves.toEqual({
      ok: true,
      connection: {
        pbUrl: 'https://relay.example.com',
        auth: {
          token: 'pb-token',
          record: {
            id: 'user-1',
            email: 'relay@relay.app',
            collectionId: '_pb_users_auth_',
            collectionName: 'users',
          },
        },
      },
    });
    expect(mockAppUserAuthWithPassword).toHaveBeenCalledTimes(2);
    expect(mockSuperuserAuthWithPassword).not.toHaveBeenCalled();
  });

  it('returns not-configured when no config is saved', async () => {
    mockAppConfig.load.mockReturnValue(null);

    const result = (await handlers[IPC_CHANNELS.PB_GET_CONNECTION]()) as PbConnectionResult;

    expect(result).toEqual({ ok: false, error: 'not-configured' });
  });

  it('returns invalid-config when client mode has no server URL', async () => {
    mockAppConfig.load.mockReturnValue({
      mode: 'client',
      serverUrl: '',
      secret: 'super-secret-passphrase',
    });

    const result = (await handlers[IPC_CHANNELS.PB_GET_CONNECTION]()) as PbConnectionResult;

    expect(result).toEqual({ ok: false, error: 'invalid-config' });
  });

  it('returns pb-unavailable when server mode is configured but the local process is not running', async () => {
    getPbProcess.mockReturnValueOnce(mockPbProcess as never);
    mockPbProcess.isRunning.mockReturnValue(false);
    mockAppConfig.load.mockReturnValue({
      mode: 'server',
      port: 8090,
      secret: 'super-secret-passphrase',
    });

    const result = (await handlers[IPC_CHANNELS.PB_GET_CONNECTION]()) as PbConnectionResult;

    expect(result).toEqual({ ok: false, error: 'pb-unavailable' });
  });

  it('returns pb-unavailable when auth aborts after the bootstrap timeout', async () => {
    vi.useFakeTimers();
    mockAppConfig.load.mockReturnValue({
      mode: 'client',
      serverUrl: 'https://relay.example.com',
      secret: 'super-secret-passphrase',
    });
    mockAppUserAuthWithPassword.mockImplementation(
      (_email: string, _password: string, options?: { signal?: AbortSignal; requestKey?: null }) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );

    const resultPromise = handlers[IPC_CHANNELS.PB_GET_CONNECTION]() as Promise<PbConnectionResult>;

    await vi.advanceTimersByTimeAsync(15_000);

    await expect(resultPromise).resolves.toEqual({ ok: false, error: 'pb-unavailable' });
    expect(mockAppUserAuthWithPassword).toHaveBeenCalledWith(
      'relay@relay.app',
      'super-secret-passphrase',
      expect.objectContaining({ requestKey: null, signal: expect.any(AbortSignal) }),
    );
  });

  it('returns auth-failed when auth rejects for a non-network reason', async () => {
    mockAppConfig.load.mockReturnValue({
      mode: 'client',
      serverUrl: 'https://relay.example.com',
      secret: 'super-secret-passphrase',
    });
    mockAppUserAuthWithPassword.mockRejectedValue(new Error('bad credentials'));

    const result = (await handlers[IPC_CHANNELS.PB_GET_CONNECTION]()) as PbConnectionResult;

    expect(result).toEqual({ ok: false, error: 'auth-failed' });
  });

  it('does not retry over HTTP when an HTTPS LAN connection is unavailable', async () => {
    vi.useFakeTimers();
    mockAppConfig.load.mockReturnValue({
      mode: 'client',
      serverUrl: 'https://192.168.1.50:8090',
      secret: 'super-secret',
    });
    mockAppUserAuthWithPassword.mockRejectedValue(new TypeError('fetch failed'));

    const resultPromise = handlers[IPC_CHANNELS.PB_GET_CONNECTION]() as Promise<PbConnectionResult>;
    await vi.advanceTimersByTimeAsync(750 * 3);
    const result = await resultPromise;

    expect(result).toEqual({ ok: false, error: 'pb-unavailable' });
    expect(mockAppUserAuthWithPassword).toHaveBeenCalledTimes(2);
    // Every PocketBase construction used the configured HTTPS URL — no http:// retry.
    const urls = (PocketBase as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(urls).toHaveLength(4);
    expect(new Set(urls)).toEqual(new Set(['https://192.168.1.50:8090']));
  });

  it('allows cache-backed startup after an unavailable server when the marker matches', async () => {
    vi.useFakeTimers();
    mockAppConfig.load.mockReturnValue({
      mode: 'client',
      serverUrl: 'https://relay.example.com',
      secret: 'super-secret-passphrase',
    });
    mockOfflineCache.getUsableCacheMarker.mockReturnValue({
      serverIdentity: 'https://relay.example.com',
      authenticatedAt: 100,
      lastSyncAt: 200,
    });
    mockOfflineCache.hasUsableCacheFor.mockReturnValue(true);
    mockAppUserAuthWithPassword.mockRejectedValue(new TypeError('fetch failed'));

    const resultPromise = handlers[IPC_CHANNELS.PB_GET_CONNECTION]() as Promise<PbConnectionResult>;
    await vi.advanceTimersByTimeAsync(750 * 3);

    await expect(resultPromise).resolves.toEqual({
      ok: false,
      error: 'pb-unavailable',
      offlineAvailable: true,
      pbUrl: 'https://relay.example.com',
      lastSyncAt: 200,
    });
  });

  it('does not allow cache-backed startup after credential rejection', async () => {
    mockAppConfig.load.mockReturnValue({
      mode: 'client',
      serverUrl: 'https://relay.example.com',
      secret: 'wrong-passphrase',
    });
    mockOfflineCache.getUsableCacheMarker.mockReturnValue({
      serverIdentity: 'https://relay.example.com',
      authenticatedAt: 100,
      lastSyncAt: 200,
    });
    mockOfflineCache.hasUsableCacheFor.mockReturnValue(true);
    mockAppUserAuthWithPassword.mockRejectedValue(
      Object.assign(new Error('invalid credentials'), { status: 401 }),
    );

    const result = (await handlers[IPC_CHANNELS.PB_GET_CONNECTION]()) as PbConnectionResult;

    expect(result).toEqual({ ok: false, error: 'auth-failed' });
    expect(mockAppUserAuthWithPassword).toHaveBeenCalledOnce();
  });

  it('does not retry a rate-limited authentication inside the three-second window', async () => {
    vi.useFakeTimers();
    mockAppConfig.load.mockReturnValue({
      mode: 'client',
      serverUrl: 'https://relay.example.com',
      secret: 'super-secret-passphrase',
    });
    mockAppUserAuthWithPassword.mockRejectedValue(
      Object.assign(new Error('rate limited'), { status: 429 }),
    );

    const resultPromise = handlers[IPC_CHANNELS.PB_GET_CONNECTION]() as Promise<PbConnectionResult>;
    await vi.advanceTimersByTimeAsync(750);

    await expect(resultPromise).resolves.toEqual({ ok: false, error: 'auth-failed' });
    expect(mockAppUserAuthWithPassword).toHaveBeenCalledOnce();
    expect(mockSuperuserAuthWithPassword).not.toHaveBeenCalled();
  });

  it('does not schedule another retry after the shared-auth rate window is exhausted', async () => {
    vi.useFakeTimers();
    mockAppConfig.load.mockReturnValue({
      mode: 'client',
      serverUrl: 'https://relay.example.com',
      secret: 'super-secret-passphrase',
    });
    mockAppUserAuthWithPassword.mockRejectedValue(
      Object.assign(new Error('temporary server error'), { status: 500 }),
    );

    const initial = handlers[IPC_CHANNELS.PB_GET_CONNECTION]() as Promise<PbConnectionResult>;
    await vi.advanceTimersByTimeAsync(750);
    await expect(initial).resolves.toEqual({ ok: false, error: 'auth-failed' });
    const priorWarnings = vi.mocked(loggers.pocketbase.warn).mock.calls.length;

    const cooledDown = handlers[IPC_CHANNELS.PB_GET_CONNECTION]() as Promise<PbConnectionResult>;
    await vi.advanceTimersByTimeAsync(750);

    await expect(cooledDown).resolves.toEqual({ ok: false, error: 'auth-failed' });
    expect(mockAppUserAuthWithPassword).toHaveBeenCalledTimes(2);
    expect(vi.mocked(loggers.pocketbase.warn).mock.calls).toHaveLength(priorWarnings + 1);
    expect(vi.mocked(loggers.pocketbase.warn).mock.lastCall?.[1]).toEqual(
      expect.objectContaining({ coolingDown: true }),
    );
  });

  it('returns refreshed connection data when refresh auth succeeds', async () => {
    mockAppConfig.load.mockReturnValue({
      mode: 'client',
      serverUrl: 'https://relay.example.com',
      secret: 'super-secret-passphrase',
    });
    mockAppUserAuthWithPassword.mockResolvedValue({});

    const result = (await handlers[IPC_CHANNELS.PB_REFRESH_CONNECTION]()) as PbConnectionResult;

    expect(mockCollection).toHaveBeenCalledWith('_pb_users_auth_');
    expect(mockAppUserAuthWithPassword).toHaveBeenCalledWith(
      'relay@relay.app',
      'super-secret-passphrase',
      expect.objectContaining({ requestKey: null, signal: expect.any(AbortSignal) }),
    );
    expect(mockAuthRefresh).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      connection: {
        pbUrl: 'https://relay.example.com',
        auth: {
          token: 'pb-token',
          record: {
            id: 'user-1',
            email: 'relay@relay.app',
            collectionId: '_pb_users_auth_',
            collectionName: 'users',
          },
        },
      },
    });
  });

  it('returns auth-failed when refresh auth rejects', async () => {
    mockAppConfig.load.mockReturnValue({
      mode: 'client',
      serverUrl: 'https://relay.example.com',
      secret: 'super-secret-passphrase',
    });
    mockAppUserAuthWithPassword.mockRejectedValue(new Error('bad credentials'));

    const result = (await handlers[IPC_CHANNELS.PB_REFRESH_CONNECTION]()) as PbConnectionResult;

    expect(result).toEqual({ ok: false, error: 'auth-failed' });
    expect(mockAuthRefresh).not.toHaveBeenCalled();
  });
});
