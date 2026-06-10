import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { setupSetupHandlers } from './setupHandlers';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('node:os', () => ({
  hostname: vi.fn(() => 'noc-admin-pc'),
  networkInterfaces: vi.fn(() => ({
    Ethernet: [
      {
        address: ['192', '168', '1', '25'].join('.'),
        family: 'IPv4',
        internal: false,
      },
    ],
    Loopback: [
      {
        address: '127.0.0.1',
        family: 'IPv4',
        internal: true,
      },
    ],
  })),
}));

vi.mock('../logger', () => ({
  loggers: {
    main: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

vi.mock('../discovery/RelayDiscovery', () => ({
  discoverServers: vi.fn().mockResolvedValue([
    {
      name: 'Relay on ops-mac',
      host: ['192', '168', '1', '50'].join('.'),
      port: 8090,
      url: ['http', '://', ['192', '168', '1', '50'].join('.'), ':8090'].join(''),
    },
  ]),
}));

describe('setupHandlers', () => {
  const SECRET_FIELD = 'secret';
  const remoteIp = ['192', '168', '1', '50'].join('.');
  const privateLanHttpUrl = ['http', '://', remoteIp, ':8090'].join('');
  const publicHttpUrl = ['http', '://', 'relay.example.com', ':8090'].join('');
  const createFixturePassphrase = () => ['fixture', 'passphrase', '123'].join('-');
  const buildServerConfig = (overrides: Record<string, unknown> = {}) => ({
    mode: 'server',
    port: 8090,
    bindHost: '127.0.0.1',
    [SECRET_FIELD]: createFixturePassphrase(),
    ...overrides,
  });
  const buildClientConfig = (overrides: Record<string, unknown> = {}) => ({
    mode: 'client',
    serverUrl: 'https://relay.example.com',
    [SECRET_FIELD]: createFixturePassphrase(),
    ...overrides,
  });
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};

  const mockAppConfig = {
    load: vi.fn(),
    save: vi.fn(),
    isConfigured: vi.fn(),
    clear: vi.fn(),
  };

  const mockOfflineCache = {
    clear: vi.fn(),
  };

  const mockPendingChanges = {
    clear: vi.fn(),
  };

  const getAppConfig = vi.fn(() => mockAppConfig as never);
  const getOfflineCache = vi.fn(() => mockOfflineCache as never);
  const getPendingChanges = vi.fn(() => mockPendingChanges as never);

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(ipcMain.handle).mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers[channel] = handler;
        return ipcMain;
      },
    );

    setupSetupHandlers(getAppConfig, getOfflineCache, getPendingChanges);
  });

  describe('SETUP_GET_CONFIG', () => {
    it('returns public server config without the secret when appConfig is available', () => {
      const configData = buildServerConfig();
      mockAppConfig.load.mockReturnValue(configData);

      const result = handlers[IPC_CHANNELS.SETUP_GET_CONFIG]();

      expect(mockAppConfig.load).toHaveBeenCalled();
      expect(result).toEqual({
        mode: 'server',
        port: 8090,
        bindHost: '127.0.0.1',
        lanIp: ['192', '168', '1', '25'].join('.'),
      });
      expect(result).not.toHaveProperty(SECRET_FIELD);
    });

    it('returns public client config without the secret when appConfig is available', () => {
      const configData = buildClientConfig();
      mockAppConfig.load.mockReturnValue(configData);

      const result = handlers[IPC_CHANNELS.SETUP_GET_CONFIG]();

      expect(result).toEqual({ mode: 'client', serverUrl: 'https://relay.example.com' });
      expect(result).not.toHaveProperty(SECRET_FIELD);
    });

    it('returns null when appConfig is null', () => {
      getAppConfig.mockReturnValueOnce(null as never);

      const result = handlers[IPC_CHANNELS.SETUP_GET_CONFIG]();

      expect(result).toBeNull();
    });
  });

  describe('SETUP_SAVE_CONFIG', () => {
    it('saves valid server mode config and returns true', () => {
      const config = buildServerConfig();

      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, config);

      expect(mockAppConfig.save).toHaveBeenCalledWith(config);
      expect(result).toBe(true);
    });

    it('defaults server mode config to direct LAN access when bindHost is omitted', () => {
      const config = buildServerConfig();
      delete config.bindHost;

      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, config);

      expect(mockAppConfig.save).toHaveBeenCalledWith({
        ...config,
        bindHost: '0.0.0.0',
      });
      expect(result).toBe(true);
    });

    it('saves valid client mode config and returns true', () => {
      const config = buildClientConfig();

      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, config);

      expect(mockAppConfig.save).toHaveBeenCalledWith(config);
      expect(result).toBe(true);
    });

    it('canonicalizes client serverUrl before saving', () => {
      const config = buildClientConfig({ serverUrl: 'https://relay.example.com/' });

      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, config);

      expect(mockAppConfig.save).toHaveBeenCalledWith({
        ...config,
        serverUrl: 'https://relay.example.com',
      });
      expect(result).toBe(true);
    });

    it('returns false when appConfig is null', () => {
      getAppConfig.mockReturnValueOnce(null as never);

      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, buildServerConfig());

      expect(result).toBe(false);
    });

    it('rejects invalid config with missing fields', () => {
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, { mode: 'server' });

      expect(mockAppConfig.save).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('rejects config with invalid mode', () => {
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG](
        {},
        buildServerConfig({ mode: 'invalid' }),
      );

      expect(mockAppConfig.save).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('rejects server config with port below 1024', () => {
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, buildServerConfig({ port: 80 }));

      expect(mockAppConfig.save).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('rejects server config with port above 65535', () => {
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG](
        {},
        buildServerConfig({ port: 70000 }),
      );

      expect(mockAppConfig.save).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('rejects server config with unsupported bind host', () => {
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG](
        {},
        buildServerConfig({ bindHost: remoteIp }),
      );

      expect(mockAppConfig.save).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('rejects config with secret shorter than 8 chars', () => {
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG](
        {},
        {
          mode: 'server',
          port: 8090,
          secret: 'short',
        },
      );

      expect(mockAppConfig.save).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('rejects config with oversized secret', () => {
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG](
        {},
        buildServerConfig({ secret: 's'.repeat(257) }),
      );

      expect(mockAppConfig.save).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('rejects client config with invalid URL', () => {
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG](
        {},
        buildClientConfig({ serverUrl: 'not-a-url' }),
      );

      expect(mockAppConfig.save).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('rejects client config with oversized serverUrl', () => {
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG](
        {},
        buildClientConfig({ serverUrl: `https://${'a'.repeat(2040)}.example.com` }),
      );

      expect(mockAppConfig.save).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('rejects client config with path, query, hash, or credentials in serverUrl', () => {
      for (const serverUrl of [
        'https://relay.example.com/pb',
        'https://relay.example.com?team=ops',
        'https://relay.example.com#setup',
        'https://user:pass@relay.example.com',
      ]) {
        const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG](
          {},
          buildClientConfig({ serverUrl }),
        );
        expect(result).toBe(false);
      }

      expect(mockAppConfig.save).not.toHaveBeenCalled();
    });

    it('accepts private LAN HTTP client config without requiring insecure HTTP opt-in', () => {
      const config = buildClientConfig({ serverUrl: privateLanHttpUrl });

      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, config);

      expect(mockAppConfig.save).toHaveBeenCalledWith(config);
      expect(result).toBe(true);
    });

    it('rejects public HTTP client config unless insecure HTTP is explicitly allowed', () => {
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG](
        {},
        buildClientConfig({ serverUrl: publicHttpUrl }),
      );

      expect(mockAppConfig.save).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('accepts public HTTP client config with explicit insecure HTTP opt-in', () => {
      const config = buildClientConfig({
        serverUrl: publicHttpUrl,
        allowInsecureHttp: true,
      });

      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, config);

      expect(mockAppConfig.save).toHaveBeenCalledWith(config);
      expect(result).toBe(true);
    });

    it('clears offline cache after saving config', () => {
      const config = buildServerConfig();
      handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, config);

      expect(mockOfflineCache.clear).toHaveBeenCalled();
    });

    it('clears pending changes after saving config', () => {
      const config = buildServerConfig();
      handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, config);

      expect(mockPendingChanges.clear).toHaveBeenCalled();
    });

    it('handles offline cache clear failure gracefully', () => {
      mockOfflineCache.clear.mockImplementation(() => {
        throw new Error('disk error');
      });

      const config = buildServerConfig();
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, config);

      expect(result).toBe(true);
      expect(mockAppConfig.save).toHaveBeenCalled();
    });

    it('handles pending changes clear failure gracefully', () => {
      mockPendingChanges.clear.mockImplementation(() => {
        throw new Error('disk error');
      });

      const config = buildServerConfig();
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, config);

      expect(result).toBe(true);
    });

    it('handles null offline cache gracefully', () => {
      getOfflineCache.mockReturnValueOnce(null as never);

      const config = buildServerConfig();
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, config);

      expect(result).toBe(true);
    });

    it('handles null pending changes gracefully', () => {
      getPendingChanges.mockReturnValueOnce(null as never);

      const config = buildServerConfig();
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, config);

      expect(result).toBe(true);
    });

    it('works when optional getters are not provided', () => {
      vi.clearAllMocks();
      vi.mocked(ipcMain.handle).mockImplementation(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers[channel] = handler;
          return ipcMain;
        },
      );

      setupSetupHandlers(getAppConfig); // no optional params

      const config = buildServerConfig();
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, config);

      expect(result).toBe(true);
      expect(mockAppConfig.save).toHaveBeenCalled();
    });
  });

  describe('SETUP_TEST_CONNECTION', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns invalid-url for a malformed or disallowed URL', async () => {
      const result = await handlers[IPC_CHANNELS.SETUP_TEST_CONNECTION](
        {},
        {
          serverUrl: 'not a url',
          secret: createFixturePassphrase(),
        },
      );

      expect(result).toEqual({ ok: false, error: 'invalid-url' });
    });

    it('normalizes a bare LAN host:port before probing', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true });
      vi.stubGlobal('fetch', fetchMock);

      const result = await handlers[IPC_CHANNELS.SETUP_TEST_CONNECTION](
        {},
        {
          serverUrl: `${remoteIp}:8090`,
          secret: createFixturePassphrase(),
        },
      );

      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledWith(
        `${privateLanHttpUrl}/api/health`,
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('returns invalid-url for a public HTTP URL without insecure HTTP opt-in and never probes', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const result = await handlers[IPC_CHANNELS.SETUP_TEST_CONNECTION](
        {},
        {
          serverUrl: publicHttpUrl,
          secret: createFixturePassphrase(),
        },
      );

      expect(result).toEqual({ ok: false, error: 'invalid-url' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('probes a public HTTP URL when insecure HTTP is explicitly allowed', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: true }),
      );

      const result = await handlers[IPC_CHANNELS.SETUP_TEST_CONNECTION](
        {},
        {
          serverUrl: publicHttpUrl,
          secret: createFixturePassphrase(),
          allowInsecureHttp: true,
        },
      );

      expect(result).toEqual({ ok: true });
    });

    it('POSTs the secret to the PocketBase auth endpoint in the JSON body, not the URL', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true });
      vi.stubGlobal('fetch', fetchMock);
      const secret = createFixturePassphrase();

      await handlers[IPC_CHANNELS.SETUP_TEST_CONNECTION](
        {},
        {
          serverUrl: privateLanHttpUrl,
          secret,
        },
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [authUrl, authOptions] = fetchMock.mock.calls[1] as [
        string,
        { method: string; body: string },
      ];
      expect(authUrl).toBe(
        `${privateLanHttpUrl}/api/collections/_pb_users_auth_/auth-with-password`,
      );
      expect(authUrl).not.toContain(secret);
      expect(authOptions.method).toBe('POST');
      expect(JSON.parse(authOptions.body)).toMatchObject({ password: secret });
    });

    it('returns unreachable when the health endpoint does not respond', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

      const result = await handlers[IPC_CHANNELS.SETUP_TEST_CONNECTION](
        {},
        {
          serverUrl: privateLanHttpUrl,
          secret: createFixturePassphrase(),
        },
      );

      expect(result).toEqual({ ok: false, error: 'unreachable' });
    });

    it('returns auth-failed when health passes but auth is rejected', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce({ ok: true }) // /api/health
          .mockResolvedValueOnce({ ok: false, status: 400 }), // auth-with-password
      );

      const result = await handlers[IPC_CHANNELS.SETUP_TEST_CONNECTION](
        {},
        {
          serverUrl: privateLanHttpUrl,
          secret: createFixturePassphrase(),
        },
      );

      expect(result).toEqual({ ok: false, error: 'auth-failed' });
    });

    it('returns ok when health and auth both succeed', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: true }),
      );

      const result = await handlers[IPC_CHANNELS.SETUP_TEST_CONNECTION](
        {},
        {
          serverUrl: privateLanHttpUrl,
          secret: createFixturePassphrase(),
        },
      );

      expect(result).toEqual({ ok: true });
    });
  });

  describe('SETUP_DISCOVER_SERVERS', () => {
    it('returns the discovered LAN servers from the discovery module', async () => {
      const result = await handlers[IPC_CHANNELS.SETUP_DISCOVER_SERVERS]({});

      expect(result).toEqual([
        {
          name: 'Relay on ops-mac',
          host: remoteIp,
          port: 8090,
          url: privateLanHttpUrl,
        },
      ]);
    });
  });

  describe('SETUP_IS_CONFIGURED', () => {
    it('returns true when config is configured', () => {
      mockAppConfig.isConfigured.mockReturnValue(true);

      const result = handlers[IPC_CHANNELS.SETUP_IS_CONFIGURED]();

      expect(result).toBe(true);
    });

    it('returns false when config is not configured', () => {
      mockAppConfig.isConfigured.mockReturnValue(false);

      const result = handlers[IPC_CHANNELS.SETUP_IS_CONFIGURED]();

      expect(result).toBe(false);
    });

    it('returns false when appConfig is null', () => {
      getAppConfig.mockReturnValueOnce(null as never);

      const result = handlers[IPC_CHANNELS.SETUP_IS_CONFIGURED]();

      expect(result).toBe(false);
    });
  });

  describe('SETUP_CLEAR_CONFIG', () => {
    it('delegates to appConfig.clear() and returns true', () => {
      mockAppConfig.clear.mockReturnValue(true);

      const result = handlers[IPC_CHANNELS.SETUP_CLEAR_CONFIG]();

      expect(mockAppConfig.clear).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('returns false when appConfig is null', () => {
      getAppConfig.mockReturnValueOnce(null as never);

      const result = handlers[IPC_CHANNELS.SETUP_CLEAR_CONFIG]();

      expect(result).toBe(false);
    });

    it('returns false when clear() fails', () => {
      mockAppConfig.clear.mockReturnValue(false);

      const result = handlers[IPC_CHANNELS.SETUP_CLEAR_CONFIG]();

      expect(result).toBe(false);
    });
  });
});
