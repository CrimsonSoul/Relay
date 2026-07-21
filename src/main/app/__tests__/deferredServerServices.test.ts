import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferredServerServices } from '../deferredServerServices';

describe('deferred server services', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('yields before starting data managers and PocketBase background work', async () => {
    const calls: string[] = [];
    const services = createDeferredServerServices({
      startDataManagers: () => calls.push('data-managers'),
      startPocketBaseServices: () => calls.push('pocketbase-services'),
    });

    services.schedule({ mode: 'server', port: 8090, secret: 'test' });
    expect(calls).toEqual([]);

    await vi.runOnlyPendingTimersAsync();
    expect(calls).toEqual(['data-managers', 'pocketbase-services']);
  });

  it('cancels pending startup work during shutdown', async () => {
    const startDataManagers = vi.fn();
    const services = createDeferredServerServices({
      startDataManagers,
      startPocketBaseServices: vi.fn(),
    });

    services.schedule({ mode: 'server', port: 8090, secret: 'test' });
    services.cancel();
    await vi.runOnlyPendingTimersAsync();

    expect(startDataManagers).not.toHaveBeenCalled();
  });
});
