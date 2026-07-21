/* eslint-disable sonarjs/no-clear-text-protocols */
import { describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from '../config/AppConfig';
import type { RelayWebServerState } from './RelayWebServerState';
import { RelayWebServerManager } from './RelayWebServerManager';

const SERVER_CONFIG: ServerConfig = {
  mode: 'server',
  port: 8090,
  bindHost: '0.0.0.0',
  secret: 'server-passphrase',
  web: { enabled: true, port: 8091 },
};

function fakeServer(state: RelayWebServerState) {
  return {
    start: vi.fn(async () => state),
    stop: vi.fn(async () => undefined),
    getState: vi.fn(() => state),
  };
}

describe('RelayWebServerManager', () => {
  it('does not create a listener when web access is disabled', async () => {
    const createServer = vi.fn();
    const manager = new RelayWebServerManager({ staticRoot: '/renderer', createServer });

    await manager.applyConfig({
      ...SERVER_CONFIG,
      web: { enabled: false, port: 8091 },
    });

    expect(createServer).not.toHaveBeenCalled();
    expect(manager.getState()).toMatchObject({ status: 'disabled', port: 8091 });
  });

  it('starts the exact configured listener and publishes its state', async () => {
    const available: RelayWebServerState = {
      status: 'available',
      host: '0.0.0.0',
      port: 8091,
      url: 'http://0.0.0.0:8091',
    };
    const server = fakeServer(available);
    const createServer = vi.fn(() => server);
    const onStateChanged = vi.fn();
    const manager = new RelayWebServerManager({
      staticRoot: '/renderer',
      createServer,
      onStateChanged,
    });

    await expect(manager.applyConfig(SERVER_CONFIG)).resolves.toEqual(available);

    expect(createServer).toHaveBeenCalledWith({
      host: '0.0.0.0',
      port: 8091,
      staticRoot: '/renderer',
      onStateChanged: expect.any(Function),
    });
    expect(server.start).toHaveBeenCalledOnce();
    expect(onStateChanged).toHaveBeenLastCalledWith(available);
  });

  it('stops the previous listener before applying changed settings', async () => {
    const first = fakeServer({ status: 'available', host: '0.0.0.0', port: 8091 });
    const second = fakeServer({ status: 'available', host: '0.0.0.0', port: 8092 });
    const createServer = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const manager = new RelayWebServerManager({ staticRoot: '/renderer', createServer });

    await manager.applyConfig(SERVER_CONFIG);
    await manager.applyConfig({ ...SERVER_CONFIG, web: { enabled: true, port: 8092 } });

    expect(first.stop).toHaveBeenCalledOnce();
    expect(first.stop.mock.invocationCallOrder[0]).toBeLessThan(
      second.start.mock.invocationCallOrder[0]!,
    );
  });

  it('retries the current enabled configuration on the same port', async () => {
    const conflicted = fakeServer({
      status: 'conflict',
      host: '0.0.0.0',
      port: 8091,
      error: 'port-conflict',
    });
    const available = fakeServer({ status: 'available', host: '0.0.0.0', port: 8091 });
    const createServer = vi.fn().mockReturnValueOnce(conflicted).mockReturnValueOnce(available);
    const manager = new RelayWebServerManager({ staticRoot: '/renderer', createServer });
    await manager.applyConfig(SERVER_CONFIG);

    await manager.retry();

    expect(conflicted.stop).toHaveBeenCalledOnce();
    expect(createServer).toHaveBeenCalledTimes(2);
    expect(manager.getState().port).toBe(8091);
  });

  it('creates one gateway per listener and disposes it after the listener stops', async () => {
    const server = fakeServer({ status: 'available', host: '0.0.0.0', port: 8091 });
    const gateway = {
      authorizeStatic: vi.fn(() => true),
      handleApi: vi.fn(),
      dispose: vi.fn(async () => undefined),
    };
    const createGateway = vi.fn(() => gateway);
    const createServer = vi.fn(() => server);
    const manager = new RelayWebServerManager({
      staticRoot: '/renderer',
      createServer,
      createGateway,
    });

    await manager.applyConfig(SERVER_CONFIG);
    expect(createGateway).toHaveBeenCalledWith(SERVER_CONFIG);
    expect(createServer).toHaveBeenCalledWith(expect.objectContaining({ gateway }));

    await manager.stop();
    expect(server.stop.mock.invocationCallOrder[0]).toBeLessThan(
      gateway.dispose.mock.invocationCallOrder[0]!,
    );
  });
});
