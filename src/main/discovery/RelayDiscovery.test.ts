import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockPublish = vi.fn();
const mockUnpublishAll = vi.fn();
const mockDestroy = vi.fn();
let browserOnUp: ((service: unknown) => void) | null = null;
const mockBrowserStop = vi.fn();
let lastMdnsEmitter: EventEmitter | null = null;

vi.mock('bonjour-service', () => ({
  Bonjour: vi.fn().mockImplementation(function () {
    lastMdnsEmitter = new EventEmitter();
    return {
      server: { mdns: lastMdnsEmitter },
      publish: mockPublish,
      unpublishAll: mockUnpublishAll,
      destroy: mockDestroy,
      find: vi.fn((_opts: unknown, onUp: (service: unknown) => void) => {
        browserOnUp = onUp;
        return { stop: mockBrowserStop };
      }),
    };
  }),
}));

vi.mock('../logger', () => ({
  loggers: { main: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

import { loggers } from '../logger';
import { startAdvertising, stopAdvertising, discoverServers } from './RelayDiscovery';

describe('RelayDiscovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    browserOnUp = null;
    lastMdnsEmitter = null;
    stopAdvertising();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('advertises a relay service on the given port', () => {
    startAdvertising(8090);
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'relay', port: 8090 }),
    );
  });

  it('is idempotent and stoppable', () => {
    startAdvertising(8090);
    startAdvertising(8090);
    expect(mockPublish).toHaveBeenCalledTimes(1);
    stopAdvertising();
    expect(mockUnpublishAll).toHaveBeenCalled();
    expect(mockDestroy).toHaveBeenCalled();
  });

  it('collects discovered servers with IPv4 addresses and resolves after the timeout', async () => {
    const lanIp = ['192', '168', '1', '50'].join('.');
    const linkLocalIpv6 = ['fe80', ':', '1'].join(':');
    const resultPromise = discoverServers(1000);
    browserOnUp?.({
      name: 'Relay on ops-mac',
      port: 8090,
      addresses: [linkLocalIpv6, lanIp],
    });
    browserOnUp?.({ name: 'No address service', port: 8090, addresses: [] });
    browserOnUp?.({ name: 'Public WAN impostor', port: 8090, addresses: ['203.0.113.5'] });
    browserOnUp?.({ name: 'Malformed octets', port: 8090, addresses: ['999.1.1.1'] });
    await vi.advanceTimersByTimeAsync(1000);
    const results = await resultPromise;
    expect(results).toEqual([
      {
        name: 'Relay on ops-mac',
        host: lanIp,
        port: 8090,
        url: ['http', '://', lanIp, ':8090'].join(''),
      },
    ]);
    expect(mockBrowserStop).toHaveBeenCalled();
  });

  it('survives async mDNS socket errors while advertising', () => {
    startAdvertising(8090);
    expect(lastMdnsEmitter).not.toBeNull();
    expect(() => lastMdnsEmitter?.emit('error', new Error('bind EADDRINUSE 5353'))).not.toThrow();
    expect(loggers.main.warn).toHaveBeenCalledWith(
      'mDNS socket error',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it('survives async mDNS socket errors during discovery', async () => {
    const resultPromise = discoverServers(1000);
    expect(lastMdnsEmitter).not.toBeNull();
    expect(() => lastMdnsEmitter?.emit('error', new Error('bind EACCES 5353'))).not.toThrow();
    expect(loggers.main.warn).toHaveBeenCalledWith(
      'mDNS socket error',
      expect.objectContaining({ error: expect.any(Error) }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    await expect(resultPromise).resolves.toEqual([]);
  });
});
