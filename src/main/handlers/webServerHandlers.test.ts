/* eslint-disable sonarjs/no-clear-text-protocols, sonarjs/no-hardcoded-ip */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { setupRelayWebServerHandlers } from './webServerHandlers';

const mocks = vi.hoisted(() => ({
  assertTrustedIpcSender: vi.fn(() => true),
}));

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock('../utils/trustedSender', () => ({
  assertTrustedIpcSender: mocks.assertTrustedIpcSender,
}));

type Handler = (event: unknown, ...args: unknown[]) => unknown;

describe('setupRelayWebServerHandlers', () => {
  const handlers: Record<string, Handler> = {};
  const call = (channel: string, ...args: unknown[]) => {
    const handler = handlers[channel];
    if (!handler) throw new Error(`Missing handler for ${channel}`);
    return handler({}, ...args);
  };
  const config = {
    load: vi.fn(() => ({
      mode: 'server' as const,
      port: 8090,
      bindHost: '0.0.0.0' as const,
      secret: 'fixture-passphrase-123',
      web: { enabled: true, port: 8091 },
    })),
    updateServerWebConfig: vi.fn(() => true),
  };
  const manager = {
    getState: vi.fn(() => ({
      status: 'available' as const,
      host: '0.0.0.0',
      port: 8091,
      url: 'http://0.0.0.0:8091',
    })),
    applyConfig: vi.fn(async (nextConfig: { web?: { port: number } }) => ({
      status: 'available' as const,
      host: '0.0.0.0',
      port: nextConfig.web?.port ?? 8091,
      url: `http://0.0.0.0:${nextConfig.web?.port ?? 8091}`,
    })),
    retry: vi.fn(async () => ({
      status: 'available' as const,
      host: '0.0.0.0',
      port: 8091,
      url: 'http://0.0.0.0:8091',
    })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(handlers)) delete handlers[key];
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers[channel] = handler as Handler;
      return ipcMain;
    });
    config.load.mockReturnValue({
      mode: 'server',
      port: 8090,
      bindHost: '0.0.0.0',
      secret: 'fixture-passphrase-123',
      web: { enabled: true, port: 8091 },
    });
    config.updateServerWebConfig.mockReturnValue(true);
    setupRelayWebServerHandlers({
      getAppConfig: () => config as never,
      getManager: () => manager as never,
      getLanAddress: () => '192.168.1.25',
    });
  });

  it('returns the exact browser URL using the LAN address, never the bind-all address', () => {
    const result = call(IPC_CHANNELS.WEB_SERVER_GET_STATE);

    expect(result).toEqual({
      enabled: true,
      status: 'available',
      port: 8091,
      url: 'http://192.168.1.25:8091',
    });
    expect(JSON.stringify(result)).not.toContain('0.0.0.0');
  });

  it('validates, persists, and applies updated settings on the exact configured port', async () => {
    const result = await call(IPC_CHANNELS.WEB_SERVER_SAVE_CONFIG, {
      enabled: true,
      port: 8092,
    });

    expect(config.updateServerWebConfig).toHaveBeenCalledWith({ enabled: true, port: 8092 });
    expect(manager.applyConfig).toHaveBeenCalledWith(
      expect.objectContaining({ web: { enabled: true, port: 8092 } }),
    );
    expect(result).toMatchObject({
      success: true,
      data: { enabled: true, status: 'available', port: 8092 },
    });
  });

  it.each([
    { enabled: true, port: 80 },
    { enabled: true, port: 8090 },
    { enabled: true, port: 70000 },
    { enabled: true, port: 8091, extra: true },
  ])('rejects invalid or colliding settings without changing the listener: %o', async (input) => {
    const result = await call(IPC_CHANNELS.WEB_SERVER_SAVE_CONFIG, input);

    expect(result).toMatchObject({ success: false });
    expect(config.updateServerWebConfig).not.toHaveBeenCalled();
    expect(manager.applyConfig).not.toHaveBeenCalled();
  });

  it('retries the same listener after a port conflict', async () => {
    manager.getState.mockReturnValueOnce({
      status: 'conflict',
      host: '0.0.0.0',
      port: 8091,
      error: 'port-conflict',
    } as never);

    const result = await call(IPC_CHANNELS.WEB_SERVER_RETRY);

    expect(manager.retry).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ success: true, data: { status: 'available', port: 8091 } });
  });

  it('does not expose or mutate web settings from client mode', async () => {
    config.load.mockReturnValue({
      mode: 'client',
      serverUrl: 'http://192.168.1.50:8090',
      secret: 'fixture-passphrase-123',
    } as never);

    expect(call(IPC_CHANNELS.WEB_SERVER_GET_STATE)).toEqual({
      enabled: false,
      status: 'failed',
      port: 8091,
      error: 'unavailable',
    });
    expect(
      await call(IPC_CHANNELS.WEB_SERVER_SAVE_CONFIG, { enabled: true, port: 8091 }),
    ).toMatchObject({ success: false });
    expect(config.updateServerWebConfig).not.toHaveBeenCalled();
  });

  it('rejects untrusted renderer calls before reading configuration', () => {
    mocks.assertTrustedIpcSender.mockReturnValueOnce(false);

    expect(call(IPC_CHANNELS.WEB_SERVER_GET_STATE)).toEqual({
      enabled: false,
      status: 'failed',
      port: 8091,
      error: 'unavailable',
    });
    expect(config.load).not.toHaveBeenCalled();
  });
});
