import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockPublish = vi.fn();
const mockUnpublishAll = vi.fn();
const mockDestroy = vi.fn();
let browserOnUp: ((service: unknown) => void) | null = null;
const mockBrowserStop = vi.fn();

vi.mock('bonjour-service', () => ({
  Bonjour: vi.fn().mockImplementation(function () {
    return {
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

import { startAdvertising, stopAdvertising, discoverServers } from './RelayDiscovery';

describe('RelayDiscovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    browserOnUp = null;
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
});
