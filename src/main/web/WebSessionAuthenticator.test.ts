import { describe, expect, it, vi } from 'vitest';
import { createWebSessionAuthenticator } from './WebSessionAuthenticator';

const LOCAL_PB_URL = ['http', '://', '127.0.0.1', ':8090'].join('');
const LAN_ADDRESS = ['192', '168', '1', '25'].join('.');
const PUBLIC_PB_URL = ['http', '://', LAN_ADDRESS, ':8090'].join('');

describe('createWebSessionAuthenticator', () => {
  function fixture() {
    const config = {
      load: vi.fn(() => ({
        mode: 'server' as const,
        port: 8090,
        bindHost: '0.0.0.0' as const,
        secret: 'saved-config-secret',
        web: { enabled: true, port: 8091 },
      })),
    };
    const process = {
      isRunning: vi.fn(() => true),
      getLocalUrl: vi.fn(() => LOCAL_PB_URL),
    };
    const authStore = {
      token: 'app-user-token',
      record: { id: 'relay-user' } as Record<string, unknown> | null,
      save: vi.fn((token: string, record: Record<string, unknown> | null) => {
        authStore.token = token;
        authStore.record = record;
      }),
      clear: vi.fn(),
    };
    const authRefresh = vi.fn(async () => {
      authStore.token = 'refreshed-token';
    });
    const createPocketBase = vi.fn(() => ({
      authStore,
      collection: vi.fn(() => ({ authRefresh })),
    }));
    const authenticateRelayAppUser = vi.fn(async () => ({
      ok: true as const,
      connection: {
        pbUrl: LOCAL_PB_URL,
        auth: { token: 'app-user-token', record: { id: 'relay-user' } },
      },
    }));
    const authenticate = createWebSessionAuthenticator({
      getAppConfig: () => config as never,
      getPbProcess: () => process as never,
      getLanAddress: () => LAN_ADDRESS,
      authenticateRelayAppUser,
      createPocketBase: createPocketBase as never,
    });
    return {
      authenticate,
      authenticateRelayAppUser,
      authStore,
      authRefresh,
      createPocketBase,
      config,
      process,
    };
  }

  it('authenticates against loopback but returns only the browser-reachable LAN URL', async () => {
    const { authenticate, authenticateRelayAppUser, authStore, createPocketBase } = fixture();
    const passphrase = ['exact', 'browser', 'passphrase'].join('-');

    const result = await authenticate(passphrase);

    expect(authenticateRelayAppUser).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'server' }),
      LOCAL_PB_URL,
      passphrase,
      'Relay Web login failed',
    );
    expect(createPocketBase).toHaveBeenCalledWith(LOCAL_PB_URL);
    expect(authStore.save).toHaveBeenCalledWith('app-user-token', { id: 'relay-user' });
    expect(result).toMatchObject({
      pbUrl: PUBLIC_PB_URL,
      auth: { token: 'app-user-token' },
      publicConfig: {
        mode: 'server',
        port: 8090,
        lanIp: LAN_ADDRESS,
        web: { enabled: true, port: 8091 },
      },
      runtime: { kind: 'web' },
    });
    expect(JSON.stringify(result)).not.toContain(passphrase);
    expect(JSON.stringify(result)).not.toContain('saved-config-secret');
  });

  it('keeps a separate refreshable PocketBase auth store per accepted session', async () => {
    const { authenticate, authRefresh, authStore } = fixture();
    const result = await authenticate('fixture-passphrase');

    await expect(result!.refresh()).resolves.toEqual({
      token: 'refreshed-token',
      record: { id: 'relay-user' },
    });
    expect(authRefresh).toHaveBeenCalledWith({ requestKey: null });
    await result!.dispose?.();
    expect(authStore.clear).toHaveBeenCalledOnce();
  });

  it('fails closed when the app is not a healthy server or authentication fails', async () => {
    const first = fixture();
    first.config.load.mockReturnValueOnce({ mode: 'client' } as never);
    await expect(first.authenticate('fixture-passphrase')).resolves.toBeNull();

    const second = fixture();
    second.process.isRunning.mockReturnValueOnce(false);
    await expect(second.authenticate('fixture-passphrase')).resolves.toBeNull();

    const third = fixture();
    third.authenticateRelayAppUser.mockResolvedValueOnce({
      ok: false,
      error: 'auth-failed',
    } as never);
    await expect(third.authenticate('fixture-passphrase')).resolves.toBeNull();
  });
});
