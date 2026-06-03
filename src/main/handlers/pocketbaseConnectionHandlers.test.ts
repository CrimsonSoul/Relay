import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS, type PbConnectionResult } from '@shared/ipc';
import { setupPocketbaseConnectionHandlers } from './pocketbaseConnectionHandlers';

const mockAppUserAuthWithPassword = vi.fn();
const mockSuperuserAuthWithPassword = vi.fn();
const mockAuthRefresh = vi.fn();
let currentAuthStore = {
  token: 'pb-token',
  record: { id: 'user-1', email: 'relay@relay.app' },
};

const mockCollection = vi.fn((name: string) => {
  if (name === '_superusers') {
    return {
      authWithPassword: async (...args: unknown[]) => {
        const result = await mockSuperuserAuthWithPassword(...args);
        currentAuthStore.token = 'superuser-token';
        currentAuthStore.record = { id: 'superuser-1', email: 'admin@relay.app' };
        return result;
      },
      authRefresh: mockAuthRefresh,
    };
  }

  return {
    authWithPassword: async (...args: unknown[]) => {
      const result = await mockAppUserAuthWithPassword(...args);
      currentAuthStore.token = 'pb-token';
      currentAuthStore.record = { id: 'user-1', email: 'relay@relay.app' };
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

describe('pocketbaseConnectionHandlers', () => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};

  const mockAppConfig = {
    load: vi.fn(),
  };

  const getAppConfig = vi.fn(() => mockAppConfig as never);
  const getPbProcess = vi.fn(() => null as never);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockPbProcess.isRunning.mockReturnValue(false);
    mockPbProcess.getLocalUrl.mockReturnValue('http://127.0.0.1:8090');
    currentAuthStore = {
      token: 'pb-token',
      record: { id: 'user-1', email: 'relay@relay.app' },
    };

    vi.mocked(ipcMain.handle).mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers[channel] = handler;
        return ipcMain;
      },
    );

    setupPocketbaseConnectionHandlers(getAppConfig, getPbProcess);
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
          record: { id: 'user-1', email: 'relay@relay.app' },
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
          record: { id: 'user-1', email: 'relay@relay.app' },
        },
      },
    });
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
    mockAppUserAuthWithPassword.mockRejectedValue(new Error('stale app user'));
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
          record: { id: 'user-1', email: 'relay@relay.app' },
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
          record: { id: 'user-1', email: 'relay@relay.app' },
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
